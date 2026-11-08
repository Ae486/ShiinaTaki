import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ToolSet } from "ai";
import { loadMemoryConfig } from "../config/memory-config.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { seedLocalB2CoverageFixture } from "../db/hindsight-local-coverage-fixtures.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase } from "../db/sqlite.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createHealthyTransitionHarness } from "../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../testing/memory-transition-candidate-fixtures.ts";
import { failingGenerateModel } from "../testing/mock-language-model.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createCanonicalLocalRuntime } from "./canonical-local-runtime.ts";
import { createCanonicalLocalSubsystem } from "./canonical-local-subsystem.ts";
import { primaryEntryDigest, sanitizeCommittedPrimarySpan } from "./canonical-ingestion-source.ts";
import { readCurrentMemoryAuthorityIdentity, verifyCanonicalLocalReceipt } from "./legacy-migration/legacy-activation-repo.ts";
import { createLocalRuntimeBinding } from "./local-runtime-binding.ts";
import { createUtilitySlot } from "./utility-slot.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  const selected = seedLocalB2CoverageFixture(db);
  verifyCanonicalLocalReceipt(db, readCurrentMemoryAuthorityIdentity(db));
  const dataDir = mkdtempSync(join(tmpdir(), "taki-local-identity-"));
  const { logger } = createCaptureLogger();
  const utility = createUtilitySlot({ logger, mainModel: failingGenerateModel(new Error("unexpected model call")) });
  const binding = createLocalRuntimeBinding({ db, logger, construct: (epochId) => createCanonicalLocalSubsystem({ db, epochId,
    promptDir: join(dataDir, "prompt"), timeline: createTimelineRepo(db), logger, utility, config: loadMemoryConfig({}),
    boundIdentity: () => binding.boundIdentity() }) });
  const subsystem = binding.publish(selected.epochId);
  return { db, selected, binding, subsystem,
    close: async () => { await binding.stop(); db.close(); rmTempDir(dataDir); } };
}

function invoke(tools: ToolSet, name: string, input: unknown): Promise<unknown> {
  return Promise.resolve(tools[name]!.execute!(input as never, { toolCallId: `local-identity-${name}`, messages: [], context: {} }));
}
const RECALL = { query: "Original retained source", scope: "global", limit: 8, maxTokens: 1024 };
const RETAIN = { content: "Rejected stale Local write", layer: "episodes", context: null };

describe("Local current bound authority identity", () => {
  it.each(["snapshot", "transaction", "active-lineage"] as const)("rejects an old Local runtime after same-epoch %s drift", async (field) => {
    const f = fixture();
    try {
      const old = await f.subsystem.captureRun("taki");
      expect(await invoke(old.tools, "recall", RECALL)).toMatchObject({ ok: true });
      const previous = readCurrentMemoryAuthorityIdentity(f.db);
      f.db.transaction(() => {
        if (field === "active-lineage") f.db.prepare("UPDATE canonical_memory_authority_epochs SET provider_lineage_id='changed-local-lineage' WHERE epoch_id=:epoch")
          .run({ epoch: f.selected.epochId });
        else f.db.prepare(field === "snapshot"
          ? "UPDATE memory_authority_selection SET verified_snapshot_id='changed-snapshot' WHERE singleton=1"
          : "UPDATE memory_authority_selection SET activation_transaction_id='changed-transaction' WHERE singleton=1").run();
      });
      expect(readCurrentMemoryAuthorityIdentity(f.db).epochId).toBe(previous.epochId);
      expect(await invoke(old.tools, "recall", RECALL)).toMatchObject({ ok: false, error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
      const before = f.db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()!.n;
      expect(await invoke(old.tools, "retain", RETAIN)).toMatchObject({ ok: false, error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
      expect(f.db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()!.n).toBe(before);
      expect(() => f.subsystem.engine.reconcile()).toThrow("MEMORY_AUTHORITY_MISMATCH");
      expect(() => f.subsystem.engine.retention.listActive("profile")).toThrow("MEMORY_AUTHORITY_MISMATCH");
      expect(() => f.subsystem.engine.tidy.readBlock({ id: "identity", characterId: "taki" })).toThrow("MEMORY_AUTHORITY_MISMATCH");
      expect(() => old.assemble?.("")).toThrow("MEMORY_AUTHORITY_MISMATCH");
      await expect(f.subsystem.captureRun("taki")).rejects.toThrow("MEMORY_AUTHORITY_MISMATCH");
    } finally { await f.close(); }
  });

  it("keeps ordinary Local reads independent of historical receipt validation", async () => {
    const f = fixture();
    try {
      const old = await f.subsystem.captureRun("taki");
      const selected = readCurrentMemoryAuthorityIdentity(f.db);
      f.db.transaction(() => { f.db.prepare("UPDATE memory_migration_runs SET activation_transaction_id='damaged-history' WHERE run_id=:run")
        .run({ run: f.selected.runId }); });
      expect(readCurrentMemoryAuthorityIdentity(f.db)).toEqual(selected);
      expect(await invoke(old.tools, "recall", RECALL)).toMatchObject({ ok: true });
      expect(await invoke(old.tools, "retain", { ...RETAIN, content: "Stable selected Local authority" })).toMatchObject({ ok: true });
      expect(() => verifyCanonicalLocalReceipt(f.db, selected)).toThrow("MEMORY_INTEGRITY_ERROR");
    } finally { await f.close(); }
  });

  it("permanently refuses old Local ports after its existing binding is withdrawn", async () => {
    const f = fixture();
    try {
      const old = await f.subsystem.captureRun("taki");
      f.binding.unavailable(f.selected.epochId, "MEMORY_AUTHORITY_INVALID");
      expect(f.binding.boundIdentity()).toBeUndefined();
      expect(await invoke(old.tools, "recall", RECALL)).toMatchObject({ ok: false, error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
      expect(() => f.subsystem.engine.reconcile()).toThrow("MEMORY_AUTHORITY_FENCED");
      expect(() => f.subsystem.engine.retention.listActive("profile")).toThrow("MEMORY_AUTHORITY_FENCED");
      expect(() => old.assemble?.("")).toThrow("MEMORY_AUTHORITY_FENCED");
    } finally { await f.close(); }
  });

  it("refuses an in-flight ingestion before its actual write when the bound marker changes", async () => {
    const f = fixture();
    try {
      const entry = createTimelineRepo(f.db).append({ characterId: "taki", role: "user", content: "Copper compass belongs on the shelf." });
      const source = sanitizeCommittedPrimarySpan({ characterId: "taki", fromSeq: 0, throughSeq: entry.seq,
        entries: [{ kind: "primary-committed", entry, digest: primaryEntryDigest(entry), committedThroughSeq: entry.seq }] });
      const batch = f.subsystem.provider.prepareIngestion({ epochId: f.selected.epochId, characterId: "taki", bankId: f.selected.bankId,
        spanId: "identity-in-flight", source, gate: { decision: "keep", route: "global", fromSeq: entry.seq, throughSeq: entry.seq }, facts: [] });
      const before = f.db.prepare("SELECT count(*) AS n FROM canonical_memory_sources").get()!.n;
      const pending = f.subsystem.provider.ingest({ requestId: batch.requestId, authorityEpochId: f.selected.epochId,
        actor: "background-policy" }, batch);
      f.db.transaction(() => { f.db.prepare("UPDATE memory_authority_selection SET activation_transaction_id='in-flight-change' WHERE singleton=1").run(); });
      expect(await pending).toMatchObject({ ok: false, error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
      expect(f.db.prepare("SELECT count(*) AS n FROM canonical_memory_sources").get()!.n).toBe(before);
    } finally { await f.close(); }
  });

  it.each(["receipt", "digest"] as const)("rejects same-epoch %s drift after a real healthy return to Local", async (field) => {
    const f = await createHealthyTransitionHarness();
    try {
      const operation = f.owner.submit(await f.request()); await f.owner.stop();
      expect(f.owner.status(operation.operationId).state).toBe("completed");
      const old = await f.runtime.captureRun("taki");
      const selected = readCurrentMemoryAuthorityIdentity(f.db);
      expect(selected.mode).toBe("canonical-local");
      expect(await invoke(old.tools, "recall", RECALL)).toMatchObject({ ok: true });
      f.db.transaction(() => { f.db.prepare(field === "receipt"
        ? "UPDATE memory_authority_selection SET transition_receipt_id=:changed WHERE singleton=1"
        : "UPDATE memory_authority_selection SET replica_checkpoint_digest=:changed WHERE singleton=1")
        .run({ changed: "f".repeat(64) }); });
      expect(readCurrentMemoryAuthorityIdentity(f.db).epochId).toBe(selected.epochId);
      expect(await invoke(old.tools, "recall", RECALL)).toMatchObject({ ok: false, error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
      expect(await invoke(old.tools, "retain", RETAIN)).toMatchObject({ ok: false, error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
      await expect(f.runtime.captureRun("taki")).rejects.toThrow("MEMORY_AUTHORITY_MISMATCH");
    } finally { await f.close(); }
  }, 30_000);

  it("still constructs independent preactivation Local preparation without a selected marker", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const epoch = createCanonicalMemoryAuthorityRepo(db).initializeLocalAuthority();
      const local = createCanonicalLocalRuntime({ db, epochId: epoch.epochId });
      expect(readCurrentMemoryAuthorityIdentity(db).mode).toBe("legacy-markdown");
      expect(local.banks("prepared-character").character.scope.characterId).toBe("prepared-character");
      expect(() => createCanonicalLocalRuntime({ db, epochId: epoch.epochId, boundIdentity: () => undefined }))
        .toThrow("MEMORY_AUTHORITY_MISMATCH");
    } finally { db.close(); }
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createCompactionOperationRepo } from "../db/compaction-operation-repo.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { scriptedGenerateModel, type ScriptStep } from "../testing/mock-language-model.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import * as canonicalSubsystem from "./canonical-local-subsystem.ts";
import { composeMemoryRuntime } from "./runtime-composition.ts";

interface Opened {
  db: Database;
  dataDir: string;
}

const opened: Opened[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const item of opened.splice(0)) {
    item.db.close();
    rmTempDir(item.dataDir);
  }
});

async function boot(canonical: boolean, beforeCompose?: (db: Database) => void, capture = true) {
  const dataDir = mkdtempSync(join(tmpdir(), "taki-runtime-composition-"));
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  opened.push({ db, dataDir });
  const timeline = createTimelineRepo(db);
  const summaries = createSummaryRepo(db);
  const script: ScriptStep[] = canonical ? [] : [
    { kind: "text", deltas: ["[]"] },
    { kind: "text", deltas: ["legacy rolling summary"] },
  ];
  script.push({ kind: "text", deltas: ['{"decision":"skip"}'] },
    { kind: "text", deltas: ["canonical rolling summary"] });
  const model = scriptedGenerateModel(script);
  const { logger, records } = createCaptureLogger();
  const epoch = createCanonicalMemoryAuthorityRepo(db).initializeLocalAuthority("2026-08-29T00:00:00.000Z");
  if (canonical) activateMarker(db, epoch.epochId);
  beforeCompose?.(db);
  const runtime = composeMemoryRuntime({
    db,
    dataDir,
    bootId: "boot-a",
    promptDir: join(dataDir, "prompt"),
    model,
    timeline,
    windowStart: () => 1,
    summaries,
    estimatedTokens: () => 90,
    budget: () => 100,
    compact: { triggerRatio: 0.8, keepMessages: 3 },
    env: {},
    logger,
  });
  if (capture) await runtime.captureRun("taki");
  return { db, timeline, summaries, model, records, runtime, epochId: epoch.epochId };
}

function seed(fixture: Awaited<ReturnType<typeof boot>>, from: number, through: number): void {
  const entries = [];
  for (let seq = from; seq <= through; seq += 1) {
    entries.push(fixture.timeline.append({ characterId: "taki", role: "user", content: `m${seq}` }));
  }
  fixture.runtime.recordPrimaryCommitted({ characterId: "taki", entries });
}

function activateMarker(db: Database, epochId: string): void {
  const at = "2026-08-29T00:00:00.000Z";
  db.prepare(`INSERT INTO memory_migration_runs(run_id,snapshot_id,epoch_id,phase,status,requested_at,updated_at,lease_fence,activation_transaction_id)
    VALUES ('local-run','snapshot',:epoch,'activated','completed',:at,:at,1,'activation')`).run({ epoch: epochId, at });
  db.prepare(`INSERT INTO memory_migration_activation_receipts(run_id,transaction_id,snapshot_id,manifest_digest,readiness_digest,epoch_id,lease_fence,committed_at,marker_mode)
    VALUES ('local-run','activation','snapshot',:digest,:digest,:epoch,1,:at,'canonical-local')`)
    .run({ digest: "a".repeat(64), epoch: epochId, at });
  db.prepare(`UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,
    verified_snapshot_id='snapshot',activation_transaction_id='activation' WHERE singleton=1`).run({ epoch: epochId });
}

describe("provider-independent Compaction composition", () => {
  it("exposes a null operations() accessor outside the Hindsight runtime", async () => {
    const fixture = await boot(true);
    expect(fixture.runtime.operations()).toBeNull();
    expect((await boot(false)).runtime.operations()).toBeNull();
  });
  it("constructs Legacy Compaction in the shared maintenance chain and keeps it detached", async () => {
    const fixture = await boot(false);
    seed(fixture, 1, 10);

    const completed = fixture.runtime.autoMemory.onTurnCompleted("taki");
    expect(fixture.model.doGenerateCalls).toHaveLength(0);
    await completed;

    expect(fixture.summaries.get("taki")?.throughSeq).toBe(6);
    expect(fixture.model.doGenerateCalls).toHaveLength(2);
  });

  it("constructs Canonical Local Compaction after one durable Write Gate shared with its retirement flush", async () => {
    const fixture = await boot(true);
    seed(fixture, 1, 10);

    expect(fixture.runtime.autoMemory).toBeDefined();
    await fixture.runtime.autoMemory.onTurnCompleted("taki");

    expect(fixture.summaries.get("taki")?.throughSeq).toBe(6);
    expect(fixture.model.doGenerateCalls).toHaveLength(2);
  });

  it("retires the Legacy maintenance and flush writer after in-process activation", async () => {
    const fixture = await boot(false);
    seed(fixture, 1, 10);
    await fixture.runtime.autoMemory.onTurnCompleted("taki");
    expect(fixture.model.doGenerateCalls).toHaveLength(2);

    activateMarker(fixture.db, fixture.epochId);
    fixture.runtime.selected.bindCanonical(fixture.epochId);
    expect(fixture.runtime.selected.legacy).toBeNull();
    await fixture.runtime.captureRun("taki");
    seed(fixture, 11, 16);
    await fixture.runtime.autoMemory.onTurnCompleted("taki");

    expect(fixture.summaries.get("taki")?.throughSeq).toBeGreaterThan(6);
    expect(fixture.model.doGenerateCalls).toHaveLength(4);
  });

  it("serializes duplicate Canonical triggers so only one summary call runs", async () => {
    const fixture = await boot(true);
    seed(fixture, 1, 10);

    await Promise.all([
      fixture.runtime.autoMemory.onTurnCompleted("taki"),
      fixture.runtime.autoMemory.onTurnCompleted("taki"),
    ]);

    expect(fixture.model.doGenerateCalls).toHaveLength(2);
    expect(fixture.summaries.get("taki")?.throughSeq).toBe(6);
  });

  it("exposes the internal typed cancel/reconcile lifecycle and reconciles expired work at composition", async () => {
    const fixture = await boot(true, (db) => {
      createCompactionOperationRepo(db).begin({
        operationId: "compact:" + "a".repeat(64),
        characterId: "taki",
        reason: "pressure",
        selectedFromSeq: 1,
        selectedThroughSeq: 6,
        capturedTailSeq: 10,
        expectedSummaryRevision: 0,
        expectedSummaryThrough: 0,
        sourceDigest: "b".repeat(64),
        beforeTokens: 90,
        provider: "mock-provider",
        modelId: "mock-model",
        owner: "expired-generation",
        now: "2000-01-01T00:00:00.000Z",
        expiresAt: "2000-01-01T00:10:00.000Z",
      });
    });

    expect(fixture.runtime.compaction.cancel("taki")).toBe(false);
    expect(fixture.runtime.compaction.reconcile()).toBe(0);
    expect(fixture.db.prepare("SELECT state,failure_code FROM conversation_compaction_operations").get()).toEqual({
      state: "abandoned",
      failure_code: "LEASE_EXPIRED",
    });
  });

  it("boots with an observable unavailable Local binding and a failing flush when construction fails", async () => {
    vi.spyOn(canonicalSubsystem, "createCanonicalLocalSubsystem").mockImplementationOnce(() => { throw new Error("MEMORY_AUTHORITY_MISMATCH"); });
    const fixture = await boot(true, undefined, false);
    expect(fixture.runtime.bindingSnapshot()).toMatchObject({ selection: "canonical-local", selectedEpochId: fixture.epochId,
      binding: { kind: "unavailable", epochId: fixture.epochId, code: "MEMORY_AUTHORITY_MISMATCH" }, lifetime: "running", flush: "failing" });
    await expect(fixture.runtime.captureRun("taki")).rejects.toThrow("MEMORY_INTEGRITY_ERROR");
    expect(() => fixture.runtime.writeMemory({ characterId: "taki", layer: "profile", content: "no fallback", importance: 6 })).toThrow("MEMORY_INTEGRITY_ERROR");
    expect(() => fixture.runtime.memory.createTools("taki")).toThrow("MEMORY_INTEGRITY_ERROR");
    for (let seq = 1; seq <= 10; seq += 1) fixture.timeline.append({ characterId: "taki", role: "user", content: `m${seq}` });
    fixture.runtime.recordPrimaryCommitted({ characterId: "taki", entries: [] });
    await fixture.runtime.compaction.maybeRun("taki");
    expect(fixture.db.prepare("SELECT failure_code FROM conversation_compaction_operations").get()?.failure_code).toBe("MEMORY_FLUSH_FAILED");
    expect(fixture.model.doGenerateCalls).toHaveLength(0);
    expect(canonicalSubsystem.createCanonicalLocalSubsystem).toHaveBeenCalledOnce();
    // A marker without its joined activation receipt is corrupt state: recovery fails closed and never constructs.
    fixture.db.exec("DELETE FROM memory_migration_activation_receipts WHERE transaction_id='activation'");
    expect(() => fixture.runtime.recoverLocalBinding(fixture.epochId)).toThrow("MEMORY_INTEGRITY_ERROR");
    expect(fixture.runtime.bindingSnapshot().binding.kind).toBe("unavailable");
    await expect(fixture.runtime.stop()).resolves.toBeUndefined();
    expect(fixture.runtime.bindingSnapshot()).toMatchObject({ lifetime: "stopped", flush: "failing" });
  });

  it("refuses Local binding recovery while Legacy is selected and never creates an epoch", async () => {
    const fixture = await boot(false);
    const epochs = () => fixture.db.prepare("SELECT count(*) AS n FROM canonical_memory_authority_epochs").get()?.n;
    const before = epochs();
    expect(() => fixture.runtime.recoverLocalBinding(fixture.epochId)).toThrow("MEMORY_AUTHORITY_MISMATCH");
    expect(fixture.runtime.bindingSnapshot()).toMatchObject({ selection: "legacy-markdown", binding: { kind: "none" } });
    expect(epochs()).toBe(before);
    expect(fixture.runtime.selected.legacy).not.toBeNull();
  });
});

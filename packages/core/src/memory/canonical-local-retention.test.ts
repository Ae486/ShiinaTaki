import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryProviderCallContext } from "./memory-provider.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createCanonicalMemoryRepo } from "../db/canonical-memory-repo.ts";
import { createCanonicalMemoryMaintenanceRepo } from "../db/canonical-memory-maintenance-repo.ts";
import { createCanonicalMemorySparseRepo } from "../db/canonical-memory-sparse-repo.ts";
import { createLocalMemoryProvider } from "./local-memory-provider.ts";
import { createIntlSegmenterTokenizer } from "./search-tokenizer.ts";
import { createCanonicalLocalRetention } from "./canonical-local-retention.ts";
import { createMemoryCoordinator } from "./memory-coordinator.ts";
import { createCanonicalMemoryRun } from "./canonical-memory-run.ts";
import { writeCanonicalObservedMemory } from "./canonical-observed-write.ts";
import { ensureCanonicalLocalBanks } from "./canonical-local-banks.ts";

const AT = "2026-11-10T00:00:00.000Z";
const DAY = 86_400_000;
const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  const authority = createCanonicalMemoryAuthorityRepo(db); const epoch = authority.initializeLocalAuthority(AT);
  authority.createBank({ authorityEpochId: epoch.epochId, bankId: "character", scope: { kind: "character", characterId: "taki" },
    name: "Taki", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {} });
  const records = createCanonicalMemoryRepo(db); const tokenizer = createIntlSegmenterTokenizer({ stoplist: true });
  const repo = createCanonicalMemoryMaintenanceRepo(db, tokenizer);
  const provider = createLocalMemoryProvider({ authority, records, sparse: createCanonicalMemorySparseRepo(db), tokenizer,
    maintenance: repo, now: () => AT });
  const context = (requestId: string): MemoryProviderCallContext => ({ requestId, authorityEpochId: epoch.epochId, actor: "foreground-agent" });
  return { db, authority, epoch, records, provider, repo, context };
}

async function seed(f: ReturnType<typeof fixture>, id: string, expiresAt: string) {
  const capturedAt = new Date(Date.parse(AT) - 20 * DAY).toISOString();
  const result = await f.provider.retain(f.context(id), { bankId: "character", content: id, context: null, timestamp: null,
    tags: [], entities: [], metadata: {}, observationScopes: null, documentId: null, strategy: null, updateMode: "replace",
    provenance: { actor: "agent", origin: "explicit-agent", characterId: "taki", timelineFromSeq: null, timelineToSeq: null,
      capturedAt, sanitized: true, sourceRef: null }, policy: { layerId: "intentions", importance: 5, visibility: "mood-gated",
      disclosure: null, origin: "self", emotionalWeight: null, retention: { kind: "expiring", expiresAt }, policyVersion: 1 } });
  expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.error.code);
  return result.data.memories[0]!.memoryId;
}

describe("Local captured intentions policy", () => {
  it("captures once per sweep while existing canonical records retain their required explicit expiries", async () => {
    const f = fixture(); const expired = await seed(f, "expired", new Date(Date.parse(AT) - DAY).toISOString());
    const explicit = await seed(f, "explicit", new Date(Date.parse(AT) + DAY).toISOString());
    let days = 30; const capture = vi.fn(() => days);
    const retention = createCanonicalLocalRetention({ repo: f.repo, authority: f.authority, epochId: f.epoch.epochId,
      intentionsDefaultDays: capture, now: () => Date.parse(AT) });
    expect(retention.sweep()).toMatchObject({ archived: 1, deleted: 0, failed: 0 }); expect(capture).toHaveBeenCalledTimes(1);
    days = 1; expect(retention.sweep()).toBeUndefined();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(f.records.record(f.epoch.epochId, "character", expired)?.unit.state).toBe("invalidated");
    expect(f.records.record(f.epoch.epochId, "character", explicit)?.unit.state).toBe("valid");
  });

  it("retained Run writes and layer reclassification use their numeric policy after later captures", async () => {
    const f = fixture();
    const router = { globalBankId: () => "unused-global", characterBankId: () => "character", characterId: () => "taki" };
    const capture = (days: number) => createCanonicalMemoryRun({ router, intentionsDefaultDays: days,
      coordinator: createMemoryCoordinator({ authority: f.authority, providers: new Map([["local", f.provider.captureRetention(days)]]) }) });
    const old = await capture(4); const next = await capture(9);
    const options = { toolCallId: "call", messages: [] };
    for (const [run, label, days] of [[old, "old", 4], [next, "new", 9]] as const) {
      await run.tools.retain!.execute!({ content: `${label} episode`, layer: "episodes", context: null }, options as never);
      const episode = f.repo.list({ epochId: f.epoch.epochId, characterId: "taki" }).find((record) => record.unit.text === `${label} episode`)!;
      const changed = await run.tools.update_memory!.execute!({ scope: "character", memoryId: episode.unit.memoryId,
        expectedRevision: episode.unit.revision, changes: [{ field: "layerId", value: "intentions" }] }, options as never);
      expect(changed).toMatchObject({ ok: true });
      const record = f.records.record(f.epoch.epochId, "character", episode.unit.memoryId)!;
      expect(record.policy.retention).toEqual({ kind: "expiring", expiresAt: new Date(Date.parse(AT) + days * DAY).toISOString() });
      await run.tools.retain!.execute!({ content: `${label} direct`, layer: "intentions", context: null }, options as never);
      const direct = f.repo.list({ epochId: f.epoch.epochId, characterId: "taki" }).find((item) => item.unit.text === `${label} direct`)!;
      expect(direct.policy.retention.kind === "expiring" &&
        Date.parse(direct.policy.retention.expiresAt!) - Date.parse(direct.provenance.capturedAt)).toBe(days * DAY);
    }
    const explicit = await seed(f, "fixed-expiry", "2027-01-01T00:00:00.000Z");
    const result = await f.provider.captureRetention(1).mutate(f.context("same-layer"), { kind: "edit", bankId: "character",
      memoryId: explicit, expectedRevision: 1, patch: { layerId: "intentions" } });
    expect(result).toMatchObject({ ok: true, data: { record: { policy: { retention: { expiresAt: "2027-01-01T00:00:00.000Z" } } } } });
  });

  it("retention facades preserve retrieval and vector-health ownership", () => {
    const f = fixture(); const captured = f.provider.captureRetention(4);
    expect(captured.capabilities).toBe(f.provider.capabilities);
    expect(captured.recall).toBe(f.provider.recall);
    expect(captured.ingest).toBe(f.provider.ingest);
    expect(captured.retain).toBe(f.provider.retain);
    expect(captured.retainObserved).toBe(f.provider.retainObserved);
    expect(Object.isFrozen(captured)).toBe(true);
  });

  it("trusted observed writes use their explicitly captured retention days", () => {
    const f = fixture();
    const result = writeCanonicalObservedMemory({ provider: f.provider, epochId: f.epoch.epochId,
      intentionsDefaultDays: 6, banks: (characterId) => ensureCanonicalLocalBanks({ authority: f.authority, epochId: f.epoch.epochId, characterId }) },
    { characterId: "taki", type: "intentions", content: "observed next plan", importance: 3, origin: "observed" });
    const record = f.records.record(f.epoch.epochId, "character", result.id)!;
    expect(record.policy.retention.kind === "expiring" &&
      Date.parse(record.policy.retention.expiresAt!) - Date.parse(record.provenance.capturedAt)).toBe(6 * DAY);
  });
});

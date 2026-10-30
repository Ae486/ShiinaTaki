import type { RetainRequest } from "@taki/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createCanonicalMemoryRepo } from "../db/canonical-memory-repo.ts";
import { createCanonicalMemoryMaintenanceRepo } from "../db/canonical-memory-maintenance-repo.ts";
import { createCanonicalMemorySparseRepo } from "../db/canonical-memory-sparse-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase } from "../db/sqlite.ts";
import { createLocalMemoryProvider, LOCAL_MEMORY_CAPABILITIES } from "./local-memory-provider.ts";
import { createIntlSegmenterTokenizer } from "./search-tokenizer.ts";

const AT = "2026-09-11T00:00:00.000Z";
const close: Array<() => void> = [];
afterEach(() => { for (const dispose of close.splice(0)) dispose(); });

function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  close.push(() => db.close());
  const authority = createCanonicalMemoryAuthorityRepo(db);
  const epoch = authority.initializeLocalAuthority(AT);
  authority.createBank({ authorityEpochId: epoch.epochId, bankId: "character", scope: { kind: "character", characterId: "taki" },
    name: "Taki", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "test", config: {} });
  const records = createCanonicalMemoryRepo(db);
  const provider = createLocalMemoryProvider({ authority, records, sparse: createCanonicalMemorySparseRepo(db),
    tokenizer: createIntlSegmenterTokenizer({ stoplist: true }), now: () => AT });
  const context = { authorityEpochId: epoch.epochId, requestId: "observed-image", actor: "background-policy" as const };
  const request: RetainRequest = { bankId: "character", content: "[image] blue sky above a lake", context: null,
    timestamp: AT, tags: [], entities: [], metadata: {}, observationScopes: null, documentId: null,
    strategy: null, updateMode: "replace", provenance: { actor: "system", origin: "machine-observed", characterId: "taki",
      timelineFromSeq: null, timelineToSeq: null, capturedAt: AT, sanitized: true, sourceRef: null },
    policy: { layerId: "episodes", importance: 4, visibility: "retrieved", disclosure: null, origin: "observed",
      emotionalWeight: null, retention: { kind: "importance-decay", archiveBelowImportance: 4, afterDays: 90 }, policyVersion: 1 } };
  return { db, epoch, authority, records, provider, context, request };
}

describe("trusted Local observed-source adapter", () => {
  it("commits synchronously through canonical retain, preserves observed provenance and reuses the exact receipt", async () => {
    const f = fixture();
    const result = f.provider.retainObserved(f.context, f.request);
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.status).toBe("completed");
    expect(f.provider.retainObserved(f.context, f.request)).toEqual(result);
    expect(f.db.prepare("SELECT memory_id FROM canonical_memory_units").all()).toHaveLength(1);
    const record = f.records.record(f.epoch.epochId, "character", result.memories[0]!.memoryId);
    expect(record?.unit.text).toBe(f.request.content);
    expect(record?.policy.origin).toBe("observed");
    expect(record?.provenance).toMatchObject({ origin: "machine-observed", timelineFromSeq: null, timelineToSeq: null });
    const recalled = await f.provider.recall({ ...f.context, requestId: "recall" }, { bankId: "character", query: "lake",
      queryTimestamp: null, budget: "low", limit: 5, maxTokens: 200, factTypes: ["experience"], layerIds: [], includeInvalidated: false });
    expect(recalled.ok).toBe(true);
    if (!recalled.ok) throw new Error("recall failed");
    expect(recalled.data.hits[0]?.record.unit.text).toContain("<untrusted-observation");
    expect(await f.provider.capabilities()).toEqual(LOCAL_MEMORY_CAPABILITIES);
  });

  it("refuses foreground impersonation, primary provenance, over-cap policy and credential-bearing observed text", () => {
    const f = fixture();
    expect(() => f.provider.retainObserved({ ...f.context, actor: "foreground-agent" }, f.request)).toThrow("MEMORY_INVALID_REQUEST");
    expect(() => f.provider.retainObserved(f.context, { ...f.request, provenance: { ...f.request.provenance, origin: "auto-gate" } })).toThrow("MEMORY_INVALID_REQUEST");
    expect(() => f.provider.retainObserved(f.context, { ...f.request, policy: { ...f.request.policy, importance: 10 } })).toThrow("MEMORY_INVALID_REQUEST");
    expect(() => f.provider.retainObserved(f.context, { ...f.request, content: "password: PRIVATE_SCREEN_SECRET" })).toThrow("MEMORY_INVALID_REQUEST");
    expect(f.db.prepare("SELECT * FROM canonical_memory_sources").all()).toEqual([]);
    expect(f.db.prepare("SELECT * FROM canonical_memory_operation_receipts").all()).toEqual([]);
  });

  it("excludes hidden records from sparse and vector recall while preserving identity and restoring retrieval on unhide", async () => {
    const f = fixture();
    const retained = f.provider.retainObserved(f.context, f.request);
    const memoryId = retained.memories[0]!.memoryId;
    const maintenance = createCanonicalMemoryMaintenanceRepo(f.db);
    const target = { epochId: f.epoch.epochId, bankId: "character", characterId: "taki", memoryId, now: AT };
    maintenance.policyEdit({ ...target, requestId: "hide", expectedRevision: 1, patch: { visibility: "hidden" } });
    const search = vi.fn(async () => [{ memoryId, score: 1 }]);
    const vector = createLocalMemoryProvider({ authority: f.authority, records: f.records,
      sparse: createCanonicalMemorySparseRepo(f.db), tokenizer: createIntlSegmenterTokenizer({ stoplist: true }),
      vector: { status: async () => "ready", search, scheduleUpsert: () => undefined,
        scheduleDelete: () => undefined, rebuild: async () => undefined } });
    const query = { bankId: "character", query: "lake", queryTimestamp: null, budget: "low" as const,
      limit: 5, maxTokens: 200, factTypes: ["experience" as const], layerIds: [], includeInvalidated: false as const };
    for (const provider of [f.provider, vector]) {
      await expect(provider.recall({ ...f.context, requestId: "hidden-query" }, query)).resolves.toMatchObject({ ok: true, data: { returned: 0 } });
    }
    expect(search).toHaveBeenCalledOnce();
    expect(f.records.record(f.epoch.epochId, "character", memoryId)?.unit).toMatchObject({ memoryId, text: f.request.content, state: "valid" });
    maintenance.policyEdit({ ...target, requestId: "unhide", expectedRevision: 2, patch: { visibility: "retrieved" } });
    for (const provider of [f.provider, vector]) {
      const result = await provider.recall({ ...f.context, requestId: "visible-query" }, query);
      expect(result).toMatchObject({ ok: true, data: { returned: 1 } });
      if (!result.ok) throw new Error("recall failed");
      expect(result.data.hits[0]?.record.unit.memoryId).toBe(memoryId);
    }
  });
});

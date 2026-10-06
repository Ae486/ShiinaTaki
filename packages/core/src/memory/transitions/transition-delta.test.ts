import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { HindsightTransitionDeltaResultSchema } from "@taki/shared";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createTransitionReentryFixture } from "../../testing/memory-transition-reentry-fixtures.ts";
import { captureTransitionLocal, assertTransitionLocalCurrent } from "../../db/memory-transition-local-capture.ts";
import { prepareTransitionDelta, validatePreparedDeltaResult } from "../../db/memory-transition-delta-repo.ts";
import { createCanonicalMemoryRepo } from "../../db/canonical-memory-repo.ts";
import { createCanonicalMemoryMaintenanceRepo } from "../../db/canonical-memory-maintenance-repo.ts";
import { createIntlSegmenterTokenizer } from "../search-tokenizer.ts";
import { executeTransitionDelta } from "./transition-delta-execution.ts";
import { hindsightTransitionHash } from "../hindsight/hindsight-transition-proof.ts";
import type { HindsightTransitionClient } from "../hindsight/hindsight-transition-client.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { readCanonicalSource, upsertCanonicalSource } from "../../db/canonical-memory-maintenance-records.ts";
import { createStructuredMemoryBlockRepo } from "../../db/structured-memory-block-repo.ts";
import { compileTransitionNativeDelta } from "./transition-delta-rows.ts";

function setup() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  const fixture = createTransitionReentryFixture(db);
  const target = fixture.targets.find((entry) => entry.target.bank_id === "native-global")!;
  const capture = () => captureTransitionLocal(db, fixture.input);
  const prepare = (id: string) => prepareTransitionDelta(db, { ...fixture.input, captureId: id, localBankId: "global", ...target });
  const maintenance = createCanonicalMemoryMaintenanceRepo(db, createIntlSegmenterTokenizer({ stoplist: true }));
  const mutate = { epochId: fixture.candidate.targetEpochId, bankId: "global", memoryId: "logical-unit", characterId: null,
    expectedRevision: 1, requestId: "change-policy", now: "2026-10-01T00:00:01.000Z" };
  return { db, fixture, target, capture, prepare, maintenance, mutate };
}
describe("W3 durable complete reentry delta", () => {
  it("captures the real final set, reuses unchanged bodies and persists a single exact request", () => {
    const test = setup();
    try {
      const capture = test.capture(); const first = test.prepare(capture.captureId);
      expect(first.request.native.every((entry) => entry.disposition === "reuse")).toBe(true);
      expect(first.request.rows.documents).toEqual([]); expect(first.request.rows.memory_units).toEqual([]);
      expect(first.request.application.filter((entry) => entry.disposition === "upsert")).toHaveLength(1); // genuinely unbound derived policy
      expect(test.prepare(capture.captureId)).toEqual(first); expect(test.capture()).toEqual(capture);
      expect(test.db.prepare("SELECT count(*) AS n FROM memory_transition_preparations").get()?.n).toBe(1);
    } finally { test.db.close(); }
  });
  it("policy-only changes advance actual Local policy version while retaining native ID/revision/body", () => {
    const test = setup();
    try {
      const changed = test.maintenance.policyEdit({ ...test.mutate, patch: { visibility: "retrieved", importance: 6 } });
      expect(changed.record.policy.policyVersion).toBe(8);
      const capture = test.capture(); const prepared = test.prepare(capture.captureId);
      const native = prepared.request.native.find((entry) => entry.source.source_id === "logical-unit")!;
      expect(native.disposition).toBe("reuse"); expect(native.target?.object_id).toBe("native-logical-unit");
      const application = prepared.request.application.find((entry) => entry.key.artifact_id === "logical-unit")!;
      expect(application.disposition).toBe("upsert");
      expect(application.body?.artifact_kind === "memory_evidence" && application.body.body.policy.policyVersion).toBe(8);
      expect(application.body?.artifact_kind === "memory_evidence" && application.body.body.original_record?.unit.updatedAt).toBe(test.mutate.now);
    } finally { test.db.close(); }
  });
  it("keeps native content/lifecycle/proof changes distinct from policy bookkeeping", () => {
    const test = setup();
    try {
      createCanonicalMemoryRepo(test.db).edit({ ...test.mutate, requestId: "edit", requestHash: "c".repeat(64),
        patch: { text: "A controlled Local content edit" }, searchTerms: "controlled" });
      const prepared = test.prepare(test.capture().captureId);
      const row = prepared.request.native.find((entry) => entry.source.source_id === "logical-unit")!;
      expect(row.disposition).toBe("upsert"); expect(row.target?.object_id).toBe("native-logical-unit");
      expect(prepared.request.rows.memory_units).toHaveLength(1);
      expect(prepared.request.rows.memory_units[0]?.text).toBe("A controlled Local content edit");
    } finally { test.db.close(); }
  });
  it("ordinary layer-only edit preserves native reuse while keeping its actual Local edited timestamp", () => {
    const test = setup();
    try {
      const record = createCanonicalMemoryRepo(test.db).edit({ ...test.mutate, requestId: "layer-only", requestHash: "d".repeat(64),
        patch: {}, policy: { layerId: "activity", visibility: "retrieved", retention: { kind: "rolling-window", days: 7 } }, searchTerms: "quiet" }).record;
      expect(record.policy.policyVersion).toBe(8); expect(record.unit.editedAt).toBe(test.mutate.now);
      const prepared = test.prepare(test.capture().captureId);
      expect(prepared.request.native.find((row) => row.source.source_id === "logical-unit")?.disposition).toBe("reuse");
      const artifact = prepared.request.application.find((row) => row.key.artifact_id === "logical-unit")!;
      expect(artifact.body?.artifact_kind === "memory_evidence" && artifact.body.body.original_record?.unit.editedAt).toBe(test.mutate.now);
    } finally { test.db.close(); }
  });
  it("refuses stale Local source, foreign retired proof and configuration drift without preparing a partial command", () => {
    const test = setup();
    try {
      const capture = test.capture();
      expect(() => prepareTransitionDelta(test.db, { ...test.fixture.input, assertConfiguration: () => { throw new Error("config changed"); },
        captureId: capture.captureId, localBankId: "global", ...test.target })).toThrow("config changed");
      expect(() => prepareTransitionDelta(test.db, { ...test.fixture.input, captureId: capture.captureId, localBankId: "global",
        ...test.target, retired: { ...test.target.retired, bank_id: "foreign" } })).toThrow();
      test.maintenance.policyEdit({ ...test.mutate, patch: { importance: 6 } });
      expect(() => assertTransitionLocalCurrent(test.db, capture)).toThrow("MEMORY_TRANSITION_STALE");
      expect(() => test.prepare(capture.captureId)).toThrow("MEMORY_TRANSITION_STALE");
      expect(test.db.prepare("SELECT count(*) AS n FROM memory_transition_preparations").get()?.n).toBe(0);
    } finally { test.db.close(); }
  });
  it("uses real hard-delete/snapshot/retired-source evidence and refuses missing history", () => {
    const test = setup();
    try {
      const derived = test.fixture.candidate.state.records.find((row) => row.unit.factType === "observation")!;
      const source = readCanonicalSource(test.db, { epochId: test.mutate.epochId, bankId: "global", documentId: "document-logical-unit" })!;
      // Exercise the real source writer before the actual retention producer. A
      // later retirement proves identity/absence; it does not invent an archive of these transient bytes.
      test.db.transaction(() => upsertCanonicalSource(test.db, { ...source, retainedText: "Changed before actual expiry",
        revision: source.revision + 1, updatedAt: test.mutate.now }, source.revision + 1));
      const retiredAt = "2026-11-01T00:00:00.000Z";
      for (const memoryId of [derived.unit.memoryId, "logical-unit"]) {
        const current = test.maintenance.record({ ...test.mutate, memoryId })!;
        const changed = test.maintenance.policyEdit({ ...test.mutate, memoryId, expectedRevision: current.unit.revision,
          requestId: `rolling-${memoryId}`, patch: { layerId: "activity", retention: { kind: "rolling-window", days: 1 } } });
        test.maintenance.hardDeleteRolling({ ...test.mutate, memoryId, expectedRevision: changed.record.unit.revision,
          requestId: `delete-${memoryId}`, now: retiredAt });
      }
      const capture = test.capture(); const prepared = test.prepare(capture.captureId);
      expect(prepared.request.native.filter((row) => row.disposition === "delete")).toHaveLength(3);
      expect(prepared.request.native.filter((row) => row.disposition === "delete").every((row) => row.retirement?.reason === "expired")).toBe(true);
      expect(capture.state.history.some((row) => row.table === "canonical_memory_retired_sources")).toBe(true);
      const compile = (history: typeof capture.state.history) => compileTransitionNativeDelta({ capture: { ...capture, state: { ...capture.state, history } },
        baseline: test.fixture.candidate, localBankId: "global", nativeBankId: "native-global",
        mappings: test.fixture.candidate.mappings.filter((row) => row.localBankId === "global") });
      expect(() => compile([])).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      expect(() => compile(capture.state.history.filter((row) => row.table !== "canonical_memory_retired_sources"))).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
    } finally { test.db.close(); }
  });
  it("captures a new Source/record and new Block without replacing unchanged native objects", () => {
    const test = setup();
    try {
      const made = test.fixture.local.make({ memoryId: "new-current-unit" });
      const epoch = test.mutate.epochId;
      createCanonicalMemoryRepo(test.db).retain({ epochId: epoch, bankId: "global", requestId: "new-current-source", requestHash: "e".repeat(64),
        source: { ...made.source, authorityEpochId: epoch }, unit: { ...made.unit, authorityEpochId: epoch },
        policy: { ...made.policy, authorityEpochId: epoch }, searchTerms: "new" });
      createStructuredMemoryBlockRepo(test.db).replace({ blockId: "user-card", scope: { kind: "global", characterId: null },
        content: "Current Local user card", actor: "user", now: test.mutate.now, expectedEpochId: epoch, expectedRevision: 0 });
      const prepared = test.prepare(test.capture().captureId);
      expect(prepared.request.native.filter((row) => row.target === null).map((row) => row.source.source_id).sort())
        .toEqual(["document-new-current-unit", "new-current-unit"]);
      expect(prepared.request.native.filter((row) => row.target !== null).every((row) => row.disposition === "reuse")).toBe(true);
      expect(prepared.request.application.find((row) => row.key.artifact_kind === "block")?.body?.artifact_kind).toBe("block");
    } finally { test.db.close(); }
  });
  it("compiles a source-only edit independently from unchanged native unit revisions", () => {
    const test = setup();
    try {
      const source = readCanonicalSource(test.db, { epochId: test.mutate.epochId, bankId: "global", documentId: "document-logical-unit" })!;
      test.db.transaction(() => upsertCanonicalSource(test.db, { ...source, retainedText: "Current independent Source body",
        metadata: { ...source.metadata, changed: true }, revision: source.revision + 1, updatedAt: test.mutate.now }, source.revision + 1));
      const prepared = test.prepare(test.capture().captureId);
      expect(prepared.request.rows.documents).toHaveLength(1); expect(prepared.request.rows.memory_units).toHaveLength(0);
      expect(prepared.request.rows.documents[0]?.original_text).toBe("Current independent Source body");
      expect(prepared.request.native.find((row) => row.source.source_id === "logical-unit")?.disposition).toBe("reuse");
    } finally { test.db.close(); }
  });
  it("recovers an exact historical native result before POST and rejects foreign mapping inventory", async () => {
    const test = setup();
    try {
      const prepared = test.prepare(test.capture().captureId);
      const result = makeResult(prepared);
      const client = { transitionDelta: vi.fn().mockResolvedValue(result), applyTransitionDelta: vi.fn() } as unknown as HindsightTransitionClient;
      const execute = () => executeTransitionDelta(test.db, { ...test.fixture.input, preparationId: prepared.preparationId,
        executor: prepared.request.executor, client, request: () => ({ timeoutMs: 1000 }) });
      expect((await execute()).result).toEqual(result); expect((await execute()).result).toEqual(result);
      expect(client.transitionDelta).toHaveBeenCalledTimes(1); expect(client.applyTransitionDelta).not.toHaveBeenCalled();
      const corrupt = { ...result, mappings: result.mappings.slice(1) };
      corrupt.result_hash = hindsightTransitionHash(Object.fromEntries(Object.entries(corrupt).filter(([key]) => key !== "result_hash")));
      expect(() => validatePreparedDeltaResult(prepared, corrupt)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
    } finally { test.db.close(); }
  });
});
function makeResult(prepared: ReturnType<typeof prepareTransitionDelta>) {
  const request = prepared.request;
  const body = { protocol: "taki-transition-v1", operation_id: request.operation_id, transition_id: prepared.transitionId,
    bank_id: prepared.scope.nativeBankId, provider_lineage: prepared.target.request.provider_lineage,
    bank_generation: prepared.scope.nativeGeneration, request_hash: request.request_hash, baseline_proof_hash: request.baseline_proof_hash,
    unused_scope_hash: null, local_manifest_hash: request.local_manifest_hash, native_before_cursor: 3, native_through_cursor: 3, application_through_cursor: 1,
    mappings: request.native.map((row) => ({ source: row.source, target: row.target, disposition: "reused" })),
    artifacts: request.application.map((row) => ({ key: row.key, previous: row.expected_artifact, previous_body_hash: row.expected_body_hash,
      current: row.expected_artifact ?? { key: row.key, revision: 1, record_hash: hindsightTransitionHash([randomUUID(), W3_AT]) },
      source_record_hash: row.source_record_hash, disposition: row.disposition === "reuse" ? "reused" : "upserted" })) };
  return HindsightTransitionDeltaResultSchema.parse({ ...body, result_hash: hindsightTransitionHash(body) });
}

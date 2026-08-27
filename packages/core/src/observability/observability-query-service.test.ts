import { afterEach, describe, expect, it } from "vitest";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { createRunRepo } from "../db/run-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createObservabilityQueryService } from "./observability-query-service.ts";

const dbs: Database[] = []; afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
function fixture() { const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db); const events = createRunEventRepo(db); const runs = createRunRepo(db, events); const request = { triggerRequestId: "trigger", idempotencyKey: "idem", characterId: "taki", initiator: "scheduled" as const, provenance: { provider: "scheduled-task", taskId: "task" }, deliveryClass: "class_b" as const, contextMode: "autonomous" as const }; const capabilities = { providerId: "local", contractVersion: 1 as const, retain: true, recall: true, reflect: true, edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: true }; const snapshot = { schemaVersion: "run-snapshot.v1", characterId: "taki", initiator: request.initiator, provenance: request.provenance, deliveryClass: request.deliveryClass, contextMode: request.contextMode, modelProvider: "provider", modelId: "model", primaryHostId: "core", hosts: [], extensions: [], extensionSnapshotDigest: "a".repeat(64), governance: { policyGeneration: 1, registryRevision: 1, approvalGeneration: 1 }, memory: { providerId: "local", contractVersion: 1, capabilities, capabilityDigest: "b".repeat(64) }, contextDecision: { sourceCategories: [], tokenAccounting: "unknown" as const }, replayDecision: { status: "not_captured" as const }, budget: {}, implementation: { runtimeVersion: "test", schemaVersion: "v1" }, sourceRefs: [] }; const admitted = runs.admit({ runId: "run", request, snapshot, provider: "provider", modelId: "model", now: "2026-08-27T00:00:00.000Z" }); runs.start(admitted.run.runId, admitted.attempt.attemptId); runs.settle({ runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, outcome: "completed", retryability: "not_retryable", summary: "Delivered safely" }); return { db, events }; }

describe("ObservabilityQueryService", () => {
  it("returns semantic summaries and deterministic trajectory without opaque ids in primary labels", () => { const f = fixture(); const service = createObservabilityQueryService({ ...f, mode: () => "FEEDBACK_ONLY" }); const page = service.list({ characterId: "taki", limit: 25 }); expect(page.runs[0]).toMatchObject({ initiatorLabel: "Scheduled Task", deliveryLabel: "Class B delivery", summary: "Delivered safely" }); expect(page.runs[0]?.title).not.toContain("run"); const first = service.trajectory({ characterId: "taki", runKey: "run", afterSeq: 0, limit: 100 }); const second = service.trajectory({ characterId: "taki", runKey: "run", afterSeq: 0, limit: 100 }); expect(first.rows).toEqual(second.rows); });
  it("fails closed across Character boundaries and hides optional detail outside FULL_LOCAL", () => { const f = fixture(); const service = createObservabilityQueryService({ ...f, mode: () => "FEEDBACK_ONLY" }); expect(() => service.trajectory({ characterId: "other", runKey: "run", afterSeq: 0, limit: 10 })).toThrow(/FORBIDDEN/); const row = service.trajectory({ characterId: "taki", runKey: "run", afterSeq: 0, limit: 10 }).rows[0]!; expect(service.inspect({ characterId: "taki", runKey: "run", rowKey: row.rowKey }).detail).toEqual([]); });
  it("returns no monitor list while disabled without altering durable events", () => { const f = fixture(); const before = f.events.list("run"); const service = createObservabilityQueryService({ ...f }); expect(service.list({ characterId: "taki", limit: 25 }).runs).toEqual([]); expect(f.events.list("run")).toEqual(before); });
  it("rejects stale list and trajectory cursors instead of silently returning a misleading empty page", () => { const f = fixture(); const service = createObservabilityQueryService({ ...f, mode: () => "FEEDBACK_ONLY" }); expect(() => service.list({ characterId: "taki", cursor: { queuedAt: "2026-08-27T00:00:01.000Z", key: "run" }, limit: 25 })).toThrow(/CURSOR_STALE/); expect(() => service.trajectory({ characterId: "taki", runKey: "run", afterSeq: 99, limit: 10 })).toThrow(/CURSOR_STALE/); });
  it("returns a continuation cursor when a sparse filter reaches the bounded scan limit", () => {
    const f = fixture();
    const snapshotId = String(f.db.prepare("SELECT snapshot_id FROM runs WHERE run_id='run'").get()?.snapshot_id);
    const insert = f.db.prepare(`INSERT INTO runs (
      run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,
      delivery_class,state,state_version,snapshot_id,queued_at,operation_phase,operation_json,created_at,updated_at
    ) VALUES (:runId,'taki',:triggerId,:idempotencyKey,'hash','scheduled','{"provider":"scheduled-task","taskId":"task"}',
      'class_b','queued',0,:snapshotId,'2026-08-28T00:00:00.000Z','admitted','{}',
      '2026-08-28T00:00:00.000Z','2026-08-28T00:00:00.000Z')`);
    f.db.transaction(() => {
      for (let index = 0; index < 500; index += 1) {
        insert.run({ runId: `newer-${String(index).padStart(3, "0")}`, triggerId: `trigger-${index}`,
          idempotencyKey: `idem-${index}`, snapshotId });
      }
    });
    const service = createObservabilityQueryService({ ...f, mode: () => "FEEDBACK_ONLY", scanLimit: 500 });
    const first = service.list({ characterId: "taki", states: ["completed"], limit: 25 });
    expect(first.runs).toEqual([]);
    expect(first.nextCursor).toBeDefined();
    const second = service.list({ characterId: "taki", states: ["completed"], limit: 25, cursor: first.nextCursor });
    expect(second.runs.map((run) => run.key)).toEqual(["run"]);
  });
  it("keeps trajectory and inspector unavailable while the monitor mode is disabled", () => { const f = fixture(); const service = createObservabilityQueryService({ ...f }); expect(() => service.trajectory({ characterId: "taki", runKey: "run", afterSeq: 0, limit: 10 })).toThrow(/DISABLED/); expect(() => service.inspect({ characterId: "taki", runKey: "run", rowKey: f.events.list("run")[0]!.eventId })).toThrow(/DISABLED/); });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { createRunRepo } from "../db/run-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createObservabilityQueryService } from "./observability-query-service.ts";

const dbs: Database[] = []; afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
function fixture() { const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db); const events = createRunEventRepo(db); const runs = createRunRepo(db, events); const request = { triggerRequestId: "trigger", idempotencyKey: "idem", characterId: "taki", initiator: "scheduled" as const, provenance: { provider: "scheduled-task", taskId: "task" }, deliveryClass: "class_b" as const, contextMode: "autonomous" as const }; const capabilities = { providerId: "local", contractVersion: 1 as const, retain: true, recall: true, reflect: true, edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: true }; const snapshot = { schemaVersion: "run-snapshot.v1", characterId: "taki", initiator: request.initiator, provenance: request.provenance, deliveryClass: request.deliveryClass, contextMode: request.contextMode, modelProvider: "provider", modelId: "model", primaryHostId: "core", hosts: [], extensions: [], extensionSnapshotDigest: "a".repeat(64), governance: { policyGeneration: 1, registryRevision: 1, approvalGeneration: 1 }, memory: { providerId: "local", contractVersion: 1, capabilities, capabilityDigest: "b".repeat(64) }, contextDecision: { sourceCategories: [], tokenAccounting: "unknown" as const }, replayDecision: { status: "not_captured" as const }, budget: {}, implementation: { runtimeVersion: "test", schemaVersion: "v1" }, sourceRefs: [] }; const admitted = runs.admit({ runId: "run", request, snapshot, provider: "provider", modelId: "model", now: "2026-08-27T00:00:00.000Z" }); runs.start(admitted.run.runId, admitted.attempt.attemptId); runs.settle({ runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, outcome: "completed", retryability: "not_retryable", summary: "Delivered safely" }); return { db, events }; }

function appendDetailedEvents(f: ReturnType<typeof fixture>): void {
  const attemptId = String(f.db.prepare("SELECT attempt_id FROM run_attempts WHERE run_id='run'").get()?.attempt_id);
  const base = { runId: "run", attemptId, schemaVersion: "run-event.v1" as const, occurredAt: "2026-08-27T00:00:01.000Z" };
  f.events.appendMany([
    { ...base, category: "model", kind: "model.request.started", source: "core.model-observer", payload: { kind: "model.request.started", state: "running", effectId: "model-effect", callId: "model-call", provider: "provider-alt", modelId: "model-alt", startedAt: base.occurredAt } },
    { ...base, category: "model", kind: "model.response.settled", source: "core.model-observer", payload: { kind: "model.response.settled", state: "failed", effectId: "model-effect", callId: "model-call", provider: "provider-alt", modelId: "model-alt", outcome: "failed", finishReason: "error", durationMs: 20, timeToFirstOutputMs: 5, errorCode: "provider_finish_error" } },
    { ...base, category: "tool", kind: "tool.call.started", source: "core.tool-observer", payload: { kind: "tool.call.started", state: "running", effectId: "tool-effect-1", toolName: "echo", toolCallId: "tool-call-1", validationState: "accepted" } },
    { ...base, category: "tool", kind: "tool.result.settled", source: "core.tool-observer", payload: { kind: "tool.result.settled", state: "completed", effectId: "tool-effect-1", toolName: "echo", toolCallId: "tool-call-1", outcome: "completed", durationMs: 10 } },
    { ...base, category: "tool", kind: "tool.call.started", source: "core.tool-observer", payload: { kind: "tool.call.started", state: "running", effectId: "tool-effect-2", toolName: "broken", toolCallId: "tool-call-2", validationState: "accepted" } },
    { ...base, category: "tool", kind: "tool.result.settled", source: "core.tool-observer", payload: { kind: "tool.result.settled", state: "failed", effectId: "tool-effect-2", toolName: "broken", toolCallId: "tool-call-2", outcome: "failed", durationMs: 11, errorClass: "execution", errorCode: "tool_failed" } },
    { ...base, category: "usage", kind: "usage.settled", source: "core.effect-lifecycle", payload: { kind: "usage.settled", state: "settled", effectId: "model-effect", usageId: "usage", quality: "reported", inputTokens: 13, inputTokenDetails: { noCacheTokens: 8, cacheReadTokens: 5 }, outputTokens: 7, outputTokenDetails: { textTokens: 4, reasoningTokens: 3 }, totalTokens: 20 } },
    { ...base, category: "recovery", kind: "run.retry", source: "core.run-repo", payload: { kind: "run.retry", state: "retrying", attemptOrdinal: 2, retryOrdinal: 1, reasonCode: "context_overflow" } },
  ]);
}

describe("ObservabilityQueryService", () => {
  it("returns semantic summaries and deterministic trajectory without opaque ids in primary labels", () => { const f = fixture(); const service = createObservabilityQueryService({ ...f, mode: () => "FEEDBACK_ONLY" }); const page = service.list({ characterId: "taki", limit: 25 }); expect(page.runs[0]).toMatchObject({ initiatorLabel: "定时任务", deliveryLabel: "B 类交付", summary: "Delivered safely" }); expect(page.runs[0]?.title).not.toContain("run"); const first = service.trajectory({ characterId: "taki", runKey: "run", afterSeq: 0, limit: 100 }); const second = service.trajectory({ characterId: "taki", runKey: "run", afterSeq: 0, limit: 100 }); expect(first.rows).toEqual(second.rows); });
  it("fails closed across Character boundaries and hides technical detail outside FULL_LOCAL", () => { const f = fixture(); const service = createObservabilityQueryService({ ...f, mode: () => "FEEDBACK_ONLY" }); expect(() => service.trajectory({ characterId: "other", runKey: "run", afterSeq: 0, limit: 10 })).toThrow(/FORBIDDEN/); const row = service.trajectory({ characterId: "taki", runKey: "run", afterSeq: 0, limit: 10 }).rows[0]!; const inspector = service.inspect({ characterId: "taki", runKey: "run", rowKey: row.rowKey }); expect(inspector.detail).toEqual([{ label: "状态", value: "排队中" }]); expect(inspector.technical).toEqual([]); });
  it("returns no monitor list while disabled without altering durable events", () => { const f = fixture(); const before = f.events.list("run"); const service = createObservabilityQueryService({ ...f }); expect(service.list({ characterId: "taki", limit: 25 }).runs).toEqual([]); expect(f.events.list("run")).toEqual(before); });
  it("reports unavailable cache information instead of a synthetic miss or zero", () => {
    const f = fixture();
    const attemptId = String(f.db.prepare("SELECT attempt_id FROM run_attempts WHERE run_id='run'").get()?.attempt_id);
    const usage = f.events.append({
      runId: "run", attemptId, schemaVersion: "run-event.v1", category: "usage", kind: "usage.settled",
      occurredAt: "2026-08-27T00:00:01.000Z", source: "core.effect-lifecycle",
      payload: { kind: "usage.settled", state: "settled", effectId: "effect", usageId: "usage", quality: "unknown" },
    });
    const inspector = createObservabilityQueryService({ ...f, mode: () => "FEEDBACK_ONLY" })
      .inspect({ characterId: "taki", runKey: "run", rowKey: usage.eventId });
    expect(inspector.detail).toContainEqual({ label: "缓存信息", value: "缓存信息未提供" });
    expect(inspector.detail).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: expect.stringMatching(/命中|未命中/u) }),
    ]));
    expect(inspector.technical).toEqual([]);
  });
  it("projects detailed usage and filters while FULL_LOCAL retains only semantic Inspector sections", () => {
    const f = fixture(); appendDetailedEvents(f);
    const service = createObservabilityQueryService({ ...f, mode: () => "FULL_LOCAL" });
    const summary = service.list({ characterId: "taki", limit: 25 }).runs[0]!;
    expect(summary).toMatchObject({
      modelRequestCount: 1, toolCallCount: 2, toolResultCount: 2, toolSuccessCount: 1,
      toolFailureCount: 1, failureCount: 2, retryCount: 1,
      usage: {
        inputTokens: 13, inputTokenDetails: { noCacheTokens: 8, cacheReadTokens: 5 },
        outputTokens: 7, outputTokenDetails: { textTokens: 4, reasoningTokens: 3 }, totalTokens: 20,
        quality: "reported",
      },
    });
    for (const filter of [
      { provider: "provider-alt" }, { modelId: "model-alt" }, { toolName: "broken" },
      { errorCode: "tool_failed" }, { hasRetry: true }, { hasFailure: true }, { categories: ["tool"] as Array<"tool"> },
      { text: "PROVIDER_FINISH_ERROR" },
    ]) expect(service.list({ characterId: "taki", limit: 25, ...filter }).runs.map((run) => run.key)).toEqual(["run"]);
    const first = service.trajectory({ characterId: "taki", runKey: "run", afterSeq: 0, limit: 100 });
    const second = service.trajectory({ characterId: "taki", runKey: "run", afterSeq: 0, limit: 100 });
    expect(second.rows).toEqual(first.rows);
    expect(first.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "model", label: "模型响应结束", categoryLabel: "模型请求", outcome: "失败" }),
      expect.objectContaining({ kind: "tool", toolName: "broken", errorClass: "执行错误" }),
      expect.objectContaining({ kind: "usage", quality: "上游报告", totalTokens: 20 }),
    ]));
    const usageRow = first.rows.find((row) => row.kind === "usage")!;
    const inspector = service.inspect({ characterId: "taki", runKey: "run", rowKey: usageRow.rowKey });
    expect(inspector.technicalCollapsed).toBe(true);
    expect(inspector.technical).toEqual([]);
    expect(inspector.sections?.map((section) => section.key)).toEqual(["event", "usage"]);
    expect(inspector.detail).toEqual(expect.arrayContaining([
      { label: "缓存读取", value: "5" }, { label: "推理令牌", value: "3" }, { label: "总令牌", value: "20" },
    ]));
  });
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

  it("uses bounded SQL reads for pages, list filters, and exact Inspector lookup", () => {
    const f = fixture(); appendDetailedEvents(f);
    const service = createObservabilityQueryService({ ...f, mode: () => "FULL_LOCAL" });
    vi.spyOn(f.events, "list").mockImplementation(() => { throw new Error("unbounded event read"); });
    const tail = service.trajectory({ characterId: "taki", runKey: "run", afterSeq: 0, tail: true, limit: 3 });
    expect(tail.rows).toHaveLength(3);
    expect(tail.hasOlder).toBe(true);
    const page = service.trajectory({ characterId: "taki", runKey: "run", afterSeq: 0, beforeSeq: tail.olderCursor!.seq, limit: 3 });
    expect(page.rows.at(-1)!.seq).toBeLessThan(tail.rows[0]!.seq);
    expect(service.list({ characterId: "taki", limit: 25, toolName: "broken" }).runs).toHaveLength(1);
    const get = vi.spyOn(f.events, "get");
    service.inspect({ characterId: "taki", runKey: "run", rowKey: tail.rows[0]!.rowKey });
    expect(get).toHaveBeenCalledExactlyOnceWith("run", tail.rows[0]!.rowKey);
    expect(service.trajectory({ characterId: "taki", runKey: "run", afterSeq: 0, beforeSeq: 1, limit: 200 }))
      .toMatchObject({ rows: [], hasOlder: false, hasMore: false, cursor: { seq: 0 } });
  });

  it("checks Character ownership before stale forward or before cursor errors", () => {
    const f = fixture(); const service = createObservabilityQueryService({ ...f, mode: () => "FULL_LOCAL" });
    expect(() => service.trajectory({ characterId: "other", runKey: "run", afterSeq: 10_000, limit: 1 })).toThrow("OBSERVABILITY_FORBIDDEN");
    expect(() => service.trajectory({ characterId: "other", runKey: "run", afterSeq: 0, beforeSeq: 10_000, limit: 1 })).toThrow("OBSERVABILITY_FORBIDDEN");
    expect(() => service.inspect({ characterId: "other", runKey: "run", rowKey: "missing" })).toThrow("OBSERVABILITY_FORBIDDEN");
  });

  it("keeps SQL aggregate parity with complete sums, missing buckets, observed zero, and quality precedence", () => {
    const f = fixture();
    const attemptId = String(f.db.prepare("SELECT attempt_id FROM run_attempts WHERE run_id='run'").get()?.attempt_id);
    const service = createObservabilityQueryService({ ...f, mode: () => "FULL_LOCAL" });
    expect(service.list({ characterId: "taki", limit: 1 }).runs[0]!.usage).toEqual({});
    const appendUsage = (quality: "reported" | "estimated" | "unknown", details: object) => f.events.append({
      runId: "run", attemptId, schemaVersion: "run-event.v1", category: "usage", kind: "usage.settled",
      occurredAt: "2026-09-06T00:00:00.000Z", source: "core.effect-lifecycle",
      payload: { kind: "usage.settled", state: "settled", effectId: "effect", usageId: `usage-${f.events.tail("run").seq}`, quality, ...details },
    });
    appendUsage("reported", { inputTokens: 0, inputTokenDetails: { cacheReadTokens: 0 }, outputTokens: 0, totalTokens: 0 });
    expect(service.list({ characterId: "taki", limit: 1 }).runs[0]!.usage).toEqual({ inputTokens: 0, inputTokenDetails: { cacheReadTokens: 0 }, outputTokens: 0, totalTokens: 0, quality: "reported" });
    appendUsage("estimated", { inputTokens: 8, outputTokens: 2, totalTokens: 10 });
    expect(service.list({ characterId: "taki", limit: 1 }).runs[0]!.usage).toEqual({ inputTokens: 8, outputTokens: 2, totalTokens: 10, quality: "estimated" });
    appendUsage("unknown", {});
    expect(service.list({ characterId: "taki", limit: 1 }).runs[0]!.usage).toEqual({ quality: "unknown" });
  });
});

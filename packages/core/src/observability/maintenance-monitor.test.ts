import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAINTENANCE_MONITOR_METHODS, MaintenanceMonitorSnapshotSchema,
  type MaintenanceMonitorUpdate, type MonitorMode, type MaintenanceOperationRef } from "@taki/shared";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createMaintenanceMonitorRepo } from "../db/maintenance-monitor-repo.ts";
import { createMemoryOperationRepo } from "../db/memory-operation-repo.ts";
import { createCompactionOperationRepo } from "../db/compaction-operation-repo.ts";
import { createAuxiliaryUsageRepo } from "../db/auxiliary-usage-repo.ts";
import { createMaintenanceMonitorService } from "./maintenance-monitor-service.ts";
import { unknownAuxiliaryUsage } from "./auxiliary-usage-normalization.ts";
import { registerMaintenanceMonitorMethods } from "../server/methods/maintenance-monitor-methods.ts";
import { createMethodRegistry, type MethodContext } from "../server/method-registry.ts";

const NOW = "2026-11-06T01:00:00.000Z";
const LATER = "2026-11-06T01:05:00.000Z";
const END = "2026-11-06T01:10:00.000Z";
const opened: Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });
function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); opened.push(db);
  let mode: MonitorMode = "FULL_LOCAL";
  const repo = createMaintenanceMonitorRepo(db);
  const read = vi.fn(repo.read);
  const service = createMaintenanceMonitorService({ read, mode: () => mode });
  return { db, repo, read, service, mode: (next: MonitorMode) => { mode = next; service.changed(); } };
}
function tidy(db: Database, options: { at?: string; characterId?: string; state?: "completed" | "failed" | "outcome_unknown" } = {}) {
  const operationId = randomUUID(); const characterId = options.characterId ?? "taki";
  const repo = createMemoryOperationRepo(db, () => options.at ?? NOW);
  repo.insertAdmitted({ operationId, kind: "tidy", family: operationId, authorityEpochId: null, bootId: "test",
    request: { kind: "tidy", characterId }, producer: { kind: "tidy", characterId, authorityEpochId: null,
      progress: { reviewed: 2, remaining: 3, edits: 1, steps: 2 } } });
  if (options.state) repo.transition({ operationId, expectedState: "admitted", patch: { state: options.state,
    ...(options.state === "outcome_unknown" ? { reason: "core_restart" } : {}) } });
  return { kind: "tidy", operationId, characterId } as const;
}
function compact(operationId = "compact:test", now = NOW) {
  return { operationId, characterId: "taki", reason: "pressure" as const, selectedFromSeq: 1, selectedThroughSeq: 6,
    capturedTailSeq: 10, expectedSummaryRevision: 0, expectedSummaryThrough: 0, sourceDigest: "a".repeat(64),
    beforeTokens: 90, provider: "fixture", modelId: "test", owner: "test", now, expiresAt: END };
}
function operator(): MethodContext {
  return { connection: { state: { status: "authenticated", role: "operator", deviceId: "test", capabilities: [] } },
    notify: vi.fn(), onClose: vi.fn(), close: vi.fn() };
}
function call(db: Database, operation?: MaintenanceOperationRef) {
  const repo = createAuxiliaryUsageRepo(db); const callId = randomUUID();
  repo.start({ callId, taskId: null, source: "utility", label: "tidy", provider: "fixture", modelId: "test", startedAt: NOW,
    ...(operation ? { operation } : {}) });
  repo.settle({ callId, status: "completed", finishedAt: LATER, responseId: null,
    usage: { ...unknownAuxiliaryUsage(), inputTokens: 20, outputTokens: 5 } });
  return callId;
}

describe("maintenance read projection", () => {
  it("reads existing operation states without reconciling or fabricating historical associations", () => {
    const f = fixture(); const running = tidy(f.db); const failed = tidy(f.db, { state: "failed" });
    const interrupted = tidy(f.db, { state: "outcome_unknown" }); const other = tidy(f.db, { characterId: "yui" });
    call(f.db);
    const snapshot = f.repo.read({ characterId: "taki", selected: running });
    expect(snapshot.rows).toHaveLength(3);
    expect(snapshot.rows.find((row) => row.ref.operationId === failed.operationId)?.status).toBe("failed");
    expect(snapshot.rows.find((row) => row.ref.operationId === interrupted.operationId)?.status).toBe("interrupted");
    expect(snapshot.detail).toMatchObject({ association: "unavailable", calls: { totalCalls: 0,
      tokenCounts: { inputTokens: { sum: null, knownCount: 0 } } }, operation: { status: "running", progress: { reviewed: 2 } } });
    expect(createMemoryOperationRepo(f.db).get(running.operationId)?.state).toBe("admitted");
    expect(() => f.repo.read({ characterId: "taki", selected: { ...other, characterId: "taki" } })).toThrow("OBSERVABILITY_FORBIDDEN");
    expect(() => f.repo.read({ characterId: "taki", selected: other })).toThrow();
  });

  it("paginates bounded operations using the immutable first event even after a compaction retry", () => {
    const f = fixture(); const operations = createCompactionOperationRepo(f.db);
    const first = operations.begin(compact()); if (first.status !== "started") throw new Error("missing lease");
    operations.fail({ lease: first.lease, code: "SUMMARY_GENERATION_FAILED", now: NOW });
    for (let i = 0; i < 25; i++) tidy(f.db, { at: new Date(Date.parse(NOW) + 1000 + i).toISOString(), state: "completed" });
    const page = f.repo.read({ characterId: "taki" }); expect(page.rows).toHaveLength(25);
    operations.begin(compact("compact:test", LATER));
    const next = f.repo.read({ characterId: "taki", cursor: page.nextCursor! });
    expect(next.rows).toHaveLength(1); expect(next.nextCursor).toBeNull();
    expect(next.rows[0]).toMatchObject({ startedAt: NOW, status: "running", attempt: 2 });
    expect(() => f.repo.read({ characterId: "taki", cursor: { ...page.nextCursor!, startedAt: END } })).toThrow("OBSERVABILITY_CURSOR_STALE");
  });

  it("paginates calls while keeping whole-operation aggregates and strict association", () => {
    const f = fixture(); const selected = tidy(f.db); const other = tidy(f.db);
    for (let i = 0; i < 103; i++) call(f.db, selected);
    call(f.db, other); call(f.db);
    const first = f.repo.read({ characterId: "taki", selected });
    expect(first.detail?.calls).toMatchObject({ totalCalls: 103, tokenCounts: { inputTokens: { sum: 2060, knownCount: 103 } } });
    expect(first.detail?.calls.rows).toHaveLength(100);
    const next = f.repo.read({ characterId: "taki", selected, callCursor: first.detail!.calls.nextCursor! });
    expect(next.detail?.calls.rows).toHaveLength(3); expect(next.detail?.calls.totalCalls).toBe(103);
    expect(new Set([...first.detail!.calls.rows, ...next.detail!.calls.rows].map((row) => row.callId)).size).toBe(103);
    expect(MaintenanceMonitorSnapshotSchema.safeParse({ ...first, characterId: "yui" }).success).toBe(false);
    expect(MaintenanceMonitorSnapshotSchema.safeParse({ ...first, query: { characterId: "taki", selected: other } }).success).toBe(false);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM runs").get()?.n).toBe(0);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM run_usage").get()?.n).toBe(0);
  });
});

describe("maintenance subscription and producer commits", () => {
  it("publishes starts, failures and cancellation only after commit and isolates observers", async () => {
    const f = fixture(); const updates: MaintenanceMonitorUpdate[] = [];
    f.service.subscribe(operator().connection, { characterId: "taki" }, () => { throw new Error("closed socket"); });
    f.service.subscribe(operator().connection, { characterId: "taki" }, (value) => updates.push(value));
    const repo = createCompactionOperationRepo(f.db, { onChanged: f.service.changed });
    expect(() => f.db.transaction(() => { repo.begin(compact()); throw new Error("rollback"); })).toThrow("rollback");
    await Promise.resolve(); expect(updates).toEqual([]);
    const started = repo.begin(compact()); if (started.status !== "started") throw new Error("missing lease");
    await Promise.resolve(); expect(updates.at(-1)?.snapshot.rows[0]?.status).toBe("running");
    repo.fail({ lease: started.lease, code: "SUMMARY_GENERATION_FAILED", now: LATER });
    await Promise.resolve(); expect(updates.at(-1)?.snapshot.rows[0]?.status).toBe("failed");
    repo.begin(compact("compact:test", LATER)); repo.cancelActive({ characterId: "taki", now: LATER });
    await Promise.resolve(); expect(updates.at(-1)?.snapshot.rows[0]?.status).toBe("cancelled");
    const changed = vi.fn(); const usage = createAuxiliaryUsageRepo(f.db, { onChanged: changed }); const callId = randomUUID();
    const start = () => usage.start({ callId, taskId: null, source: "utility", label: "compact", provider: "fixture", modelId: "test", startedAt: NOW });
    expect(() => f.db.transaction(() => { start(); expect(changed).not.toHaveBeenCalled(); throw new Error("rollback"); })).toThrow();
    expect(changed).not.toHaveBeenCalled(); start(); expect(changed).toHaveBeenCalledOnce();
    usage.settle({ callId, status: "failed", finishedAt: LATER, responseId: null, usage: unknownAuxiliaryUsage() });
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("authorizes RPC membership, replaces queries, closes and withdraws disabled data without reads", async () => {
    const f = fixture(); tidy(f.db); const ctx = operator(); const registry = createMethodRegistry();
    registerMaintenanceMonitorMethods(registry, f.service);
    const request = { jsonrpc: "2.0" as const, id: 1, method: MAINTENANCE_MONITOR_METHODS.subscribe, params: { characterId: "taki" } };
    f.service.changed(); await Promise.resolve(); expect(f.read).not.toHaveBeenCalled();
    expect(await registry.dispatch(request, ctx)).toMatchObject({ result: { snapshot: { status: "ready" } } });
    await registry.dispatch(request, ctx); expect(ctx.onClose).toHaveBeenCalledTimes(1);
    f.mode("DISABLED"); f.read.mockClear(); await Promise.resolve(); expect(f.read).not.toHaveBeenCalled();
    expect(ctx.notify).toHaveBeenLastCalledWith(MAINTENANCE_MONITOR_METHODS.changed, expect.objectContaining({ snapshot: expect.objectContaining({ status: "disabled", rows: [] }) }));
    expect(await registry.dispatch(request, ctx)).toHaveProperty("error");
    f.mode("FULL_LOCAL"); f.read.mockImplementationOnce(() => { throw new Error("private detail"); });
    await Promise.resolve(); expect(JSON.stringify(vi.mocked(ctx.notify).mock.calls)).not.toContain("private detail");
    expect(ctx.notify).toHaveBeenLastCalledWith(MAINTENANCE_MONITOR_METHODS.changed, expect.objectContaining({ snapshot: expect.objectContaining({ status: "unavailable" }) }));
    vi.mocked(ctx.onClose).mock.calls[0]![0](); f.read.mockClear(); f.service.changed(); await Promise.resolve(); expect(f.read).not.toHaveBeenCalled();
    ctx.connection.state = { status: "awaiting" }; expect(await registry.dispatch(request, ctx)).toHaveProperty("error");
  });
});

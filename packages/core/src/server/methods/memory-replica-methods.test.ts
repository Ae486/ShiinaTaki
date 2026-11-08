import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMORY_OPERATION_METHODS, MEMORY_REPLICA_METHODS, type MemoryOperation, type MemoryReplicaChanged } from "@taki/shared";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createHindsightReplicaSchedulerRepo } from "../../db/hindsight-replica-scheduler-repo.ts";
import { createHindsightReplicaLeaseRepo } from "../../db/hindsight-replica-lease-repo.ts";
import { createHindsightReplicaScheduler, type HindsightReplicaScheduler } from "../../memory/hindsight/hindsight-replica-scheduler.ts";
import { fakeRuntime, fakeSetup, GLOBAL, CHARACTER, AT } from "../../memory/operations/memory-operation-fixtures.ts";
import type { MemoryOperationsRuntime } from "../../memory/operations/memory-operation-contract.ts";
import { createMemoryOperationService } from "../../memory/operations/memory-operation-service.ts";
import { createLogger } from "../../logging/logger.ts";
import { createConnectionSubscriptions, createMemoryOperationSubscriptions } from "../memory-operation-subscriptions.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { registerMemoryOperationMethods } from "./memory-operation-methods.ts";
import { registerMemoryReplicaMethods } from "./memory-replica-methods.ts";

const disposables: Array<{ db: Database; scheduler: HindsightReplicaScheduler }> = [];
afterEach(async () => { for (const f of disposables.splice(0)) { await f.scheduler.stop(); f.db.close(); } vi.useRealTimers(); });
const config = { automatic: false, autoIntervalMs: 120_000, fullReconciliationIntervalMs: 172_800_000 };

function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(AT);
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  const repo = createHindsightReplicaSchedulerRepo(db);
  const banks = [GLOBAL, CHARACTER]; const runtime: MemoryOperationsRuntime = fakeRuntime(banks, () => AT);
  const scheduler = createHindsightReplicaScheduler({ repo, banks: runtime.banks,
    replica: { leases: createHindsightReplicaLeaseRepo(db, () => new Date().toISOString()), checkpoint: () => undefined }, ownerId: "test",
    runner: { run: async () => { throw new Error("unused"); }, rebuild: async () => { throw new Error("unused"); } } });
  runtime.scheduler = scheduler; scheduler.start(); disposables.push({ db, scheduler });
  let live: MemoryOperationsRuntime | null = runtime;
  const transition = vi.fn<(family: string) => MemoryOperation | undefined>(() => undefined);
  const registry = createMethodRegistry(); const subscriptions = createConnectionSubscriptions<MemoryReplicaChanged>();
  const operations = createMemoryOperationSubscriptions(); const logger = createLogger("fatal");
  const owner = createMemoryOperationService({ db, live: () => live, setup: fakeSetup(), bootId: "test", logger, onChanged: operations.publish });
  registerMemoryOperationMethods(registry, { service: owner, subscriptions: operations, replicaSubscriptions: subscriptions, logger });
  registerMemoryReplicaMethods(registry, { context: { live: () => live, activeInFamily: transition }, subscriptions, logger });
  let id = 0;
  const context = (role: "operator" | "node" = "operator") => {
    const messages: Array<{ method: string; params: unknown }> = []; const closers: Array<() => void> = [];
    const ctx: MethodContext = { connection: { state: { status: "authenticated", deviceId: "test", role, capabilities: [] } },
      notify: (method, params) => messages.push({ method, params }), close: () => undefined, onClose: (cb) => closers.push(cb) };
    return { ctx, messages, close: () => closers.forEach((fn) => fn()) };
  };
  const dispatch = (ctx: MethodContext, params: unknown, method: string = MEMORY_REPLICA_METHODS.configure) => registry.dispatch({ jsonrpc: "2.0", id: ++id, method, params }, ctx);
  return { db, repo, runtime, scheduler, owner, subscriptions, transition, dispatch, context, setLive: (next: MemoryOperationsRuntime | null) => { live = next; } };
}

describe("memory.replica.configure operator path", () => {
  it("persists complete per-Bank config and notifies all operation subscribers without creating operation events", async () => {
    const f = fixture(); const first = f.context(); const second = f.context();
    await f.dispatch(first.ctx, {}, MEMORY_OPERATION_METHODS.subscribe); await f.dispatch(second.ctx, {}, MEMORY_OPERATION_METHODS.subscribe);
    expect(await f.dispatch(first.ctx, { bankId: "global", config })).toMatchObject({ result: { status: { bankId: "global", ...config } } });
    expect(f.repo.get("global")).toMatchObject(config);
    expect(f.repo.get("character")).toMatchObject({ automatic: true, autoIntervalMs: 21_600_000, fullReconciliationIntervalMs: 604_800_000 });
    expect(first.messages).toEqual([{ method: MEMORY_REPLICA_METHODS.changed, params: { bankId: "global" } }]);
    expect(second.messages).toEqual(first.messages); expect(f.owner.list({ includeTerminal: true, limit: 50 })).toEqual([]);
    first.close(); await f.dispatch(second.ctx, { bankId: "global", config: { ...config, automatic: true } });
    expect(first.messages).toHaveLength(1); expect(second.messages).toHaveLength(2); expect(f.subscriptions.count()).toBe(1);
  });

  it("rejects nodes, unknown Banks and incomplete edits before persistence or publication", async () => {
    const f = fixture(); const op = f.context(); const before = f.repo.get("global");
    await f.dispatch(op.ctx, {}, MEMORY_OPERATION_METHODS.subscribe);
    expect(await f.dispatch(f.context("node").ctx, { bankId: "global", config })).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
    expect(await f.dispatch(op.ctx, { bankId: "unknown", config })).toMatchObject({ error: { data: { reason: "MEMORY_OPERATION_BANK_UNKNOWN" } } });
    expect(await f.dispatch(op.ctx, { bankId: "global", config: { automatic: false } })).toMatchObject({ error: { message: "Invalid params" } });
    expect(f.repo.get("global")).toEqual(before); expect(op.messages).toEqual([]);
  });

  it("resolves current runtime per call and refuses absent, stopped, drifted and template-held runtimes", async () => {
    const f = fixture(); const op = f.context(); f.setLive(null);
    expect(await f.dispatch(op.ctx, { bankId: "global", config })).toMatchObject({ error: { data: { reason: "MEMORY_OPERATION_UNSUPPORTED" } } });
    f.setLive(f.runtime); await f.scheduler.stop();
    expect(await f.dispatch(op.ctx, { bankId: "global", config })).toMatchObject({ error: { data: { reason: "MEMORY_OPERATION_UNSUPPORTED" } } });
    f.scheduler.start();
    for (const code of ["MEMORY_AUTHORITY_MISMATCH", "HINDSIGHT_TEMPLATE_HOLD"]) {
      f.setLive({ ...f.runtime, banks: () => { throw new Error(code); } });
      expect(await f.dispatch(op.ctx, { bankId: "global", config })).toMatchObject({ error: { data: { reason: "MEMORY_OPERATION_UNSUPPORTED" } } });
    }
    f.setLive(f.runtime);
    expect(await f.dispatch(op.ctx, { bankId: "global", config })).toHaveProperty("result");
  });

  it("applies the active memory-transition guard before touching the runtime", async () => {
    const f = fixture(); const op = f.context();
    f.transition.mockReturnValue({ operationId: "11111111-1111-4111-8111-111111111111" } as MemoryOperation); f.setLive(null);
    expect(await f.dispatch(op.ctx, { bankId: "global", config })).toMatchObject({ error: { data: { reason: "MEMORY_OPERATION_BUSY", activeOperationId: "11111111-1111-4111-8111-111111111111" } } });
    expect(f.transition).toHaveBeenCalledWith("memory-transition"); expect(f.repo.get("global")?.automatic).toBe(true);
  });
});

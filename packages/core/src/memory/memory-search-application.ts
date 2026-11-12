/**
 * INPUT: selected Local/Legacy engine, accepted policies and existing maintenance submission port
 * OUTPUT: coherent search readiness and durable candidate application with shutdown cancellation
 * POS: core/memory — consumer adapter; all index/tokenizer writes remain in the engine's transaction
 */
import type { ConfigApplicationTracker } from "../config/config-application.ts";
import type { MemoryRuntimePolicy } from "../config/memory-runtime-policy.ts";
import type { MemoryEngine } from "./memory-engine.ts";
import type { MemorySearchIndexRuntime } from "./operations/memory-operation-contract.ts";

interface ApplicationInput {
  memory: MemoryEngine; policy: MemoryRuntimePolicy; environment(): Record<string, string | undefined>;
  epochId(): string | null; application?: ConfigApplicationTracker;
  onReady?(): void;
}
interface BuildState { current?: { stoplist: boolean; controller: AbortController } }

export function createMemorySearchApplication(input: ApplicationInput) {
  observeInitialSearch(input);
  const shutdown = new AbortController();
  let submit: ((stoplist: boolean) => Promise<void>) | undefined;
  let initialization: Promise<void> | undefined;
  const building: BuildState = {};
  const active = new Set<Promise<unknown>>();
  const prepared = () => input.policy.prepare("search", input.environment());
  const current = (): MemorySearchIndexRuntime => ({
    authorityEpochId: input.epochId(), desiredStoplist: () => prepared().parsed.stoplist,
    rebuild: (stoplist) => rebuild(input, { building, shutdown }, stoplist),
  });
  const apply = (): Promise<void> => {
    const wanted = prepared().parsed.stoplist;
    if (building.current && building.current.stoplist !== wanted) building.current.controller.abort();
    const status = input.memory.searchStatus?.();
    if (status?.ready && status.stoplist === wanted) return Promise.resolve();
    const work = submit ? submit(wanted) : current().rebuild(wanted).then(() => undefined);
    active.add(work);
    void work.finally(() => active.delete(work)).catch(() => undefined);
    return work;
  };
  const initialize = (): Promise<void> => {
    if (initialization) return initialization;
    prepared();
    // The durable policy, never desired config, describes the query/index pair currently exposed.
    const applied = input.memory.searchStatus?.().stoplist;
    input.application?.mark(["TAKI_MEMORY_STOPLIST"], "applying", { activeValue: applied === null ? null : applied ? "on" : "off" });
    initialization = Promise.resolve().then(apply);
    const work = initialization;
    if (input.application) void input.application.apply(["TAKI_MEMORY_STOPLIST"], () => work);
    void work.finally(() => { if (initialization === work) initialization = undefined; }).catch(() => undefined);
    return work;
  };
  return { current, apply,
    installSubmit: (next: typeof submit) => { submit = next; },
    ensureReady: async () => {
      if (input.memory.searchStatus?.().ready !== false) return;
      await initialize();
    },
    start: () => { if (input.policy.available("search")) void initialize().catch(() => undefined); },
    stop: async () => { shutdown.abort(); await Promise.allSettled([...active]); },
  };
}

function observeInitialSearch(input: ApplicationInput): void {
  const current = input.memory.searchStatus?.();
  const activeValue = current?.stoplist === null ? null : current?.stoplist ? "on" : "off";
  try {
    const desired = input.policy.prepare("search", input.environment()).parsed.stoplist;
    input.application?.mark(["TAKI_MEMORY_STOPLIST"], current?.ready && current.stoplist === desired ? "applied" : "applying", { activeValue });
  } catch {
    input.application?.mark(["TAKI_MEMORY_STOPLIST"], current?.ready ? "failed" : "unavailable", { activeValue,
      message: current?.ready ? "Invalid search policy; the previous usable index is retained." : "Invalid search policy; update this setting to initialize search." });
  }
}

async function rebuild(input: ApplicationInput, state: { building: BuildState; shutdown: AbortController }, stoplist: boolean) {
  const next = input.policy.prepare("search", input.environment());
  if (next.parsed.stoplist !== stoplist) throw new Error("MEMORY_SEARCH_APPLICATION_SUPERSEDED");
  const reconfigure = input.memory.reconfigureSearch;
  if (!reconfigure) throw new Error("MEMORY_CAPABILITY_UNSUPPORTED");
  if (state.building.current) throw new Error("MEMORY_OPERATION_BUSY");
  const candidate = { stoplist, controller: new AbortController() };
  const wasReady = input.memory.searchStatus?.().ready;
  state.building.current = candidate;
  try {
    const result = await reconfigure({ ...input.policy.construction(), stoplist }, AbortSignal.any([state.shutdown.signal, candidate.controller.signal]));
    input.policy.commit(next);
    if (!wasReady) input.onReady?.();
    return result;
  } finally { if (state.building.current === candidate) state.building.current = undefined; }
}

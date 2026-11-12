/**
 * INPUT:  captured Hindsight tools/automatic recall/initiative assembly and selected-runtime shutdown
 * OUTPUT: immutable consumer wrappers and a drain covering complete foreground invocations
 * POS:    core/memory/hindsight — process lifetime only; original schema, capability and Effect metadata stay intact
 */
import type { ToolSet } from "ai";
import type { CapturedMemoryRun } from "../canonical-memory-run.ts";
import type { CanonicalLocalWriteFence } from "../canonical-local-write-fence.ts";
import { bindInitiativeAssembly } from "../initiative-memory-assembly.ts";

export function createHindsightRuntimeConsumers(workFence?: CanonicalLocalWriteFence) {
  const active = new Set<Promise<unknown>>(); let stopped = false;
  const alive = () => {
    if (stopped) throw new Error("MEMORY_OPERATION_CANCELLED");
  };
  const track = <T>(action: () => T | PromiseLike<T>): Promise<T> => {
    let task: Promise<T>;
    try { alive(); task = Promise.resolve(action()); }
    catch (error) { return Promise.reject(error); }
    active.add(task); void task.then(() => active.delete(task), () => active.delete(task)); return task;
  };
  const wrapTools = (tools: ToolSet): ToolSet => Object.freeze(Object.fromEntries(Object.entries(tools).map(([name, tool]) => {
    const execute = tool.execute;
    if (!execute) return [name, tool];
    const wrapped = { ...tool, execute: (...args: Parameters<typeof execute>) => track(() => execute(...args)) };
    // Effect authority is a non-enumerable Symbol sidecar. A plain spread would
    // erase it and change Harness behavior despite an identical visible tool.
    const descriptors = Object.getOwnPropertyDescriptors(tool); delete descriptors.execute;
    Object.defineProperties(wrapped, descriptors);
    return [name, Object.freeze(wrapped)];
  })));
  const wrapRun = (run: CapturedMemoryRun): CapturedMemoryRun => {
    const recall = run.automaticRecall;
    const isCurrent = () => !stopped && run.isCurrent?.() !== false;
    return Object.freeze({ ...run, isCurrent, tools: wrapTools(run.tools),
      assembleInitiative: bindInitiativeAssembly(run.assembleInitiative, isCurrent),
      automaticRecall: recall ? (input: Parameters<NonNullable<CapturedMemoryRun["automaticRecall"]>>[0]) => track(() => recall(input)) : undefined });
  };
  const settle = async () => { while (active.size > 0) await Promise.allSettled([...active]); };
  return { wrapTools,
    capture: (action: () => Promise<CapturedMemoryRun>) => track(() => {
      const complete = async () => { const run = await action(); alive(); return wrapRun(run); };
      // Capture may synchronize several Banks in sequence. They inherit this one live owner, so a drain cannot
      // finish after the first Bank and then reject the second Bank of an already admitted capture.
      return workFence ? workFence.admit(complete) : complete();
    }),
    stop: () => { stopped = true; return settle(); }, settle };
}

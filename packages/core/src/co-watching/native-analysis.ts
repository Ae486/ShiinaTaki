/**
 * INPUT: one accepted Co-Watching binding and captured governed native tools
 * OUTPUT: shared native progression with Co-Watching status, waiting and protected input files
 * POS: core/co-watching — playback-specific adapter; the native job path also serves explicit URL analysis
 */
import { randomUUID } from "node:crypto";
import type { ToolExecutionOptions } from "ai";
import { coWatchingCurrent } from "./runtime-source.ts";
import { writeCoWatchingInput } from "./task-workspace.ts";
import type { CoWatchingBinding, CoWatchingRuntimeState } from "./runtime-types.ts";
import { advanceNativeAnalysis } from "./native-analysis-progress.ts";

export async function executeCoWatchingTool(state: CoWatchingRuntimeState, session: CoWatchingBinding, input: { key: string; args: unknown }): Promise<unknown> {
  if (!session.root || !coWatchingCurrent(state, session)) throw new Error("CO_WATCHING_ANALYSIS_UNAVAILABLE");
  const execute = state.deps.runs.context(session.root.run.runId)?.tools?.[input.key]?.execute as
    ((args: unknown, options: ToolExecutionOptions<unknown>) => unknown) | undefined;
  if (!execute) throw new Error("CO_WATCHING_ANALYSIS_UNAVAILABLE");
  const result = await execute(input.args, { toolCallId: randomUUID(), messages: [], abortSignal: session.controller?.signal, context: undefined });
  if (!coWatchingCurrent(state, session)) throw new Error("CO_WATCHING_SOURCE_LOST");
  return result;
}

function waitForNative(state: CoWatchingRuntimeState, session: CoWatchingBinding): false {
  clearTimeout(session.analysisPoll);
  // Status polling never invokes the model and never occupies the Character lane while waiting.
  session.analysisPoll = setTimeout(() => {
    if (session.closed) return;
    session.workRequired = true; state.schedule();
  }, 3_000 * Math.max(1, session.analysisFailures ?? 0));
  session.analysisPoll.unref();
  return false;
}

export async function advanceCoWatchingAnalysis(state: CoWatchingRuntimeState, session: CoWatchingBinding): Promise<boolean> {
  if (session.analysis) return true;
  session.status = "analyzing"; state.deps.onChanged(session.request.characterId);
  return advanceNativeAnalysis(session, {
    catalog: state.deps.catalog,
    execute: (input) => executeCoWatchingTool(state, session, input),
    wait: () => waitForNative(state, session),
    cancelled: () => session.closed || session.controller?.signal.aborted === true,
    async accept(verified) {
      session.native = verified.native;
      await writeCoWatchingInput(state.deps.workspaceRoot, session, verified.complete);
    },
  });
}

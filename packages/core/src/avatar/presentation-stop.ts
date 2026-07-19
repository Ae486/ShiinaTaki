/**
 * INPUT:  the ToolLoopAgent step list (via a StopCondition the chat agent composes into stopWhen)
 * OUTPUT: PRESENTATION_TOOL_NAMES + presentationTailStop — stop the loop after a spoken, presentation-only step
 * POS:    core/avatar — the fire-and-forget stop lever (1c); injected into the chat agent, no coupling back to it
 */
import type { StopCondition, ToolSet } from "ai";

/** Avatar tools whose result carries nothing to read back (their execute returns {ok:true}). */
export const PRESENTATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  "avatar_set_expression",
  "avatar_play_motion",
]);

// Stop when the just-finished step called ONLY presentation tools AND the turn already produced text: the model has
// both spoken and emoted, so the SDK's forced next generation would only pad. The `spoke` guard preserves
// express-first-then-talk (a tool-only step with no prior text does NOT stop — the reply still comes). A step that
// also called a real tool (screenshot, memory) is NOT presentation-only, so its result is still read back.
export const presentationTailStop: StopCondition<ToolSet> = ({ steps }) => {
  const last = steps.at(-1);
  if (!last || last.toolCalls.length === 0) return false;
  const presentationOnly = last.toolCalls.every((call) => PRESENTATION_TOOL_NAMES.has(call.toolName));
  if (!presentationOnly) return false;
  return steps.some((step) => step.text.trim().length > 0);
};

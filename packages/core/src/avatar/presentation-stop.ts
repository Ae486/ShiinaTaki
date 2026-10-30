/**
 * INPUT:  the ToolLoopAgent step list (via a StopCondition the chat agent composes into stopWhen)
 * OUTPUT: PRESENTATION_TOOL_NAMES + presentationTailStop — stop the loop after a spoken, presentation-only step
 * POS:    core/avatar — the fire-and-forget stop lever (1c) with the one-correction rule for invalid calls (D69);
 *         injected into the chat agent, no coupling back to it
 */
import type { StepResult, StopCondition, ToolSet } from "ai";

/** Avatar tools whose result carries nothing further to reason over (a Presentation Outcome, never data). */
export const PRESENTATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  "avatar_set_expression",
  "avatar_play_motion",
]);

// A presentation call the SDK marked invalid (schema miss) produced a tool-error the model has not read yet.
const invalidPresentation = (step: StepResult<ToolSet>): boolean =>
  step.toolCalls.some((call) => PRESENTATION_TOOL_NAMES.has(call.toolName) && call.invalid === true);

// Stop when the just-finished step called ONLY presentation tools AND the turn already produced text: the model has
// both spoken and emoted, so the SDK's forced next generation would only pad. The `spoke` guard preserves
// express-first-then-talk (a tool-only step with no prior text does NOT stop — the reply still comes). A step that
// also called a real tool (screenshot, memory) is NOT presentation-only, so its result is still read back.
// One correction per turn (D69): an invalid presentation call does not stop, so the model reads the validation error
// once; a second invalid presentation step in the same turn stops. A valid call's outcome never re-opens the loop.
export const presentationTailStop: StopCondition<ToolSet> = ({ steps }) => {
  const last = steps.at(-1);
  if (!last || last.toolCalls.length === 0) return false;
  const presentationOnly = last.toolCalls.every((call) => PRESENTATION_TOOL_NAMES.has(call.toolName));
  if (!presentationOnly) return false;
  if (invalidPresentation(last)) return steps.filter(invalidPresentation).length >= 2;
  return steps.some((step) => step.text.trim().length > 0);
};

/**
 * INPUT: retained delegation control result before SDK model-output conversion
 * OUTPUT: readable acknowledgement and exact current target without duplicated input or receipts
 * POS: core/agents — model projection only; the canonical result remains with its existing owner
 */
import { SubagentControlResultSchema } from "@taki/shared";
import { subagentScopedModelState, subagentWaitModelState } from "./subagent-model-state.ts";

export function subagentControlModelOutput(input: { output: unknown }) {
  const parsed = SubagentControlResultSchema.safeParse(input.output);
  if (!parsed.success) return { type: "text" as const, value: JSON.stringify(subagentScopedModelState(input.output)) };
  const { conversation, input: accepted, cancellationRequested } = parsed.data;
  const workInputId = accepted?.workInputId ?? conversation.activeWorkInputId ?? conversation.latestWorkInputId;
  return { type: "text" as const, value: JSON.stringify({ ok: true, worker: conversation.label, state: conversation.state,
    ...(accepted ? { accepted: true } : {}),
    ...(accepted?.kind === "work" ? { reporting: accepted.completionPolicy,
      nextAction: accepted.completionPolicy === "request_parent"
        ? "Reports will enter your inbox. Continue useful work or end this reply while they are pending; handle the reports when delivered."
        : "This work is silent. Inspect its retained reports when needed." } : {}),
    ...(accepted && accepted.materials.length && accepted.inputId !== workInputId ? { acceptedInputId: accepted.inputId } : {}),
    ...(cancellationRequested ? { cancellationRequested: true } : {}),
    ...(conversation.stopOrigin ? { stopOrigin: conversation.stopOrigin } : {}),
    ...(conversation.pendingRequest ? { pendingRequest: subagentWaitModelState(conversation.pendingRequest) } : {}),
    ...(conversation.activeWorkInputId && conversation.activeWorkInputId !== workInputId ? { activeWorkInputId: conversation.activeWorkInputId } : {}),
    ...(conversation.latestWorkInputId && conversation.latestWorkInputId !== workInputId ? { latestWorkInputId: conversation.latestWorkInputId } : {}),
    target: { subagentId: conversation.subagentId, workInputId, expectedRunId: conversation.activeRunId,
      expectedControlVersion: conversation.controlVersion } }) };
}

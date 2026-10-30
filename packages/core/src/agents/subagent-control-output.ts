/**
 * INPUT: retained delegation control result before SDK model-output conversion
 * OUTPUT: readable acknowledgement and exact current target without duplicated input or receipts
 * POS: core/agents — model projection only; the canonical result remains with its existing owner
 */
import { SubagentControlResultSchema } from "@taki/shared";

export function subagentControlModelOutput(input: { output: unknown }) {
  const parsed = SubagentControlResultSchema.safeParse(input.output);
  if (!parsed.success) return { type: "text" as const, value: JSON.stringify(input.output) };
  const { conversation, input: accepted, cancellationRequested } = parsed.data;
  const workInputId = accepted?.workInputId ?? conversation.activeWorkInputId ?? conversation.latestWorkInputId;
  return { type: "text" as const, value: JSON.stringify({ worker: conversation.label, state: conversation.state,
    acceptedInputId: accepted?.inputId ?? null, cancellationRequested, pendingRequest: conversation.pendingRequest,
    target: { subagentId: conversation.subagentId, workInputId, expectedRunId: conversation.activeRunId,
      expectedControlVersion: conversation.controlVersion } }) };
}

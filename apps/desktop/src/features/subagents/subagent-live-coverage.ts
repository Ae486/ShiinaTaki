/**
 * INPUT: loaded conversation entries and real stream item identity
 * OUTPUT: proof that every visible row in the matching committed step is fully available
 * POS: ui/subagents — presentation handoff only; a persisted watermark alone never clears observed text
 */
import type { SubagentConversationEntry, SubagentActivityReadResult } from "@taki/shared";

export function completePrivateItem(entries: SubagentConversationEntry[], identity: { messageId: string; itemId: string }): boolean {
  const mapped = entries.filter((entry) => entry.presentation?.messageId === identity.messageId
    && entry.presentation.references.some((ref) => ref.itemId === identity.itemId));
  return mapped.length > 0 && mapped.every((entry) => entry.batch && entry.batch.entrySeqs.every((seq) =>
    entries.some((candidate) => candidate.seq === seq && !candidate.body)));
}

export function privateItemPreview(entries: SubagentConversationEntry[], metadata: SubagentActivityReadResult | null, itemId: string): SubagentConversationEntry | undefined {
  if (!metadata || metadata.activity.status === "idle") return undefined;
  const runId = metadata.activity.runId;
  const attemptId = metadata.activity.attemptId;
  const step = metadata.itemSteps.find((item) => item.itemId === itemId)?.stepNumber;
  if (step === undefined) return undefined;
  return entries.find((entry) => entry.body && entry.kind === "message" && entry.message.runId === runId
    && entry.message.attemptId === attemptId && entry.message.stepNumber === step);
}

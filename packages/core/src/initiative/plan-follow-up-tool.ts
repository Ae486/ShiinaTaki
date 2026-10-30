/**
 * INPUT: the actual primary user append, mutable Run/Attempt and Intention service
 * OUTPUT: one automatic finite follow-up plan; no timer execution or promised utterance
 * POS: core/initiative — additive, idempotent, closed-world tool; source authority stays Core-owned
 */
import { tool, type ToolSet } from "ai";
import { InitiativeIntentionPlanSchema, type TimelineEntry } from "@taki/shared";
import type { TurnContext } from "../agents/chat-agent.ts";
import type { IntentionService } from "./intentions/intention-service.ts";

interface Dependencies {
  service: IntentionService; characterId: string; userEntry: TimelineEntry; turn?: TurnContext;
}

export function createPlanFollowUpTool(input: Dependencies): ToolSet {
  if (!input.turn?.runId || !input.turn.attemptId || input.turn.turnKind === "non-primary") return {};
  return { plan_follow_up: tool({
    description: "Form one automatic follow-up intention from the actual user message in this conversation when a later check-in would be useful. "
      + "A separate follow-up request or confirmation card is not needed; use judgment because ordinary messages do not all need a plan. "
      + "Supply a purpose and a finite inclusive-start/exclusive-end follow-up window; the default maximum active window is seven days, even for an event farther in the future. "
      + "The plan is a possibility to consider a fresh interaction, never a promise to speak or proof that an event happened. "
      + "Keep reportedEventTime null unless the user explicitly supplied that ISO timestamp; vague dates do not establish an exact event instant. "
      + "If a useful finite window cannot be chosen without inventing facts, abstain or clarify in the ordinary conversation. "
      + "Use the available scheduling tool for an explicit reminder/task request and the interaction-habit tool for a recurring rule. "
      + "A duplicate preserves the original deadline and terminal state; do not reword or retry to renew it. A refused result created no new plan.",
    inputSchema: InitiativeIntentionPlanSchema,
    execute(raw, options) {
      try {
        const { runId, attemptId } = input.turn ?? {};
        if (input.turn?.signal?.aborted || !runId || !attemptId || !input.service.registerPrimarySource({
          characterId: input.characterId, runId, attemptId, userTimelineSeq: input.userEntry.seq, userTimelineId: input.userEntry.id,
        })) return { ok: false, code: "FORBIDDEN", reason: "source_stale", message: "当前对话来源已失效，未创建跟进计划。" };
        const parsed = InitiativeIntentionPlanSchema.safeParse(raw);
        if (!parsed.success) return { ok: false, code: "FORBIDDEN", reason: "invalid_request", message: "请提供有明确起止时间的有限跟进窗口。" };
        const result = input.service.plan({ characterId: input.characterId, plan: parsed.data }, { runId, attemptId, toolCallId: options.toolCallId });
        if (result.status === "refused") return { ok: false, code: "FORBIDDEN", reason: result.reason, message: "未创建跟进计划，请检查来源和时间窗口；不要通过改写重复创建。" };
        const value = result.intention;
        return { ok: true, status: result.status, state: value.state, purpose: value.purpose,
          notBefore: value.notBefore, expiresAt: value.expiresAt, reportedEventTime: value.reportedEventTime, disposition: value.disposition };
      } catch { return { ok: false, code: "INTERNAL_ERROR", message: "跟进计划暂时无法保存，请继续当前对话。" }; }
    },
  }) };
}

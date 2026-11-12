/**
 * INPUT: original Attempt validity, offered candidates and captured Avatar vocabulary validation
 * OUTPUT: one staged structural decision and accepted-decision SDK stop predicate
 * POS: core/agents — trusted control only; no delivery, avatar execution or Run settlement
 */
import { tool, type StopCondition, type ToolSet } from "ai";
import { HeartbeatDecisionSchema, HeartbeatDecisionToolInputSchema,
  type HeartbeatDecision, type HeartbeatDecisionToolInput, type InitiativePresentation } from "@taki/shared";

export interface HeartbeatDecisionCollector {
  tools: ToolSet;
  stop: StopCondition<ToolSet>;
  decision(): HeartbeatDecision;
  close(): void;
}
export function createHeartbeatDecisionCollector(input: {
  candidateIds: readonly string[];
  isCurrent(): boolean;
  acceptsPresentation(presentation: InitiativePresentation): boolean;
  acceptsDecision?(decision: HeartbeatDecision): boolean;
}): HeartbeatDecisionCollector {
  let accepted: HeartbeatDecision | undefined; let open = true; let conflicting = false;
  return {
    tools: { heartbeat_respond: tool({
      description: "Finish this autonomous judgment by calling this tool with silent, express, or speak, including when staying silent. "
        + "Select only offered candidate IDs. Supply every field and use null for fields unused by the outcome. This stages a decision; it does not send it.",
      inputSchema: HeartbeatDecisionToolInputSchema,
      execute(candidate) {
        if (!open || !input.isCurrent()) return { ok: false, code: "DECISION_STALE" };
        const parsed = HeartbeatDecisionToolInputSchema.safeParse(candidate);
        if (!parsed.success) return { ok: false, code: "DECISION_INVALID" };
        const decision = toDecision(parsed.data);
        if (decision.selectedCandidateIds.some((id) => !input.candidateIds.includes(id))) return { ok: false, code: "DECISION_CANDIDATE_INVALID" };
        if (input.acceptsDecision?.(decision) === false) return { ok: false, code: "DECISION_OUTCOME_REFUSED" };
        if (decision.outcome !== "silent" && decision.presentation && !input.acceptsPresentation(decision.presentation)) return { ok: false, code: "DECISION_PRESENTATION_INVALID" };
        if (accepted && JSON.stringify(accepted) !== JSON.stringify(decision)) { conflicting = true; return { ok: false, code: "DECISION_CONFLICT" }; }
        accepted ??= decision;
        return { ok: true, accepted: true };
      },
    }) },
    stop: () => accepted !== undefined,
    decision() {
      if (conflicting) throw new Error("DECISION_CONFLICT");
      if (!open || !input.isCurrent()) throw new Error("DECISION_STALE");
      if (!accepted) throw new Error("DECISION_MISSING");
      return structuredClone(accepted);
    },
    close: () => { open = false; },
  };
}

function toDecision(input: HeartbeatDecisionToolInput): HeartbeatDecision {
  const common = { outcome: input.outcome, selectedCandidateIds: input.selectedCandidateIds };
  return HeartbeatDecisionSchema.parse(input.outcome === "silent" ? common
    : input.outcome === "express" ? { ...common, presentation: input.presentation }
      : { ...common, text: input.text, presentation: input.presentation, responseExpectation: input.responseExpectation });
}

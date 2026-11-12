/**
 * INPUT: transaction-local presentation/feedback facts and the canonical Run event authorities
 * OUTPUT: required delivery evidence plus post-commit publication in the existing Monitor stream
 * POS: core/observability — no additional Run, state machine or reading acknowledgement
 */
import type { RunEvent } from "@taki/shared";
import type { RunEventRepo } from "../db/run-event-repo.ts";
import type { RunEventLiveBus } from "../db/run-event-live.ts";
import type { FeedbackFact } from "../presence/initiative-feedback-repo.ts";

export function createPresenceEventBridge(input: { events: RunEventRepo; live: RunEventLiveBus }) {
  // A failed surrounding transaction must never leak its rolled-back event to live observers.
  // The repository passes only the very same fact objects whose transaction actually committed.
  const staged = new WeakMap<FeedbackFact, RunEvent>();
  return {
    commitFact(fact: FeedbackFact): void {
      const event = input.events.append({
        runId: fact.runId, attemptId: fact.attemptId, schemaVersion: "run-event.v2",
        category: "lifecycle", kind: fact.kind, source: "core.delivery", occurredAt: fact.occurredAt,
        payload: { kind: fact.kind, deliveryId: fact.deliveryId,
          state: fact.kind === "delivery.presented" ? "presented" : "feedback_settled",
          opportunityMs: fact.opportunityMs, ...(fact.disposition ? { disposition: fact.disposition } : {}) },
      });
      staged.set(fact, event);
    },
    publishFacts(facts: readonly FeedbackFact[]): void {
      const events: RunEvent[] = [];
      for (const fact of facts) {
        const event = staged.get(fact);
        if (event) events.push(event);
        staged.delete(fact);
      }
      input.live.publish(events);
    },
  };
}

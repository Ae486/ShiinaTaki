/**
 * INPUT:  PerceptionCardParams from a dispatched perception.card request + a card thunk (perception-layer.card)
 * OUTPUT: perceptionCardMethod(card) -> MethodDefinition (operator-only); one { current, recent, samplingStatus,
 *         pauseState } snapshot
 * POS:    core/server/methods — one file per WS method; a THIN delegation to perception/perception-card (the panel at
 *         #26 reads it). A one-shot READ, not a subscription: nothing publishes perception changes today, so a live
 *         feed would mean a change bus in both samplers — the UI polls this instead. Operator-only, NO Rust mirror.
 */
import { PERCEPTION_METHODS, PerceptionCardParamsSchema, type PerceptionCard, type PerceptionCardParams } from "@taki/shared";
import type { MethodDefinition } from "../method-registry.ts";

export function perceptionCardMethod(card: (now: number) => PerceptionCard): MethodDefinition<PerceptionCardParams> {
  return {
    method: PERCEPTION_METHODS.card,
    roles: ["operator"], // the "what am I observing right now" surface belongs to the human, not the agent
    paramsSchema: PerceptionCardParamsSchema,
    handler: (): PerceptionCard => card(Date.now()),
  };
}

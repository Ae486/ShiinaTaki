/**
 * INPUT:  PerceptionCardParams from a dispatched perception.card request + a card thunk (perception-layer.card)
 * OUTPUT: perceptionCardMethod(card) -> MethodDefinition (operator-only); one { current, recent, samplingStatus,
 *         pauseState } snapshot
 * POS:    core/server/methods — thin operator read over the existing Perception owner. Opt-in perception.changed
 *         hints trigger a covering card read; the snapshot carries no invalidation revision or new sampling action.
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

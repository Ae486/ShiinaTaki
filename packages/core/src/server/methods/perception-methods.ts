/**
 * INPUT:  the WS MethodRegistry + the composed PerceptionLayer
 * OUTPUT: registerPerceptionMethods(registry, perception) — pauseGet / pauseSet / card / subscribe
 * POS:    core/server/methods — the perception surface's single registration seam (invariant 7): one call from the
 *         composition root instead of one line per method, so adding a perception method never grows main.ts.
 */
import type { PerceptionLayer } from "../../perception/perception-layer.ts";
import type { MethodRegistry } from "../method-registry.ts";
import { perceptionCardMethod } from "./perception-card.ts";
import { perceptionPauseGetMethod } from "./perception-pause-get.ts";
import { perceptionPauseSetMethod } from "./perception-pause-set.ts";
import { perceptionSubscribeMethod } from "./perception-subscribe.ts";

export function registerPerceptionMethods(registry: MethodRegistry, perception: PerceptionLayer): void {
  registry.register(perceptionPauseGetMethod(perception.pause));
  registry.register(perceptionPauseSetMethod(perception.pause));
  registry.register(perceptionCardMethod((now) => perception.card(now)));
  registry.register(perceptionSubscribeMethod(perception.changes.subscriptions));
}

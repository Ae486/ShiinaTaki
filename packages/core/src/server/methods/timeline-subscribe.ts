/**
 * INPUT:  TimelineSubscribeParams from a dispatched timeline.subscribe request + a subscriptions registry
 * OUTPUT: timelineSubscribeMethod(subscriptions) -> MethodDefinition (operator-only); pushes timeline.appended
 * POS:    core/server/methods — one file per WS method; registers a sink + a ctx.onClose auto-unsubscribe
 */
import {
  TIMELINE_METHODS,
  TimelineSubscribeParamsSchema,
  type TimelineSubscribeParams,
  type TimelineSubscribeResult,
} from "@taki/shared";
import type { MethodDefinition } from "../method-registry.ts";
import type { TimelineSubscriptions } from "../timeline-subscriptions.ts";

export function timelineSubscribeMethod(subscriptions: TimelineSubscriptions): MethodDefinition<TimelineSubscribeParams> {
  return {
    method: TIMELINE_METHODS.subscribe,
    roles: ["operator"],
    paramsSchema: TimelineSubscribeParamsSchema,
    handler: ({ characterId }, ctx): TimelineSubscribeResult => {
      const { connection } = ctx;
      subscriptions.subscribe(characterId, connection, (entry) => ctx.notify(TIMELINE_METHODS.appended, entry));
      // No explicit unsubscribe method this slice (prd §2): auto-cleanup when the socket closes.
      ctx.onClose(() => subscriptions.unsubscribe(characterId, connection));
      return { status: "ok" };
    },
  };
}

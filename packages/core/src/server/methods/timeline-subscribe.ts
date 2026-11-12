/**
 * INPUT:  TimelineSubscribeParams from a dispatched timeline.subscribe request + a subscriptions registry
 * OUTPUT: operator-only Character subscription for timeline append/remove/commit and ordered chat activity
 * POS:    core/server/methods — one file per WS method; registers a sink + a ctx.onClose auto-unsubscribe
 */
import {
  TIMELINE_METHODS,
  CHAT_METHODS,
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
      subscriptions.subscribe(characterId, connection, {
        appended: (entry) => ctx.notify(TIMELINE_METHODS.appended, entry),
        removed: (ref) => ctx.notify(TIMELINE_METHODS.removed, ref),
        committed: (batch) => ctx.notify(TIMELINE_METHODS.committed, batch),
        activity: (event) => ctx.notify(CHAT_METHODS.activity, event),
      });
      // No explicit unsubscribe method this slice (prd §2): auto-cleanup when the socket closes.
      ctx.onClose(() => subscriptions.unsubscribe(characterId, connection));
      return { status: "ok" };
    },
  };
}

/**
 * INPUT:  empty perception.subscribe params and the Perception connection registry
 * OUTPUT: operator-only acknowledgement, content-free hints and one connection-close cleanup
 * POS:    core/server/methods — opt-in subscription only; no snapshot, capture, model call or pause mutation
 */
import {
  PERCEPTION_METHODS,
  PerceptionSubscribeParamsSchema,
  type PerceptionSubscribeParams,
  type PerceptionSubscribeResult,
} from "@taki/shared";
import type { PerceptionSubscriptions } from "../../perception/perception-subscriptions.ts";
import { appException } from "../app-error.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function perceptionSubscribeMethod(subscriptions: PerceptionSubscriptions): MethodDefinition<PerceptionSubscribeParams> {
  return {
    method: PERCEPTION_METHODS.subscribe,
    roles: ["operator"],
    paramsSchema: PerceptionSubscribeParamsSchema,
    handler: (_params, ctx): PerceptionSubscribeResult => {
      const { connection } = ctx;
      if (connection.state.status !== "authenticated") throw appException("NOT_AUTHENTICATED", "not authenticated");
      if (connection.state.role !== "operator") throw appException("FORBIDDEN", "perception subscription requires an operator");
      const added = subscriptions.subscribe(connection, (change) => ctx.notify(PERCEPTION_METHODS.changed, change));
      if (added) ctx.onClose(() => subscriptions.unsubscribe(connection));
      return { status: "ok" };
    },
  };
}

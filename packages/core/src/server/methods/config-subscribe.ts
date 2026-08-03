/**
 * INPUT:  ConfigSubscribeParams from a dispatched config.subscribe request + a ConfigSubscriptions registry
 * OUTPUT: configSubscribeMethod(subscriptions) -> MethodDefinition (operator-only); pushes config.changed frames
 * POS:    core/server/methods — one file per WS method; registers a sink + a ctx.onClose auto-unsubscribe
 */
import {
  CONFIG_METHODS,
  ConfigSubscribeParamsSchema,
  type ConfigSubscribeParams,
  type ConfigSubscribeResult,
} from "@taki/shared";
import type { ConfigSubscriptions } from "../../config/config-subscriptions.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function configSubscribeMethod(subscriptions: ConfigSubscriptions): MethodDefinition<ConfigSubscribeParams> {
  return {
    method: CONFIG_METHODS.subscribe,
    roles: ["operator"],
    paramsSchema: ConfigSubscribeParamsSchema,
    handler: (_params, ctx): ConfigSubscribeResult => {
      const { connection } = ctx;
      subscriptions.subscribe(connection, (change) => ctx.notify(CONFIG_METHODS.changed, change));
      // No explicit unsubscribe method: auto-cleanup when the socket closes (mirrors avatar/timeline.subscribe).
      ctx.onClose(() => subscriptions.unsubscribe(connection));
      return { status: "ok" };
    },
  };
}

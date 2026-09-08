/**
 * INPUT:  empty extension.subscribe params and the connection-keyed extension subscription registry
 * OUTPUT: operator-only acknowledgement, bounded change hints and one connection-close cleanup
 * POS:    core/server/methods — observation only; setup never reads, probes, reconnects or reconciles extensions
 */
import {
  EXTENSION_METHODS, ExtensionSubscribeParamsSchema,
  type ExtensionSubscribeParams, type ExtensionSubscribeResult,
} from "@taki/shared";
import type { ExtensionSubscriptions } from "../../extensions/extension-subscriptions.ts";
import { appException } from "../app-error.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function extensionSubscribeMethod(subscriptions: ExtensionSubscriptions): MethodDefinition<ExtensionSubscribeParams> {
  return {
    method: EXTENSION_METHODS.subscribe,
    roles: ["operator"],
    paramsSchema: ExtensionSubscribeParamsSchema,
    handler: (_params, ctx): ExtensionSubscribeResult => {
      const { connection } = ctx;
      if (connection.state.status !== "authenticated") throw appException("NOT_AUTHENTICATED", "not authenticated");
      if (connection.state.role !== "operator") throw appException("FORBIDDEN", "extension subscription requires an operator");
      const added = subscriptions.subscribe(connection, (change) => ctx.notify(EXTENSION_METHODS.changed, change));
      if (added) ctx.onClose(() => subscriptions.unsubscribe(connection));
      return { status: "ok" };
    },
  };
}

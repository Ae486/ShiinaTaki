/**
 * INPUT:  AvatarSubscribeParams from a dispatched avatar.subscribe request + an AvatarSubscriptions registry
 * OUTPUT: avatarSubscribeMethod(subscriptions) -> MethodDefinition (operator-only); pushes avatar.command frames
 * POS:    core/server/methods — one file per WS method; registers a sink + a ctx.onClose auto-unsubscribe
 */
import {
  AVATAR_METHODS,
  AvatarSubscribeParamsSchema,
  type AvatarSubscribeParams,
  type AvatarSubscribeResult,
} from "@taki/shared";
import type { AvatarSubscriptions } from "../../avatar/avatar-subscriptions.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function avatarSubscribeMethod(subscriptions: AvatarSubscriptions): MethodDefinition<AvatarSubscribeParams> {
  return {
    method: AVATAR_METHODS.subscribe,
    roles: ["operator"],
    paramsSchema: AvatarSubscribeParamsSchema,
    handler: ({ characterId }, ctx): AvatarSubscribeResult => {
      const { connection } = ctx;
      subscriptions.subscribe(characterId, connection, (command) => ctx.notify(AVATAR_METHODS.command, command));
      // No explicit unsubscribe method: auto-cleanup when the socket closes (mirrors timeline.subscribe).
      ctx.onClose(() => subscriptions.unsubscribe(characterId, connection));
      return { status: "ok" };
    },
  };
}

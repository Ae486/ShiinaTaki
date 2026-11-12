/**
 * INPUT:  AvatarOutcomeParams from a dispatched avatar.outcome request + AvatarSubscriptions + AvatarOutcomes
 * OUTPUT: avatarOutcomeMethod(deps) -> MethodDefinition (operator-only); FORBIDDEN unless the connection is subscribed
 *         to that character; otherwise records the report and returns { status: "ok" } (late/unknown logged at debug)
 * POS:    core/server/methods — one file per WS method; the Pet UI's Presentation Outcome return path (D80)
 */
import {
  AVATAR_METHODS,
  AvatarOutcomeParamsSchema,
  ErrorCodeSchema,
  type AvatarOutcomeParams,
  type AvatarOutcomeResult,
} from "@taki/shared";
import type { AvatarOutcomes } from "../../avatar/avatar-outcomes.ts";
import type { AvatarSubscriptions } from "../../avatar/avatar-subscriptions.ts";
import type { Logger } from "../../logging/logger.ts";
import { appException } from "../app-error.ts";
import type { MethodDefinition } from "../method-registry.ts";

export interface AvatarOutcomeMethodDeps {
  subscriptions: AvatarSubscriptions;
  outcomes: AvatarOutcomes;
  logger: Logger;
}

export function avatarOutcomeMethod(deps: AvatarOutcomeMethodDeps): MethodDefinition<AvatarOutcomeParams> {
  const log = deps.logger.child({ mod: "avatar" });
  return {
    method: AVATAR_METHODS.outcome,
    roles: ["operator"],
    paramsSchema: AvatarOutcomeParamsSchema,
    handler: ({ characterId, commandId, outcome, reason }, ctx): AvatarOutcomeResult => {
      // Only a connection that actually receives the character's commands may settle one — a stray operator socket
      // must not be able to relabel another window's playback.
      if (!deps.subscriptions.isSubscribed(characterId, ctx.connection)) {
        throw appException(ErrorCodeSchema.enum.FORBIDDEN, "connection is not subscribed to this character's avatar commands");
      }
      const status = deps.outcomes.report(commandId, { connection: ctx.connection, outcome, reason });
      if (status === "late" || status === "unknown_command") log.debug({ commandId, status }, "avatar outcome ignored");
      return { status: "ok" };
    },
  };
}

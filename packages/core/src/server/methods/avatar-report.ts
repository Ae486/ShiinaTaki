/**
 * INPUT:  AvatarReportParams from a dispatched avatar.report request + an AvatarVocabulary store
 * OUTPUT: avatarReportMethod(vocabulary) -> MethodDefinition (operator-only); records the model's motion/expression names
 * POS:    core/server/methods — one file per WS method; feeds the vocabulary the turn instructions inject (Option A, #16)
 */
import {
  AVATAR_METHODS,
  AvatarReportParamsSchema,
  type AvatarReportParams,
  type AvatarReportResult,
} from "@taki/shared";
import type { AvatarVocabulary } from "../../avatar/avatar-vocabulary.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function avatarReportMethod(vocabulary: AvatarVocabulary): MethodDefinition<AvatarReportParams> {
  return {
    method: AVATAR_METHODS.report,
    roles: ["operator"],
    paramsSchema: AvatarReportParamsSchema,
    handler: ({ characterId, motions, expressions, costume }): AvatarReportResult => {
      // The Pet UI re-reports on load / costume-swap; a set() fully replaces the character's prior vocabulary. The
      // costume id (undefined on a boot / drift self-heal report) drives the per-turn costume-change detection (1f).
      vocabulary.set(characterId, { motions, expressions }, costume);
      return { status: "ok" };
    },
  };
}

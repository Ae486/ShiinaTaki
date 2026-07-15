/**
 * INPUT:  CharacterImportParams from a dispatched character.import request + a CharacterImporter
 * OUTPUT: characterImportMethod(importer) -> MethodDefinition (operator-only); returns the imported character summary
 * POS:    core/server/methods — one file per WS method; a THIN delegation to the characters module. A structured import
 *         failure rides the app-error envelope with its clean-room code in error.data.reason; operator-only, NO Rust mirror
 */
import {
  CHARACTER_METHODS,
  CharacterImportParamsSchema,
  ErrorCodeSchema,
  type CharacterImportParams,
  type CharacterImportResult,
} from "@taki/shared";
import type { CharacterImporter } from "../../characters/character-import.ts";
import { CharacterImportError } from "../../characters/import-error.ts";
import { appException } from "../app-error.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function characterImportMethod(importer: CharacterImporter): MethodDefinition<CharacterImportParams> {
  return {
    method: CHARACTER_METHODS.import,
    roles: ["operator"], // importing a model into the Workspace is an operator concern (mirrors media.*)
    paramsSchema: CharacterImportParamsSchema,
    handler: async (params): Promise<CharacterImportResult> => {
      try {
        return await importer.import(params);
      } catch (error) {
        // A structured import refusal rides the app-error envelope (FORBIDDEN — same family as media-get's confinement
        // reject) with the precise clean-room code in error.data.reason. These import codes have no Rust-mirrored
        // ErrorCode, so they never extend ErrorCodeSchema. An unexpected error degrades via the registry's INTERNAL_ERROR.
        if (error instanceof CharacterImportError) {
          throw appException(ErrorCodeSchema.enum.FORBIDDEN, error.message, { reason: error.code });
        }
        throw error;
      }
    },
  };
}

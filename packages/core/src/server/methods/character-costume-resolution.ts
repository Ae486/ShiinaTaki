/**
 * INPUT:  CharacterCostumeResolutionParams (characterId + costume) from a dispatched request + store/charactersDir deps
 * OUTPUT: characterCostumeResolutionMethod(deps) -> MethodDefinition (operator-only); one costume's external-ref →
 *         characters-root rel-path map (null = no imported character supplies it), computed on demand (#18)
 * POS:    core/server/methods — one file per WS method; THIN delegation to costume-availability.costumeResolutionMap
 */
import {
  CHARACTER_METHODS,
  CharacterCostumeResolutionParamsSchema,
  type CharacterCostumeResolutionParams,
  type CharacterCostumeResolutionResult,
} from "@taki/shared";
import type { CharacterStore } from "../../characters/character-store.ts";
import { costumeResolutionMap } from "../../characters/costume-availability.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function characterCostumeResolutionMethod(deps: {
  store: CharacterStore;
  charactersDir: string;
}): MethodDefinition<CharacterCostumeResolutionParams> {
  return {
    method: CHARACTER_METHODS.costumeResolution,
    roles: ["operator"],
    paramsSchema: CharacterCostumeResolutionParamsSchema,
    handler: ({ characterId, costume }): CharacterCostumeResolutionResult => {
      const marker = deps.store.readMarker(characterId);
      // Absence degrades via the registry's generic path — exactly like character.costumes.
      if (!marker) throw new Error("character not found");
      const settingsFile = marker.settingsFilesByCostume[costume];
      // Marker membership doubles as the traversal gate: only import-derived costume names reach the fs join below.
      if (settingsFile === undefined) throw new Error("costume not found");
      return {
        resolution: costumeResolutionMap({ charactersDir: deps.charactersDir, characterId, costume, settingsFile }),
      };
    },
  };
}

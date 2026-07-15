/**
 * INPUT:  CharacterCostumesParams (characterId) from a dispatched character.costumes request + a CharacterStore
 * OUTPUT: characterCostumesMethod(store) -> MethodDefinition (operator-only); returns the character's costumes +
 *         settings filenames (so the renderer composes the asset URL without guessing the manifest name — prd §4.2)
 * POS:    core/server/methods — one file per WS method; a THIN delegation to character-store.readMarker; operator-only
 */
import {
  CHARACTER_METHODS,
  CharacterCostumesParamsSchema,
  type CharacterCostumesParams,
  type CharacterCostumesResult,
} from "@taki/shared";
import type { CharacterStore } from "../../characters/character-store.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function characterCostumesMethod(store: CharacterStore): MethodDefinition<CharacterCostumesParams> {
  return {
    method: CHARACTER_METHODS.costumes,
    roles: ["operator"],
    paramsSchema: CharacterCostumesParamsSchema,
    handler: ({ characterId }): CharacterCostumesResult => {
      const marker = store.readMarker(characterId);
      // Absence is not a refusal — an unknown character degrades via the registry's generic path (mirrors media-get).
      if (!marker) throw new Error("character not found");
      return {
        costumes: marker.costumes,
        defaultCostume: marker.defaultCostume,
        settingsFilesByCostume: marker.settingsFilesByCostume,
      };
    },
  };
}

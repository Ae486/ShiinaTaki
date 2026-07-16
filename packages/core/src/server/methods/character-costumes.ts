/**
 * INPUT:  CharacterCostumesParams (characterId) from a dispatched character.costumes request + store/charactersDir deps
 * OUTPUT: characterCostumesMethod(deps) -> MethodDefinition (operator-only); the character's costumes + settings
 *         filenames + per-costume availability, computed on demand (renderable flag + missing motions/packs, #18)
 * POS:    core/server/methods — one file per WS method; THIN delegation to character-store + costume-availability
 */
import {
  CHARACTER_METHODS,
  CharacterCostumesParamsSchema,
  type CharacterCostumesParams,
  type CharacterCostumesResult,
} from "@taki/shared";
import type { CharacterStore } from "../../characters/character-store.ts";
import { characterAvailability } from "../../characters/costume-availability.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function characterCostumesMethod(deps: {
  store: CharacterStore;
  charactersDir: string; // availability walks the tree directly — computed per request, never stored
}): MethodDefinition<CharacterCostumesParams> {
  return {
    method: CHARACTER_METHODS.costumes,
    roles: ["operator"],
    paramsSchema: CharacterCostumesParamsSchema,
    handler: ({ characterId }): CharacterCostumesResult => {
      const marker = deps.store.readMarker(characterId);
      // Absence is not a refusal — an unknown character degrades via the registry's generic path (mirrors media-get).
      if (!marker) throw new Error("character not found");
      return {
        costumes: marker.costumes,
        defaultCostume: marker.defaultCostume,
        settingsFilesByCostume: marker.settingsFilesByCostume,
        availability: characterAvailability({
          charactersDir: deps.charactersDir,
          characterId,
          settingsFilesByCostume: marker.settingsFilesByCostume,
        }),
      };
    },
  };
}

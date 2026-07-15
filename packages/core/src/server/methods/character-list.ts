/**
 * INPUT:  CharacterListParams (empty) from a dispatched character.list request + a CharacterStore
 * OUTPUT: characterListMethod(store) -> MethodDefinition (operator-only); returns every imported character's summary
 * POS:    core/server/methods — one file per WS method; a THIN delegation to character-store.list (reads character.json
 *         markers); feeds the switch affordance + reserved for the M5 roster; operator-only, NO Rust mirror
 */
import {
  CHARACTER_METHODS,
  CharacterListParamsSchema,
  type CharacterListParams,
  type CharacterListResult,
} from "@taki/shared";
import type { CharacterStore } from "../../characters/character-store.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function characterListMethod(store: CharacterStore): MethodDefinition<CharacterListParams> {
  return {
    method: CHARACTER_METHODS.list,
    roles: ["operator"],
    paramsSchema: CharacterListParamsSchema,
    handler: (): CharacterListResult => ({
      characters: store.list().map((marker) => ({
        characterId: marker.characterId,
        costumes: marker.costumes,
        defaultCostume: marker.defaultCostume,
        settingsFilesByCostume: marker.settingsFilesByCostume,
        source: marker.source,
      })),
    }),
  };
}

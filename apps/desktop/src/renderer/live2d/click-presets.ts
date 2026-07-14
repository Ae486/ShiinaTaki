/**
 * INPUT:  a character id + a click region.
 * OUTPUT: click-reaction preset DATA — each region maps to an emotion tag; presetForCharacter(id) picks a character's default.
 * POS:    ui/renderer/live2d — framework-free (ZERO React imports). DATA, not logic (invariant 7): the reaction engine
 *         (click-reactions.ts) resolves these tags against the live model, and the M5 #24 settings picker swaps presets.
 */

import type { ClickRegion } from "./click-regions.ts";

export type ClickPreset = Record<ClickRegion, string>;

// taki's default = tsundere/cool: a head poke gets a "哈？"/angry beat, torso pokes get huffs (pui), embarrassment
// (shame), or a serious glare — resolved against the arbeit costume's actual angry/pui/shame/serious/sigh vocab.
const TSUNDERE: ClickPreset = {
  head: "angry",
  upper_body_left: "pui",
  upper_body_center: "shame",
  upper_body_right: "serious",
  lower_body_left: "sigh",
  lower_body_center: "shame",
  lower_body_right: "pui",
};

export type PresetName = "tsundere";

const PRESETS: Record<PresetName, ClickPreset> = { tsundere: TSUNDERE };

// Character -> default preset (data; M5 #24 makes this user-selectable). #16 ships only taki=tsundere; unknown
// characters fall back to tsundere until more presets land.
const CHARACTER_PRESETS: Record<string, PresetName> = { taki: "tsundere" };

export function presetForCharacter(characterId: string): ClickPreset {
  return PRESETS[CHARACTER_PRESETS[characterId] ?? "tsundere"];
}

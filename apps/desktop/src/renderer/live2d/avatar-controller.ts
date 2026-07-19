/**
 * INPUT:  a loaded model, its on-screen center, and the active character id.
 * OUTPUT: createAvatarController(deps) -> { vocabulary, applyCommand, reactToClick, focusAt, handleProximity } — the
 *         model's behavior surface. applyCommand takes an optional drift sink (unknown name -> the caller re-reports, 1b).
 * POS:    ui/renderer/live2d — framework-free (ZERO React/ws imports). Bundles F3 (LLM avatar command) + F4 (gaze, click
 *         reactions) + the D17 proximity reflex so pet-scene exposes ONE avatar surface; the React bridge never touches the model.
 */

import type { Live2DModel } from "untitled-pixi-live2d-engine";
import type { AvatarCommand } from "@taki/shared";
import { applyAvatarCommand } from "./avatar-commands.ts";
import { reactToClick } from "./click-reactions.ts";
import { presetForCharacter } from "./click-presets.ts";
import type { ClickRegion } from "./click-regions.ts";
import { createGazeFocuser } from "./gaze.ts";
import { readVocabulary, type AvatarVocabulary } from "./model-vocabulary.ts";
import { createProximityReactor } from "./proximity-reaction.ts";

export interface AvatarController {
  vocabulary: AvatarVocabulary;
  applyCommand: (command: AvatarCommand, onVocabularyDrift?: () => void) => void;
  reactToClick: (x: number, y: number) => ClickRegion | null;
  focusAt: (x: number, y: number) => void;
  handleProximity: (x: number, y: number) => void;
}

export function createAvatarController(deps: {
  model: Live2DModel;
  center: { x: number; y: number };
  characterId: string;
}): AvatarController {
  const { model, center, characterId } = deps;
  const vocabulary = readVocabulary(model);
  const preset = presetForCharacter(characterId);
  const gaze = createGazeFocuser({ model, center });
  const proximity = createProximityReactor({ model, center, vocabulary });

  return {
    vocabulary,
    applyCommand: (command, onVocabularyDrift) => void applyAvatarCommand({ model, command, vocabulary, onVocabularyDrift }),
    reactToClick: (x, y) => reactToClick({ model, center, vocabulary, preset, point: { x, y } }),
    focusAt: gaze.focusAt,
    handleProximity: proximity.handleProximity,
  };
}

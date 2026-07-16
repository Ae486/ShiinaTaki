/**
 * INPUT:  a live app/stage + the current model + a new costume source + injected load/readVocab fns.
 * OUTPUT: reloadModel(deps, previous, source) -> { model, vocabulary } — loads the new costume, then tears down the
 *         previous model, re-reads its vocabulary. The caller re-reports that vocab through the EXISTING avatar.report.
 * POS:    ui/renderer/live2d — framework-free AND engine-free (loader/reader are injected by pet-scene, so this stays
 *         node-testable — importing the engine value evaluates window). Costume switch = Live2DModel.from teardown+reload.
 */

import type { Application } from "pixi.js";
import type { Live2DModel } from "untitled-pixi-live2d-engine";
import type { CostumeSource } from "./load-character-model.ts";
import type { AvatarVocabulary } from "./model-vocabulary.ts";

export interface CostumeSwitchDeps {
  app: Application;
  // Load a model from a costume source and place it on the stage (the real loader is passed by pet-scene; a fake in tests).
  load: (app: Application, source: string | CostumeSource) => Promise<Live2DModel>;
  // Read the loaded model's motion/expression vocabulary (the real reader is passed by pet-scene; a fake in tests).
  readVocab: (model: Live2DModel) => AvatarVocabulary;
}

export interface ReloadedModel {
  model: Live2DModel;
  vocabulary: AvatarVocabulary;
}

/**
 * Load the new costume FIRST, then tear down the previous model (remove from stage + destroy) and read the new
 * model's vocabulary. Load-before-teardown is the safe order: if the load throws (bad costume), the previous model
 * is left rendering untouched and the caller keeps it; and the previous model stays valid for the whole load await,
 * so the click-through poll's per-tick focusAt never touches a destroyed model mid-switch. The load/read fns are
 * injected so this compose-and-re-read core is testable with a mocked engine (the engine's value import evaluates
 * `window`, absent in node).
 */
export async function reloadModel(
  deps: CostumeSwitchDeps,
  previous: Live2DModel,
  source: string | CostumeSource,
): Promise<ReloadedModel> {
  const model = await deps.load(deps.app, source);
  deps.app.stage.removeChild(previous);
  previous.destroy({ children: true });
  return { model, vocabulary: deps.readVocab(model) };
}

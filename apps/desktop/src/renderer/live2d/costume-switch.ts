/**
 * INPUT:  a live app/stage + the current model + a new costume's settings URL + injected load/readVocab fns.
 * OUTPUT: reloadModel(deps, previous, url) -> { model, vocabulary } — tears down the previous model, loads the new
 *         costume, re-reads its vocabulary. The caller re-reports that vocab through the EXISTING avatar.report.
 * POS:    ui/renderer/live2d — framework-free AND engine-free (loader/reader are injected by pet-scene, so this stays
 *         node-testable — importing the engine value evaluates window). Costume switch = Live2DModel.from teardown+reload.
 */

import type { Application } from "pixi.js";
import type { Live2DModel } from "untitled-pixi-live2d-engine";
import type { AvatarVocabulary } from "./model-vocabulary.ts";

export interface CostumeSwitchDeps {
  app: Application;
  // Load a model from a settings URL and place it on the stage (the real loader is passed by pet-scene; a fake in tests).
  load: (app: Application, url: string) => Promise<Live2DModel>;
  // Read the loaded model's motion/expression vocabulary (the real reader is passed by pet-scene; a fake in tests).
  readVocab: (model: Live2DModel) => AvatarVocabulary;
}

export interface ReloadedModel {
  model: Live2DModel;
  vocabulary: AvatarVocabulary;
}

/**
 * Tear down the previous model (remove from stage + destroy), load the new costume, and read its vocabulary. The
 * load/read fns are injected so this compose-and-re-read core is testable with a mocked engine (the engine's value
 * import evaluates `window`, absent in node).
 */
export async function reloadModel(deps: CostumeSwitchDeps, previous: Live2DModel, url: string): Promise<ReloadedModel> {
  deps.app.stage.removeChild(previous);
  previous.destroy({ children: true });
  const model = await deps.load(deps.app, url);
  return { model, vocabulary: deps.readVocab(model) };
}

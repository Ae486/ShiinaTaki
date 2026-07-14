/**
 * INPUT:  a loaded Live2DModel (its motionManager.definitions + expressionManager.definitions).
 * OUTPUT: readVocabulary(model) -> { motions, expressions } — the names the model actually defines.
 * POS:    ui/renderer/live2d — framework-free (ZERO React/ws imports). The Pet UI reports this vocabulary to the Core
 *         (avatar.report) so the LLM's avatar tools use manifest names (Option A); also validates incoming commands.
 */

import type { Live2DModel } from "untitled-pixi-live2d-engine";

export interface AvatarVocabulary {
  motions: string[];
  expressions: string[];
}

export function readVocabulary(model: Live2DModel): AvatarVocabulary {
  const manager = model.internalModel.motionManager;
  const motions = Object.keys(manager.definitions);
  const expressions = (manager.expressionManager?.definitions ?? [])
    .map(expressionName)
    .filter((name): name is string => name !== null);
  return { motions, expressions };
}

// Cubism 2 expression specs carry `name`, Cubism 3+ carry `Name` (verified against the two taki manifests + engine
// types). Narrow the untyped spec without an `as` cast so a shape change degrades to a dropped name, never a crash.
function expressionName(definition: unknown): string | null {
  if (typeof definition !== "object" || definition === null) return null;
  if ("name" in definition && typeof definition.name === "string") return definition.name;
  if ("Name" in definition && typeof definition.Name === "string") return definition.Name;
  return null;
}

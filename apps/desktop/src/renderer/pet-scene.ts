/**
 * INPUT:  a DOM host + a local renderThrottling flag + an initial model source (asset: URL, or the dev route default).
 * OUTPUT: a PetScene controller — governor, setAvatarState, idleResult, isOpaqueAt, the avatar surface, switchCostume
 *         (teardown+reload a new costume, returns its re-read vocabulary), and dispose.
 * POS:    ui/renderer — framework-free (ZERO React/Tauri imports). The single assembly point the React bridge
 *         (windows/pet/pet-stage.tsx) mounts; keeps all Pixi/Live2D ownership out of the React tree.
 */

import type { Application } from "pixi.js";
import type { Live2DModel } from "untitled-pixi-live2d-engine";
import { createStage } from "./stage.ts";
import { RenderGovernor } from "./render-governor.ts";
import { renderActivityFor, type AvatarState } from "./state-machine.ts";
import { loadCharacterModel, DEV_MODEL_SOURCE, type CostumeSource } from "./live2d/load-character-model.ts";
import { startIdleAnimation, type IdleResult } from "./live2d/idle-behavior.ts";
import { createAvatarController, type AvatarController } from "./live2d/avatar-controller.ts";
import { reloadModel } from "./live2d/costume-switch.ts";
import { readVocabulary, type AvatarVocabulary } from "./live2d/model-vocabulary.ts";
import type { ClickRegion } from "./live2d/click-regions.ts";
import { createAlphaMaskSource } from "./alpha-mask-source.ts";
import type { AvatarCommand } from "@taki/shared";

export type PetSceneOptions = {
  // The `renderThrottling` config flag, read locally with a default (real config wiring is deferred to M5 #24, D19).
  renderThrottling?: boolean;
  // The active character whose click-reaction preset applies (data, invariant 7); defaults to taki for #16.
  characterId?: string;
  // The initial model settings source: an imported costume's asset: URL, or the dev /spike-assets route (default).
  modelSource?: string;
};

export type PetScene = {
  governor: RenderGovernor;
  idleResult: IdleResult;
  setAvatarState: (state: AvatarState) => void;
  // Whether the character's opaque body is under a point given in logical canvas px (top-left origin). The pet
  // window's click-through hook queries this per cursor poll; the mask tracks the live silhouette per frame.
  isOpaqueAt: (x: number, y: number) => boolean;
  // The loaded model's motion/expression names — reported to the Core (avatar.report) for Option A prompt injection.
  reportVocabulary: () => AvatarVocabulary;
  // Applies an LLM-driven avatar command (validated vs the vocabulary; unknown names no-op). F3.
  applyAvatarCommand: (command: AvatarCommand) => void;
  // Reacts to a click at canvas-local px (region reaction) and returns the region hit for the caller's precedence. F4.
  handleClick: (x: number, y: number) => ClickRegion | null;
  // Gaze follow: point the model at a canvas-local cursor position (clamped + delta-gated). F4.
  focusAt: (x: number, y: number) => void;
  // Swaps to another costume's model and returns its re-read vocabulary for the caller to avatar.report (#18). The
  // source carries the settings URL + a per-sub-resource absolute-asset-URL fn (see load-character-model / lib).
  switchCostume: (source: CostumeSource) => Promise<AvatarVocabulary>;
  dispose: () => void;
};

interface SceneModel {
  model: Live2DModel;
  avatar: AvatarController;
}

interface SwitchContext {
  app: Application;
  center: { x: number; y: number };
  characterId: string;
  current: SceneModel; // mutated in place so the scene's delegating methods see the new costume's controller
}

export async function createPetScene(host: HTMLElement, options: PetSceneOptions = {}): Promise<PetScene> {
  const characterId = options.characterId ?? "taki";
  const app = await createStage(host);
  const model = await loadCharacterModel(app, options.modelSource ?? DEV_MODEL_SOURCE);
  const idleResult = await startIdleAnimation(model);

  const governor = new RenderGovernor(app.ticker);
  governor.setThrottling(options.renderThrottling ?? true);

  // Stable across costume swaps (the pet window is fixed-size); the avatar controller needs it for gaze + click math.
  const center = { x: app.screen.width / 2, y: app.screen.height / 2 };
  const current: SceneModel = { model, avatar: createAvatarController({ model, center, characterId }) };

  // Snapshot the stage (the on-screen composition) into a low-res alpha mask once per painted frame. Hooking it to
  // the governed ticker means it throttles/pauses with rendering; a paused model is static, so the mask stays valid.
  // It reads app.stage each frame, so a costume swap (removeChild+addChild) is tracked with no mask rewiring.
  const mask = createAlphaMaskSource(app.renderer, app.stage, { width: app.screen.width, height: app.screen.height });
  app.ticker.add(mask.refresh);

  return {
    governor,
    idleResult,
    setAvatarState: (state) => governor.setActivity(renderActivityFor(state)),
    isOpaqueAt: (x, y) => mask.isOpaque(x, y),
    reportVocabulary: () => current.avatar.vocabulary,
    applyAvatarCommand: (command) => current.avatar.applyCommand(command),
    handleClick: (x, y) => current.avatar.reactToClick(x, y),
    focusAt: (x, y) => current.avatar.focusAt(x, y),
    switchCostume: (source) => switchCostume({ app, center, characterId, current }, source),
    dispose: () => {
      app.ticker.remove(mask.refresh);
      mask.dispose();
      app.destroy(true, { children: true });
    },
  };
}

// Teardown+reload the new costume, rebuild its avatar controller + idle loop, and return the re-read vocabulary the
// caller re-reports through the EXISTING avatar.report (arch §6b — no new vocab plumbing, no costume.switch WS method).
async function switchCostume(ctx: SwitchContext, source: CostumeSource): Promise<AvatarVocabulary> {
  const { model, vocabulary } = await reloadModel(
    { app: ctx.app, load: loadCharacterModel, readVocab: readVocabulary },
    ctx.current.model,
    source,
  );
  ctx.current.model = model;
  ctx.current.avatar = createAvatarController({ model, center: ctx.center, characterId: ctx.characterId });
  void startIdleAnimation(model);
  return vocabulary;
}

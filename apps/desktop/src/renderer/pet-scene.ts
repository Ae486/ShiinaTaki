/**
 * INPUT:  a DOM host element + a local renderThrottling flag; assembles stage + Live2D model + governor + FSM tiers.
 * OUTPUT: a PetScene controller — governor (for window-signal hooks), setAvatarState (store → render tier),
 *         idleResult (what idle animation actually started), and dispose.
 * POS:    ui/renderer — framework-free (ZERO React imports). The single assembly point the React bridge
 *         (windows/pet/pet-stage.tsx) mounts; keeps all Pixi/Live2D ownership out of the React tree.
 */

import { createStage } from "./stage.ts";
import { RenderGovernor } from "./render-governor.ts";
import { renderActivityFor, type AvatarState } from "./state-machine.ts";
import { loadTakiModel } from "./live2d/load-taki-model.ts";
import { startIdleAnimation, type IdleResult } from "./live2d/idle-behavior.ts";
import { createAvatarController } from "./live2d/avatar-controller.ts";
import type { AvatarVocabulary } from "./live2d/model-vocabulary.ts";
import type { ClickRegion } from "./live2d/click-regions.ts";
import { createAlphaMaskSource } from "./alpha-mask-source.ts";
import type { AvatarCommand } from "@taki/shared";

export type PetSceneOptions = {
  // The `renderThrottling` config flag, read locally with a default (real config wiring is deferred to M5 #24, D19).
  renderThrottling?: boolean;
  // The active character whose click-reaction preset applies (data, invariant 7); defaults to taki for #16.
  characterId?: string;
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
  dispose: () => void;
};

export async function createPetScene(host: HTMLElement, options: PetSceneOptions = {}): Promise<PetScene> {
  const app = await createStage(host);
  const model = await loadTakiModel(app);
  const idleResult = await startIdleAnimation(model);

  const governor = new RenderGovernor(app.ticker);
  governor.setThrottling(options.renderThrottling ?? true);

  // The model is placed at the screen center (load-taki-model); the avatar controller needs it for gaze + click math.
  const center = { x: app.screen.width / 2, y: app.screen.height / 2 };
  const avatar = createAvatarController({ model, center, characterId: options.characterId ?? "taki" });

  // Snapshot the stage (the on-screen composition) into a low-res alpha mask once per painted frame. Hooking it to
  // the governed ticker means it throttles/pauses with rendering; a paused model is static, so the mask stays valid.
  const mask = createAlphaMaskSource(app.renderer, app.stage, {
    width: app.screen.width,
    height: app.screen.height,
  });
  app.ticker.add(mask.refresh);

  return {
    governor,
    idleResult,
    setAvatarState: (state) => governor.setActivity(renderActivityFor(state)),
    isOpaqueAt: (x, y) => mask.isOpaque(x, y),
    reportVocabulary: () => avatar.vocabulary,
    applyAvatarCommand: avatar.applyCommand,
    handleClick: avatar.reactToClick,
    focusAt: avatar.focusAt,
    dispose: () => {
      app.ticker.remove(mask.refresh);
      mask.dispose();
      app.destroy(true, { children: true });
    },
  };
}

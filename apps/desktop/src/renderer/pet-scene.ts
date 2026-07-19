/**
 * INPUT:  a DOM host + a local renderThrottling flag + an initial model source (asset: URL, or the dev route default).
 * OUTPUT: a PetScene controller — governor, setAvatarState, isOpaqueAt, the avatar surface (applyAvatarCommand with an
 *         optional drift sink, handleClick, focusAt, handleProximity), switchCostume (teardown+reload a new costume,
 *         returns its re-read vocabulary), abortSwitch (mark an in-flight switch stale so a late model self-discards),
 *         and dispose. The scene may boot MODEL-LESS (initial source unreachable —
 *         normal in a packaged build, where the dev route does not exist): the stage runs empty, avatar methods no-op,
 *         and the first switchCostume (initial-costume promotion) attaches a model.
 * POS:    ui/renderer — framework-free (ZERO React/Tauri imports). The single assembly point the React bridge
 *         (windows/pet/pet-stage.tsx) mounts; keeps all Pixi/Live2D ownership out of the React tree.
 */

import type { Application } from "pixi.js";
import type { Live2DModel } from "untitled-pixi-live2d-engine";
import { createStage } from "./stage.ts";
import { RenderGovernor } from "./render-governor.ts";
import { renderActivityFor, type AvatarState } from "./state-machine.ts";
import { loadCharacterModel, DEV_MODEL_SOURCE, type CostumeSource } from "./live2d/load-character-model.ts";
import { createIdleMotionScheduler, type IdleMotionScheduler } from "./live2d/idle-motion.ts";
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
  setAvatarState: (state: AvatarState) => void;
  // Whether the character's opaque body is under a point given in logical canvas px (top-left origin). The pet
  // window's click-through hook queries this per cursor poll; the mask tracks the live silhouette per frame.
  isOpaqueAt: (x: number, y: number) => boolean;
  // The loaded model's motion/expression names — reported to the Core (avatar.report) for Option A prompt injection.
  // Empty while the scene is model-less; the promotion path re-reports the real vocabulary after attach.
  reportVocabulary: () => AvatarVocabulary;
  // Applies an LLM-driven avatar command (validated vs the vocabulary); an unknown name fires onVocabularyDrift so the
  // caller re-reports the live inventory (self-heal, 1b). F3.
  applyAvatarCommand: (command: AvatarCommand, onVocabularyDrift?: () => void) => void;
  // Reacts to a click at canvas-local px (region reaction) and returns the region hit for the caller's precedence. F4.
  handleClick: (x: number, y: number) => ClickRegion | null;
  // Gaze follow: point the model at a canvas-local cursor position (clamped + delta-gated). F4.
  focusAt: (x: number, y: number) => void;
  // Deterministic proximity reflex: a cursor entering the near zone triggers a cooldown-gated reaction (D17).
  handleProximity: (x: number, y: number) => void;
  // Swaps to another costume's model and returns its re-read vocabulary for the caller to avatar.report (#18). The
  // source carries the settings URL + a per-sub-resource resolve fn (see load-character-model / lib). Doubles as
  // the FIRST attach when the scene booted model-less.
  switchCostume: (source: CostumeSource) => Promise<AvatarVocabulary>;
  // Marks any in-flight switchCostume stale (bumps the switch ticket) so its late-resolving model self-discards
  // instead of attaching a costume the identity stores never advanced to. Called on a switch timeout/failure and on
  // an operator Cancel; idempotent + model-less safe. See resolve-switch-report / use-costume-switch (1f Fix 1).
  abortSwitch: () => void;
  dispose: () => void;
};

interface SceneModel {
  model: Live2DModel;
  avatar: AvatarController;
  idle: IdleMotionScheduler;
}

interface SwitchContext {
  app: Application;
  center: { x: number; y: number };
  characterId: string;
  slot: { current: SceneModel | null }; // mutated in place so the scene's delegating methods see the new costume
  seq: { current: number }; // monotonically increasing switch ticket — a late-resolving load must not clobber a newer one
}

export async function createPetScene(host: HTMLElement, options: PetSceneOptions = {}): Promise<PetScene> {
  const characterId = options.characterId ?? "taki";
  const app = await createStage(host);

  const governor = new RenderGovernor(app.ticker);
  governor.setThrottling(options.renderThrottling ?? true);

  // Stable across costume swaps (the pet window is fixed-size); the avatar controller needs it for gaze + click math.
  const center = { x: app.screen.width / 2, y: app.screen.height / 2 };
  const slot: { current: SceneModel | null } = { current: null };
  const ctx: SwitchContext = { app, center, characterId, slot, seq: { current: 0 } };

  // The initial model is best-effort: the dev route exists only under `pnpm tauri dev`, and even there a transient
  // fetch failure must not kill the stage. A model-less scene stays alive; the initial-costume promotion (or a
  // manual panel switch) attaches the model through the SAME switchCostume path.
  try {
    attachModel(ctx, await loadCharacterModel(app, options.modelSource ?? DEV_MODEL_SOURCE));
  } catch (error) {
    console.warn("[pet-scene] initial model unavailable; stage runs model-less until a costume attaches", error);
  }

  // Snapshot the stage (the on-screen composition) into a low-res alpha mask once per painted frame. Hooking it to
  // the governed ticker means it throttles/pauses with rendering; a paused model is static, so the mask stays valid.
  // It reads app.stage each frame, so a costume swap (removeChild+addChild) is tracked with no mask rewiring.
  const mask = createAlphaMaskSource(app.renderer, app.stage, { width: app.screen.width, height: app.screen.height });
  app.ticker.add(mask.refresh);

  return {
    governor,
    setAvatarState: (state) => governor.setActivity(renderActivityFor(state)),
    isOpaqueAt: (x, y) => mask.isOpaque(x, y),
    reportVocabulary: () => slot.current?.avatar.vocabulary ?? { motions: [], expressions: [] },
    applyAvatarCommand: (command, onVocabularyDrift) => slot.current?.avatar.applyCommand(command, onVocabularyDrift),
    handleClick: (x, y) => slot.current?.avatar.reactToClick(x, y) ?? null,
    focusAt: (x, y) => slot.current?.avatar.focusAt(x, y),
    handleProximity: (x, y) => slot.current?.avatar.handleProximity(x, y),
    switchCostume: (source) => switchCostume(ctx, source),
    abortSwitch: () => abortSwitch(ctx),
    dispose: () => {
      slot.current?.idle.dispose();
      app.ticker.remove(mask.refresh);
      mask.dispose();
      app.destroy(true, { children: true });
    },
  };
}

// Teardown+reload the new costume, rebuild its avatar controller + idle scheduler, and return the re-read vocabulary the
// caller re-reports through the EXISTING avatar.report (arch §6b — no new vocab plumbing, no costume.switch WS method).
async function switchCostume(ctx: SwitchContext, source: CostumeSource): Promise<AvatarVocabulary> {
  const ticket = ++ctx.seq.current;
  const { model, vocabulary } = await reloadModel(
    { app: ctx.app, load: loadCharacterModel, readVocab: readVocabulary, isStale: () => ticket !== ctx.seq.current },
    ctx.slot.current?.model ?? null,
    source,
  );
  attachModel(ctx, model);
  return vocabulary;
}

// Mark any in-flight costume switch stale so its late-resolving model self-discards (reloadModel's isStale flips true →
// removeChild+destroy+throw) instead of attaching a costume the identity stores never advanced to (screen/vocabulary
// drift, 1f Fix 1). Bumping the shared switch ticket is all it takes; idempotent + model-less safe (touches only the
// counter). The load itself is not cancelled — a late completion is simply discarded, which is enough for correctness.
function abortSwitch(ctx: SwitchContext): void {
  ctx.seq.current += 1;
}

// One attach site for both the initial best-effort load and every costume swap: dispose the outgoing scheduler, then
// rebuild the controller + idle scheduler. The scheduler goes stale (and self-disposes) once a newer switch bumps seq.
function attachModel(ctx: SwitchContext, model: Live2DModel): void {
  ctx.slot.current?.idle.dispose();
  const ticket = ctx.seq.current;
  ctx.slot.current = {
    model,
    avatar: createAvatarController({ model, center: ctx.center, characterId: ctx.characterId }),
    idle: createIdleMotionScheduler({ model, isStale: () => ctx.seq.current !== ticket }),
  };
}

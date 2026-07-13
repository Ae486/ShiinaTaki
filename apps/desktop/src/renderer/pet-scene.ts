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
import { createAlphaMaskSource } from "./alpha-mask-source.ts";

export type PetSceneOptions = {
  // The `renderThrottling` config flag, read locally with a default (real config wiring is deferred to M5 #24, D19).
  renderThrottling?: boolean;
};

export type PetScene = {
  governor: RenderGovernor;
  idleResult: IdleResult;
  setAvatarState: (state: AvatarState) => void;
  // Whether the character's opaque body is under a point given in logical canvas px (top-left origin). The pet
  // window's click-through hook queries this per cursor poll; the mask tracks the live silhouette per frame.
  isOpaqueAt: (x: number, y: number) => boolean;
  dispose: () => void;
};

export async function createPetScene(host: HTMLElement, options: PetSceneOptions = {}): Promise<PetScene> {
  const app = await createStage(host);
  const model = await loadTakiModel(app);
  const idleResult = await startIdleAnimation(model);

  const governor = new RenderGovernor(app.ticker);
  governor.setThrottling(options.renderThrottling ?? true);

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
    dispose: () => {
      app.ticker.remove(mask.refresh);
      mask.dispose();
      app.destroy(true, { children: true });
    },
  };
}

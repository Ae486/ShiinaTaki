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

export type PetSceneOptions = {
  // The `renderThrottling` config flag, read locally with a default (real config wiring is deferred to M5 #24, D19).
  renderThrottling?: boolean;
};

export type PetScene = {
  governor: RenderGovernor;
  idleResult: IdleResult;
  setAvatarState: (state: AvatarState) => void;
  dispose: () => void;
};

export async function createPetScene(host: HTMLElement, options: PetSceneOptions = {}): Promise<PetScene> {
  const app = await createStage(host);
  const model = await loadTakiModel(app);
  const idleResult = await startIdleAnimation(model);

  const governor = new RenderGovernor(app.ticker);
  governor.setThrottling(options.renderThrottling ?? true);

  return {
    governor,
    idleResult,
    setAvatarState: (state) => governor.setActivity(renderActivityFor(state)),
    dispose: () => app.destroy(true, { children: true }),
  };
}

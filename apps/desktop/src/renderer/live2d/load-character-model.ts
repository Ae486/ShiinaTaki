/**
 * INPUT:  an initialized PixiJS Application + a model settings URL (a Tauri asset: URL for an imported costume, or the
 *         dev /spike-assets route); the vendored Cubism runtimes (globals from pet.html).
 * OUTPUT: loadCharacterModel(app, source) -> a loaded, centered Live2DModel on the governed ticker (eye-blink+breath).
 * POS:    ui/renderer/live2d — framework-free (ZERO React/Tauri imports). The URL is composed upstream (lib/
 *         character-asset-url) so convertFileSrc never reaches this layer. C2 vs C3 needs no branch here (#18).
 */

import type { Application } from "pixi.js";
import { Live2DModel } from "untitled-pixi-live2d-engine";

// Dev fallback: the git-ignored self-contained Cubism 2 costume served by the vite middleware (apply:"serve"). Used
// when no character is imported so `pnpm tauri dev` still renders; absent from a packaged build (an imported model
// replaces it live via the costume-switch path). The production route is a Tauri asset: URL passed in as `source`.
export const DEV_MODEL_SOURCE = "/spike-assets/arbeit/model.json";

export async function loadCharacterModel(app: Application, source: string): Promise<Live2DModel> {
  const model = await Live2DModel.from(source, {
    // Bind updates to the governed ticker so pausing/throttling the ticker also freezes the model (perf AC).
    ticker: app.ticker,
    // Interaction (tap reactions, focus tracking) is wired by the avatar controller; the loader only needs idle.
    autoHitTest: false,
    autoFocus: false,
    // Built-in idle liveliness — the engine applies these every update once the ticker drives the model.
    eyeBlink: true,
    breathDepth: 1,
  });

  placeCentered(app, model);
  app.stage.addChild(model);
  return model;
}

export function placeCentered(app: Application, model: Live2DModel): void {
  model.anchor.set(0.5);
  model.position.set(app.screen.width / 2, app.screen.height / 2);
  const fit = (app.screen.height * 0.9) / model.height;
  model.scale.set(fit);
}

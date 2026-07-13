/**
 * INPUT:  an initialized PixiJS Application; the vendored Cubism runtimes (loaded as globals by pet.html).
 * OUTPUT: a loaded, centered Live2DModel bound to the app's governed ticker, with engine eye-blink + breath enabled.
 * POS:    ui/renderer/live2d — framework-free (ZERO React imports). Consumes the locked engine per
 *         live2d-renderer.md. Dev-only asset route (#14); production asset-protocol loading is #18.
 */

import type { Application } from "pixi.js";
import { Live2DModel } from "untitled-pixi-live2d-engine";

// Dev-only route served by the vite middleware from models/extracted/taki (git-ignored). A self-contained Cubism 2
// costume (arbeit) per the renderer spec — avoids the external shared-motion pool other costumes reference.
// The production asset-protocol loader is issue #18; #14 intentionally reuses the spike route.
const TAKI_MODEL_SOURCE = "/spike-assets/arbeit/model.json";

export async function loadTakiModel(app: Application): Promise<Live2DModel> {
  const model = await Live2DModel.from(TAKI_MODEL_SOURCE, {
    // Bind updates to the governed ticker so pausing/throttling the ticker also freezes the model (perf AC).
    ticker: app.ticker,
    // Interaction (tap reactions, focus tracking) is #15/#16; #14 only needs idle rendering.
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

function placeCentered(app: Application, model: Live2DModel): void {
  model.anchor.set(0.5);
  model.position.set(app.screen.width / 2, app.screen.height / 2);
  const fit = (app.screen.height * 0.9) / model.height;
  model.scale.set(fit);
}

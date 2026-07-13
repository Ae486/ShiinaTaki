/**
 * INPUT:  a DOM canvas host element; PixiJS v8 + the Live2D render pipe.
 * OUTPUT: a transparent, governor-ready PixiJS `Application` with `Live2DPlugin` registered and its canvas mounted.
 * POS:    ui/renderer — framework-free (ZERO React imports). The PixiJS lifecycle root; the render governor owns
 *         its ticker. Its canvas is bridged into React only by windows/pet/pet-stage.tsx.
 */

import { Application, extensions } from "pixi.js";
import { Live2DPlugin } from "untitled-pixi-live2d-engine";

let pluginRegistered = false;

export async function createStage(host: HTMLElement): Promise<Application> {
  // The render pipe must be registered before the renderer is created; guard against double-registration on HMR.
  if (!pluginRegistered) {
    extensions.add(Live2DPlugin);
    pluginRegistered = true;
  }

  const app = new Application();
  await app.init({
    // Transparent all the way through so the overlay is a per-pixel Live2D cut-out (window transparent:true).
    backgroundAlpha: 0,
    resizeTo: host,
    preference: "webgl",
    autoDensity: true,
    resolution: window.devicePixelRatio,
    // The render governor is the single authority over the ticker; don't auto-run before it decides the tier.
    autoStart: false,
  });

  host.appendChild(app.canvas);
  return app;
}

/**
 * INPUT:  a DOM canvas host element; PixiJS v8 + the Live2D render pipe.
 * OUTPUT: an initialized PixiJS `Application` with `Live2DPlugin` registered, ready to host Live2D models.
 * POS:    experimental / spike — not in production path; seeds #14's real `renderer/stage.ts` but is intentionally minimal.
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
    background: "#1b1b24",
    resizeTo: host,
    preference: "webgl",
    autoDensity: true,
    resolution: window.devicePixelRatio,
  });

  host.appendChild(app.canvas);
  return app;
}

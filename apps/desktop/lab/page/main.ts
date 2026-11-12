/**
 * INPUT:  the DOM (#stage, #controls) and the Cubism runtime globals loaded by lab.html.
 * OUTPUT: boots the lab: spike createStage -> createLabScene -> mounts the panels; disposes the scene on Vite HMR and
 *         on page unload (model teardown before app.destroy, spec live2d-renderer.md).
 * POS:    experimental / lab — not in production path; standalone Vite entry (lab/lab.html), plain browser, no Tauri,
 *         no Agent Core.
 */

import { createStage } from "@/renderer/spike/create-stage.js";
import { createLabScene } from "../scene/lab-scene.ts";
import { mountPanelExpression } from "./panel-expression.ts";
import { mountPanelModel } from "./panel-model.ts";
import { mountPanelMotion } from "./panel-motion.ts";
import { mountPanelParams } from "./panel-params.ts";
import { createFindingsLog, mountPanelReadout } from "./panel-readout.ts";
import { mountPanelSpeech } from "./panel-speech.ts";

async function boot(): Promise<void> {
  const stageHost = document.querySelector<HTMLElement>("#stage");
  const controls = document.querySelector<HTMLElement>("#controls");
  if (!stageHost || !controls) throw new Error("lab: #stage / #controls not found");

  const app = await createStage(stageHost);
  const scene = createLabScene(app);
  const findings = createFindingsLog();
  const deps = { host: controls, scene, log: findings.log, screen: () => ({ width: app.screen.width, height: app.screen.height }) };

  mountPanelModel(deps);
  mountPanelMotion(deps);
  mountPanelExpression(deps);
  mountPanelParams(deps);
  const speech = mountPanelSpeech(deps);
  const readout = mountPanelReadout(deps, findings);
  findings.log("lab ready");

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    readout.dispose();
    speech.dispose();
    scene.dispose();
  };
  import.meta.hot?.dispose(dispose);
  window.addEventListener("beforeunload", dispose);
}

boot().catch((err: unknown) => {
  const controls = document.querySelector<HTMLElement>("#controls");
  if (controls) controls.textContent = `lab crashed: ${String(err)}`;
  console.error(err);
});

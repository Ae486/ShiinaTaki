/**
 * INPUT:  the test-only Lab scene/speech handles and ordinary UI-driven playback.
 * OUTPUT: final mouth parameter frames, readable timing summaries and real canvas/layout evidence.
 * POS:    experimental / lab - not in production path; read-only observations, no custom writer injection.
 */
/* global window, document, performance, queueMicrotask */

import { resolve } from "node:path";
import { inspectPixels } from "./browser-images.mjs";

export async function startMouthObservation(page) {
  await page.evaluate(() => {
    const test = window.__avatarLabTest;
    const ctx = test.scene.current;
    const ids = ctx.facts.generation === "cubism2"
      ? ["PARAM_MOUTH_OPEN_Y", "PARAM_MOUTH_FORM_01", "PARAM_MOUTH_FORM_Y", "PARAM_MOUTH_SCALE"]
      : ["ParamMouthOpenY", "ParamMouthForm", "ParamMouthupdawn", "Param31", "Param16"];
    const frames = [];
    let active = true;
    // Run after all writers in this frame, regardless of hook subscription order.
    const off = ctx.hooks.add("beforeModelUpdate", () => queueMicrotask(() => {
      if (!active || test.scene.current !== ctx || frames.length >= 2000) return;
      frames.push({ atMs: performance.now(), speech: test.speech.snapshot(),
        final: Object.fromEntries(ids.map((id) => [id, ctx.params.get(id)])) });
    }));
    test.mouthObservation = { frames, stop() { active = false; off(); } };
  });
}

export async function finishMouthObservation(page) {
  return page.evaluate(() => {
    const test = window.__avatarLabTest;
    const observation = test.mouthObservation;
    observation.stop();
    delete test.mouthObservation;
    return observation.frames;
  });
}

export function summarizeMouthFrames(frames) {
  const playing = frames.filter((frame) => frame.speech.audio.isPlaying && frame.speech.audio.contextState === "running");
  const ids = Object.keys(playing[0]?.final ?? {});
  const final = Object.fromEntries(ids.map((id) => {
    const values = playing.map((frame) => frame.final[id]).filter(Number.isFinite);
    return [id, values.length ? [Math.min(...values), Math.max(...values)] : [null, null]];
  }));
  const times = playing.slice(1).map((frame, index) => frame.atMs - playing[index].atMs).sort((a, b) => a - b);
  return { frames: frames.length, playingFrames: playing.length, final,
    frameIntervalMs: { p50: percentile(times, 0.5), p95: percentile(times, 0.95) } };
}

function percentile(sorted, fraction) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] : null;
}

export async function mouthPanelPictures(page, output, label) {
  await page.screenshot({ path: resolve(output, `${label}-page.png`) });
  await page.locator("canvas").screenshot({ path: resolve(output, `${label}-model.png`) });
  await page.waitForTimeout(220);
  await page.locator("canvas").screenshot({ path: resolve(output, `${label}-model-next.png`) });
  const pixels = await inspectPixels(output, label);
  const layout = await page.evaluate(() => {
    const controls = document.querySelector("#controls");
    const stage = document.querySelector("#stage").getBoundingClientRect();
    return { pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      controlsOverflow: controls.scrollWidth > controls.clientWidth,
      stage: { width: stage.width, height: stage.height } };
  });
  return { pixels, layout };
}

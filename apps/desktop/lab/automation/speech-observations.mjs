/**
 * INPUT:  the lab's test-response scene handle and real native audio/model state.
 * OUTPUT: per-frame native playback observations, final mouth samples and real screenshot evidence.
 * POS:    experimental / lab - not in production path; observes the engine without changing audio or mouth writes.
 */
/* global window, performance, setTimeout, document */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { inspectPixels } from "./browser-images.mjs";

export async function speechState(page) {
  return page.evaluate(() => window.__avatarLabTest.speech.snapshot());
}

export async function speechFrames(page, durationMs) {
  return page.evaluate((duration) => new Promise((done) => {
    const { scene, speech } = window.__avatarLabTest;
    const ctx = scene.current;
    const frames = [];
    const detach = ctx.hooks.add("beforeModelUpdate", () => {
      const state = speech.snapshot();
      const manager = ctx.internal.motionManager;
      frames.push({
        atMs: performance.now(), status: state.status, audio: state.audio,
        raw: manager.currentAudio && manager.currentAnalyzer ? manager.mouthSync() : null,
        mouth: state.mouth,
        final: Object.fromEntries(ctx.facts.lipSyncIds.map((id) => [id, ctx.params.has(id) ? ctx.params.get(id) : null])),
      });
    });
    setTimeout(() => { detach(); done(frames); }, duration);
  }), durationMs);
}

export function speechRanges(frames) {
  const values = { raw: [], final: {} };
  for (const frame of frames) {
    if (Number.isFinite(frame.raw)) values.raw.push(frame.raw);
    for (const [id, value] of Object.entries(frame.final)) {
      if (Number.isFinite(value)) (values.final[id] ??= []).push(value);
    }
  }
  const range = (items) => items.length ? [Math.min(...items), Math.max(...items)] : [null, null];
  return {
    frames: frames.length,
    playing: frames.filter((frame) => frame.audio.isPlaying && frame.audio.contextState === "running").length,
    positive: values.raw.filter((raw) => raw > 0).length,
    zero: values.raw.filter((raw) => raw === 0).length,
    cappedPositive: frames.filter((frame) => frame.raw > 0 && frame.mouth.computedClamped === 1).length,
    raw: range(values.raw),
    final: Object.fromEntries(Object.entries(values.final).map(([id, samples]) => [id, range(samples)])),
  };
}

export async function speechPictures(page, output, label) {
  await page.screenshot({ path: resolve(output, `${label}-page.png`) });
  await page.locator("canvas").screenshot({ path: resolve(output, `${label}-model.png`) });
  await page.waitForTimeout(350);
  await page.locator("canvas").screenshot({ path: resolve(output, `${label}-model-next.png`) });
  const pixels = await inspectPixels(output, label);
  const layout = await page.evaluate(() => {
    const controls = document.querySelector("#controls");
    const stage = document.querySelector("#stage").getBoundingClientRect();
    return { viewport: { width: window.innerWidth, height: window.innerHeight },
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      controlsOverflow: controls.scrollWidth > controls.clientWidth,
      stage: { width: stage.width, height: stage.height } };
  });
  return { pixels, layout };
}

export async function saveSpeechCase(output, label, evidence) {
  await writeFile(resolve(output, `${label}.json`), JSON.stringify(evidence, null, 2));
}

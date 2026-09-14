/**
 * INPUT:  the normal Speech panel, the current Lab scene and one retained real Fish clip.
 * OUTPUT: UI-driven playback, suspension, mode/model replacement and authored-pose acceptance evidence.
 * POS:    experimental / lab - not in production path; no writer or audio-clock injection.
 */
/* global window */

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadCostume, panel } from "./browser-driver.mjs";
import { finishMouthObservation, mouthPanelPictures, startMouthObservation, summarizeMouthFrames } from "./mouth-panel-observations.mjs";

export const speech = (page) => panel(page, "Speech");
export const state = (page) => page.evaluate(() => window.__avatarLabTest.speech.snapshot());

export async function play(page) {
  await speech(page).getByRole("button", { name: "Play loaded clip", exact: true }).click();
  await page.waitForFunction(() => {
    const audio = window.__avatarLabTest.speech.snapshot().audio;
    return audio.isPlaying && audio.contextState === "running";
  }, undefined, { timeout: 20000 });
}

export async function stop(page) {
  await speech(page).getByRole("button", { name: "Stop speech", exact: true }).click();
  await page.waitForFunction(() => !window.__avatarLabTest.speech.snapshot().audio.isPlaying);
}

export async function loadPanelClip(page, fixture) {
  await speech(page).getByLabel("audio file", { exact: true }).setInputFiles(fixture);
  await page.waitForFunction(() => window.__avatarLabTest.speech.snapshot().custom.preparation.status === "ready",
    undefined, { timeout: 15000 });
}

export async function comparePlayback(test, mode) {
  const { page, output, label } = test;
  await speech(page).getByLabel("mouth mode", { exact: true }).selectOption(mode);
  await startMouthObservation(page);
  await play(page);
  const started = await state(page);
  assert.equal(started.custom.effectiveMode, mode);
  assert.equal(await page.evaluate(() => window.__avatarLabTest.scene.current.internal.lipSync), mode === "native");
  const pictures = await mouthPanelPictures(page, output, `${label}-${mode}`);
  await page.waitForFunction(() => !window.__avatarLabTest.speech.snapshot().audio.isPlaying, undefined, { timeout: 20000 });
  const ended = await state(page);
  const frames = await finishMouthObservation(page);
  const summary = summarizeMouthFrames(frames);
  assert.ok(summary.playingFrames > 10, "Playback did not produce sufficient frames");
  const openRange = summary.final[test.costume === "arbeit" ? "PARAM_MOUTH_OPEN_Y" : "ParamMouthOpenY"];
  assert.ok(openRange[1] - openRange[0] > 0.05, "Actual final mouth opening did not change");
  assert.ok(pictures.pixels.foregroundRatio > 0.01, "Canvas is blank");
  assert.equal(pictures.layout.pageOverflow || pictures.layout.controlsOverflow, false, "Layout overflows");
  assert.equal(await page.evaluate(() => window.__avatarLabTest.scene.current.internal.lipSync), true);
  assert.ok(!ended.custom.writer?.enabled, "Ended playback retained a writer");
  await writeFile(resolve(output, `${label}-${mode}-frames.json`), JSON.stringify(frames));
  return { started, ended, summary, pictures };
}

export async function checkSuspendResume(test) {
  const { page } = test;
  await speech(page).getByLabel("mouth mode", { exact: true }).selectOption("envelope");
  await play(page);
  await page.waitForFunction(() => window.__avatarLabTest.speech.snapshot().custom.clock.positionMs > 120);
  await page.evaluate(async () => { await window.__avatarLabTest.scene.current.internal.motionManager.currentContext.suspend(); });
  await page.waitForTimeout(150);
  const frozen = await state(page);
  await page.waitForTimeout(300);
  const afterWait = await state(page);
  assert.equal(afterWait.audio.contextState, "suspended");
  assert.ok(Math.abs(afterWait.custom.clock.positionMs - frozen.custom.clock.positionMs) < 10, "Mouth clock advanced while audio was suspended");
  await speech(page).getByRole("button", { name: "Resume audio", exact: true }).click();
  await page.waitForFunction((position) => window.__avatarLabTest.speech.snapshot().custom.clock.positionMs > position + 80,
    afterWait.custom.clock.positionMs);
  const resumed = await state(page);
  await stop(page);
  const stopped = await state(page);
  assert.ok(!stopped.custom.writer?.enabled);
  assert.equal(await page.evaluate(() => window.__avatarLabTest.scene.current.internal.lipSync), true);
  return { frozen, afterWait, resumed, stopped };
}

export async function checkPoses(test) {
  const { page, output, label } = test;
  await speech(page).getByLabel("model view", { exact: true }).selectOption("face");
  const cases = [];
  for (const pose of ["closed", "a", "e", "i", "o", "u"]) {
    await speech(page).getByLabel("pose preview", { exact: true }).selectOption(pose);
    await page.waitForTimeout(160);
    const snapshot = await state(page);
    assert.equal(snapshot.custom.preview, pose);
    assert.equal(await page.evaluate(() => window.__avatarLabTest.scene.current.internal.lipSync), false);
    const image = resolve(output, `${label}-pose-${pose}.png`);
    await page.locator("canvas").screenshot({ path: image });
    cases.push({ pose, snapshot, image });
  }
  await speech(page).getByLabel("pose preview", { exact: true }).selectOption("off");
  assert.equal(await page.evaluate(() => window.__avatarLabTest.scene.current.internal.lipSync), true);
  return cases;
}

export async function checkReplacement(test) {
  const { page } = test;
  await speech(page).getByLabel("mouth mode", { exact: true }).selectOption("envelope");
  await play(page);
  await speech(page).getByLabel("mouth mode", { exact: true }).selectOption("native");
  const changedMode = await state(page);
  assert.equal(changedMode.audio.isPlaying, false);
  assert.equal(await page.evaluate(() => window.__avatarLabTest.scene.current.internal.lipSync), true);
  await speech(page).getByLabel("mouth mode", { exact: true }).selectOption("envelope");
  await play(page);
  await page.evaluate(() => { window.__avatarLabTest.retired = window.__avatarLabTest.scene.current.internal; });
  await loadCostume(page, test.costume === "arbeit" ? "live_01" : "arbeit");
  const switched = await state(page);
  assert.equal(switched.audio.isPlaying, false);
  assert.ok(!switched.custom.writer?.enabled);
  const retired = await page.evaluate(() => ({ native: window.__avatarLabTest.retired.lipSync,
    playing: window.__avatarLabTest.retired.motionManager.currentAudio?.isPlaying ?? false }));
  assert.equal(retired.playing, false);
  assert.equal(retired.native, true);
  return { changedMode, switched, retired };
}

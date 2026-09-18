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
const nativeLipSync = (page) => page.evaluate(() => window.__avatarLabTest.scene.current.internal.lipSync);
const readoutText = (page) => speech(page).getByLabel("speech readout", { exact: true }).textContent();
export const openId = (costume) => (costume === "arbeit" ? "PARAM_MOUTH_OPEN_Y" : "ParamMouthOpenY");

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

async function selectArm(page, mode) {
  const root = speech(page);
  await root.getByLabel("mouth mode", { exact: true }).selectOption(mode);
  const gain = root.getByLabel("lipSyncGain", { exact: true });
  const weight = root.getByLabel("lipSyncWeight", { exact: true });
  assert.equal(await gain.isDisabled(), mode === "native", "lipSyncGain lock does not follow the arm");
  assert.equal(await weight.isDisabled(), mode === "native", "lipSyncWeight lock does not follow the arm");
  // The tuned arm is defined by the UI sliders: set the full weight through the same input the owner would use.
  if (mode === "native-tuned") await weight.fill("1");
  const armed = await state(page);
  assert.equal(armed.nativeArm.mode, mode);
  assert.equal(armed.nativeArm.slidersLive, mode !== "native");
  if (mode === "native-tuned") assert.equal(armed.nativeArm.weight, 1);
  return armed;
}

export async function comparePlayback(test, mode) {
  const { page, output, label } = test;
  const armed = await selectArm(page, mode);
  await play(page);
  // Subscribed after play so the observer runs after the arm's writer within the same frame.
  await startMouthObservation(page);
  const started = await state(page);
  assert.equal(started.custom.effectiveMode, mode);
  assert.equal(await nativeLipSync(page), mode !== "envelope");
  const pictures = await mouthPanelPictures(page, output, `${label}-${mode}`);
  await page.waitForFunction(() => !window.__avatarLabTest.speech.snapshot().audio.isPlaying, undefined, { timeout: 20000 });
  const ended = await state(page);
  const frames = await finishMouthObservation(page);
  const summary = summarizeMouthFrames(frames);
  assert.ok(summary.playingFrames > 10, "Playback did not produce sufficient frames");
  const openRange = summary.final[openId(test.costume)];
  assert.ok(openRange[1] - openRange[0] > 0.05, "Actual final mouth opening did not change");
  assert.ok(pictures.pixels.foregroundRatio > 0.01, "Canvas is blank");
  assert.equal(pictures.layout.pageOverflow || pictures.layout.controlsOverflow, false, "Layout overflows");
  assert.equal(await nativeLipSync(page), true);
  assert.ok(!ended.custom.writer?.enabled, "Ended playback retained a writer");
  const armRange = ended.ranges[mode]?.[openId(test.costume)];
  assert.ok(armRange && armRange.frames > 10, `Readout ranges lack ${mode} data for the open parameter`);
  const readout = await readoutText(page);
  assert.match(readout, new RegExp(`range ${openId(test.costume)}: .*${mode} \\d\\.\\d{3}\\.\\.\\d\\.\\d{3} \\(\\d+f\\)`),
    "Readout does not show the arm's open-parameter range line");
  await writeFile(resolve(output, `${label}-${mode}-frames.json`), JSON.stringify(frames));
  return { armed, started, ended, summary, pictures, custom: ended.custom, nativeArm: ended.nativeArm, ranges: ended.ranges };
}

export async function checkSuspendResume(test) {
  const { page } = test;
  await selectArm(page, "envelope");
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
  assert.equal(await nativeLipSync(page), true);
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
    assert.equal(await nativeLipSync(page), false);
    const image = resolve(output, `${label}-pose-${pose}.png`);
    await page.locator("canvas").screenshot({ path: image });
    cases.push({ pose, snapshot, image });
  }
  await speech(page).getByLabel("pose preview", { exact: true }).selectOption("off");
  assert.equal(await nativeLipSync(page), true);
  await speech(page).getByLabel("model view", { exact: true }).selectOption("full");
  return cases;
}

export async function checkReplacement(test) {
  const { page } = test;
  await selectArm(page, "envelope");
  await play(page);
  await selectArm(page, "native");
  const changedMode = await state(page);
  assert.equal(changedMode.audio.isPlaying, false);
  assert.equal(await nativeLipSync(page), true);
  await selectArm(page, "envelope");
  await play(page);
  // Keep the manager handle: the engine drops `internal.motionManager` when the model is destroyed.
  await page.evaluate(() => {
    const internal = window.__avatarLabTest.scene.current.internal;
    window.__avatarLabTest.retired = { internal, manager: internal.motionManager };
  });
  await loadCostume(page, test.costume === "arbeit" ? "live_01" : "arbeit");
  const switched = await state(page);
  assert.equal(switched.audio.isPlaying, false);
  assert.ok(!switched.custom.writer?.enabled);
  const retired = await page.evaluate(() => ({ native: window.__avatarLabTest.retired.internal.lipSync,
    playing: window.__avatarLabTest.retired.manager.currentAudio?.isPlaying ?? false }));
  assert.equal(retired.playing, false);
  assert.equal(retired.native, true);
  return { changedMode, switched, retired };
}

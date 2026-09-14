/**
 * INPUT:  a running lab, installed Playwright and a local WAV containing real speech with pauses.
 * OUTPUT: native speech playback/lifecycle assertions, per-frame mouth observations and browser screenshots.
 * POS:    experimental / lab - not in production path; mock synthesis is explicitly reported, never sent upstream.
 */
/* global console, window */

import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { loadCostume, openCostume, panel } from "./browser-driver.mjs";
import { saveSpeechCase, speechFrames, speechPictures, speechRanges, speechState } from "./speech-observations.mjs";

const modulePath = process.env.TAKI_LAB_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error("Set TAKI_LAB_PLAYWRIGHT_MODULE to an installed Playwright index.mjs");
const { chromium } = await import(pathToFileURL(resolve(modulePath)).href);
const output = resolve(process.argv[2] ?? ".trellis/.runtime/avatar-lab-speech");
const fixture = resolve(process.argv[3] ?? ".trellis/.runtime/avatar-lab-speech-20260908/system-voice.wav");
const audioBytes = await readFile(fixture);
const selected = process.argv.slice(4).length ? process.argv.slice(4) : ["arbeit", "live_01"];
const requested = process.env.TAKI_LAB_CASES?.split(",");
const cases = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });

const speechPanel = (page) => panel(page, "Speech");

async function play(page) {
  await speechPanel(page).getByRole("button", { name: "Play loaded clip", exact: true }).click();
  await page.waitForFunction(() => {
    const state = window.__avatarLabTest.speech.snapshot();
    return state.audio.isPlaying && state.audio.contextState === "running";
  }, undefined, { timeout: 15000 });
}

async function stop(page) {
  await speechPanel(page).getByRole("button", { name: "Stop speech", exact: true }).click();
  await page.waitForFunction(() => {
    const state = window.__avatarLabTest.speech.snapshot();
    return !state.audio.isPlaying && state.mouth.raw === null;
  });
}

async function loadFile(page) {
  await speechPanel(page).getByLabel("audio file", { exact: true }).setInputFiles(fixture);
  await page.waitForFunction(() => window.__avatarLabTest.speech.snapshot().clip !== null);
}

async function recordNative(test) {
  if (test.gain !== undefined) await speechPanel(test.page).getByLabel("lipSyncGain", { exact: true }).fill(String(test.gain));
  await loadFile(test.page);
  await play(test.page);
  const first = await speechState(test.page);
  assert.equal(first.audio.analyzerAvailable, true);
  assert.ok(first.audio.durationSeconds > 1, "decoded speech duration is unavailable");
  const framesPromise = speechFrames(test.page, first.audio.durationSeconds * 1000 + 900);
  await test.page.waitForFunction(() => window.__avatarLabTest.speech.snapshot().mouth.raw > 0.2);
  const picture = await speechPictures(test.page, output, test.label);
  const frames = await framesPromise;
  const ranges = speechRanges(frames);
  await test.page.waitForFunction(() => !window.__avatarLabTest.speech.snapshot().audio.isPlaying);
  const ended = await speechState(test.page);
  const settings = await test.page.evaluate(() => {
    const { lipSyncGain, lipSyncWeight } = window.__avatarLabTest.scene.current.internal.options;
    return { lipSyncGain, lipSyncWeight };
  });
  if (test.gain !== undefined) assert.equal(settings.lipSyncGain, test.gain);
  await saveSpeechCase(output, test.label, { settings, first, ended, ranges, picture, frames });
  assert.ok(ranges.frames > 20 && ranges.playing > 10, "rendered audio playback was not sustained");
  assert.ok(ranges.positive > 0 && ranges.zero > 0, "fixture must exercise speech and zero-valued pauses");
  assert.ok(Object.values(ranges.final).some(([min, max]) => max - min > 0.05), "final mouth parameter did not move");
  assert.ok(picture.pixels.foregroundRatio > 0.01, "model canvas is blank");
  assert.ok(picture.pixels.changedRatio > 0, "rendered model is static");
  assert.equal(picture.layout.pageOverflow || picture.layout.controlsOverflow, false, "layout overflows horizontally");
  assert.equal(ended.pendingNativeLoad, false);
  assert.equal(ended.mouth.raw, null, "finished playback still reports an active audio observation");
  assert.equal(ended.mouth.computedContribution, null);
  await play(test.page);
  await stop(test.page);
  const stopped = await speechState(test.page);
  assert.equal(stopped.mouth.computedContribution, null);
  assert.ok(stopped.sequence > first.sequence, "retained clip was not replayed");
  return { settings, ranges, picture, timing: ended.timing, mouth: ended.mouth, replayStopped: stopped };
}

async function replaceInput(test) {
  await loadFile(test.page);
  await play(test.page);
  await test.page.waitForFunction(() => window.__avatarLabTest.speech.snapshot().mouth.firstNonzeroMouthAtMs !== null);
  const before = await speechState(test.page);
  await stop(test.page);
  await speechPanel(test.page).getByLabel("audio file", { exact: true }).setInputFiles({
    name: "replacement.wav", mimeType: "audio/wav", buffer: audioBytes,
  });
  await test.page.waitForFunction(() => window.__avatarLabTest.speech.snapshot().clip?.name === "replacement.wav");
  const replacement = await speechState(test.page);
  assert.ok(Object.values(replacement.timing).every((value) => value === null), "unplayed replacement inherited old timing");
  assert.equal(replacement.mouth.firstNonzeroMouthAtMs, null);
  assert.equal(replacement.mouth.observedAudioToMouthMs, null);
  assert.equal(replacement.audio.isPlaying, false);
  return { before, replacement };
}

async function resumeAndSwitch(test) {
  await loadFile(test.page);
  await play(test.page);
  await test.page.evaluate(async () => {
    const ctx = window.__avatarLabTest.scene.current;
    window.__avatarLabTest.retiredAudioManager = ctx.internal.motionManager;
    await ctx.internal.motionManager.currentContext.suspend();
  });
  await test.page.waitForFunction(() => window.__avatarLabTest.speech.snapshot().audio.contextState === "suspended");
  const suspended = await speechState(test.page);
  await speechPanel(test.page).getByRole("button", { name: "Resume audio", exact: true }).click();
  await test.page.waitForFunction(() => window.__avatarLabTest.speech.snapshot().audio.contextState === "running");
  const resumed = await speechState(test.page);
  await loadCostume(test.page, test.costume === "arbeit" ? "live_01" : "arbeit");
  await test.page.waitForTimeout(400);
  const switched = await speechState(test.page);
  const retired = await test.page.evaluate(() => {
    const manager = window.__avatarLabTest.retiredAudioManager;
    return { isPlaying: manager.currentAudio?.isPlaying === true, audioPresent: manager.currentAudio != null,
      analyzerReferenceRetained: manager.currentAnalyzer != null };
  });
  assert.equal(retired.isPlaying || retired.audioPresent, false, "retired model retained native audio");
  assert.equal(switched.audio.isPlaying || switched.pendingNativeLoad, false);
  assert.equal(switched.mouth.raw, null, "replacement model inherited a stale mouth observation");
  return { suspended, resumed, switched, retired };
}

async function configureMockProvider(page) {
  const root = speechPanel(page);
  await root.getByLabel("provider", { exact: true }).selectOption("openai-compatible");
  await root.getByLabel("transport", { exact: true }).selectOption("proxy");
  await root.getByLabel("voice", { exact: true }).fill("system-fixture");
  await root.getByLabel("model", { exact: true }).fill("mock-synthesis");
  await root.getByLabel("speech text", { exact: true }).fill("Native engine playback test.");
  await root.getByLabel("format", { exact: true }).selectOption("wav");
}

async function synthesize(page) {
  await speechPanel(page).getByRole("button", { name: "Synthesize", exact: true }).click();
}

async function mockSuccess(test) {
  await configureMockProvider(test.page);
  let request;
  await test.page.route("**/lab-tts/local/**", async (route) => {
    request = { method: route.request().method(), body: route.request().postDataJSON() };
    await route.fulfill({ status: 200, contentType: "audio/wav", body: audioBytes });
  });
  await synthesize(test.page);
  await test.page.waitForFunction(() => window.__avatarLabTest.speech.snapshot().clip !== null);
  const ready = await speechState(test.page);
  assert.equal(ready.clip.providerId, "openai-compatible");
  assert.equal(ready.clip.bytes, audioBytes.length);
  assert.equal(request.method, "POST");
  await play(test.page);
  const playing = await speechState(test.page);
  await stop(test.page);
  return { source: "intercepted HTTP response with real local speech; not a live provider", request, ready, playing };
}

async function cancelledSynthesis(test, switchCostume) {
  await configureMockProvider(test.page);
  const blocked = Promise.withResolvers();
  const release = Promise.withResolvers();
  const finished = Promise.withResolvers();
  await test.page.route("**/lab-tts/local/**", async (route) => {
    blocked.resolve();
    await release.promise;
    try { await route.fulfill({ status: 200, contentType: "audio/wav", body: audioBytes }); }
    finally { finished.resolve(); }
  });
  await synthesize(test.page);
  await Promise.race([blocked.promise, test.page.waitForTimeout(5000).then(() => { throw new Error("synthesis was not intercepted"); })]);
  try {
    if (switchCostume) await loadCostume(test.page, test.costume === "arbeit" ? "live_01" : "arbeit");
    else await stop(test.page);
  } finally {
    release.resolve();
  }
  await finished.promise;
  await test.page.waitForTimeout(400);
  const cancelled = await speechState(test.page);
  assert.equal(cancelled.clip, null, "cancelled synthesis published a late clip");
  assert.equal(cancelled.audio.isPlaying || cancelled.pendingNativeLoad, false);
  assert.notEqual(cancelled.status, "synthesizing");
  return { source: "delayed intercepted HTTP; not a live provider", cancelled };
}

async function failedSynthesis(test) {
  await configureMockProvider(test.page);
  await test.page.route("**/lab-tts/local/**", (route) => route.fulfill({ status: 503,
    contentType: "application/json", body: JSON.stringify({ error: { message: "Fixture synthesis unavailable" } }) }));
  await synthesize(test.page);
  await test.page.waitForFunction(() => window.__avatarLabTest.speech.snapshot().status === "error");
  const failure = await speechState(test.page);
  assert.match(failure.error, /503.*Fixture synthesis unavailable/u);
  assert.equal(failure.clip, null);
  assert.equal(failure.audio.isPlaying || failure.pendingNativeLoad, false);
  return { source: "intercepted HTTP failure; not a live provider", failure };
}

async function failedDecode(test) {
  await speechPanel(test.page).getByLabel("audio file", { exact: true }).setInputFiles({
    name: "invalid.wav", mimeType: "audio/wav", buffer: audioBytes.subarray(0, 12),
  });
  await test.page.waitForFunction(() => window.__avatarLabTest.speech.snapshot().clip !== null);
  await speechPanel(test.page).getByRole("button", { name: "Play loaded clip", exact: true }).click();
  await test.page.waitForFunction(() => window.__avatarLabTest.speech.snapshot().status === "error");
  const failure = await speechState(test.page);
  assert.equal(failure.audio.isPlaying || failure.pendingNativeLoad, false);
  await loadFile(test.page);
  await play(test.page);
  await stop(test.page);
  return { failure, recovered: await speechState(test.page) };
}

const scenarios = [
  { id: "native-playback", run: recordNative },
  { id: "native-gain-one", run: (test) => recordNative({ ...test, gain: 1 }) },
  { id: "replace-input", run: replaceInput },
  { id: "resume-switch", run: resumeAndSwitch },
  { id: "mock-synthesis", run: mockSuccess },
  { id: "cancel-synthesis", run: (test) => cancelledSynthesis(test, false) },
  { id: "switch-synthesis", run: (test) => cancelledSynthesis(test, true) },
  { id: "failed-synthesis", run: failedSynthesis },
  { id: "failed-decode", run: failedDecode },
];

async function runCase(costume, scenario) {
  const label = `${costume}-${scenario.id}`;
  const { context, page, errors } = await openCostume(browser, costume, { speech: true });
  try {
    const evidence = await scenario.run({ page, costume, label });
    const failures = [...new Set(errors)];
    cases.push({ label, failures, evidence });
    console.log(JSON.stringify({ label, failures, ranges: evidence.ranges }));
  } catch (error) {
    await page.screenshot({ path: resolve(output, `${label}-failure.png`) }).catch(() => undefined);
    cases.push({ label, failures: [String(error), ...new Set(errors)], state: await speechState(page).catch(() => null) });
    console.error(`${label}: ${String(error)}`);
  } finally {
    await context.close();
    await writeFile(resolve(output, "summary.json"), JSON.stringify({ browser: browser.version(), fixture,
      providerLiveAcceptance: false, cases }, null, 2));
  }
}

try {
  for (const costume of selected) {
    for (const scenario of scenarios) {
      if (requested && !requested.includes(scenario.id)) continue;
      await runCase(costume, scenario);
    }
  }
} finally {
  await browser.close();
}
process.exitCode = cases.some((item) => item.failures.length > 0) ? 1 : 0;

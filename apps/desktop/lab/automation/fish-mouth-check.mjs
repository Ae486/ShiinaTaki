/**
 * INPUT:  a real Fish API key/reference voice in process environment and a running Lab dev server.
 * OUTPUT: provider, native and opt-in envelope/MouthWriter evidence for the same Fish clip on C2 and C3 models.
 * POS:    experimental / lab — not in production path; credentials are memory-only and generated media stays ignored.
 */
/* global window, performance, atob, fetch, TextDecoder, OfflineAudioContext, console */

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { inspectPixels } from "./browser-images.mjs";
import { openCostume, panel } from "./browser-driver.mjs";

const apiKey = process.env.TAKI_LAB_FISH_API_KEY;
const voiceId = process.env.TAKI_LAB_FISH_VOICE_ID;
const modelId = process.env.TAKI_LAB_FISH_MODEL ?? "s2.1-pro-free";
const text = process.env.TAKI_LAB_FISH_TEXT ?? "这是第一句。请暂停一下，然后继续说第二句。";
const playwrightModule = process.env.TAKI_LAB_PLAYWRIGHT_MODULE;
if (!apiKey || !voiceId) throw new Error("Set TAKI_LAB_FISH_API_KEY and TAKI_LAB_FISH_VOICE_ID in the process environment");
if (!playwrightModule) throw new Error("Set TAKI_LAB_PLAYWRIGHT_MODULE to an installed Playwright index.mjs");

const output = resolve(process.argv[2] ?? ".trellis/.runtime/avatar-lab-fish-mouth-20260910");
const fixture = resolve(output, "fish-live.wav");
const selected = process.argv.slice(3).length ? process.argv.slice(3) : ["arbeit", "live_01"];
await mkdir(output, { recursive: true });

const { chromium } = await import(pathToFileURL(resolve(playwrightModule)).href);
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });

async function requestFish() {
  const startedAt = performance.now();
  const response = await fetch("https://api.fish.audio/v1/tts", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", model: modelId },
    body: JSON.stringify({ text, reference_id: voiceId, format: "wav", prosody: { speed: 1 }, latency: "normal" }),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) {
    const detail = new TextDecoder().decode(bytes).slice(0, 300);
    throw new Error(`Fish synthesis failed (${response.status}): ${detail}`);
  }
  assert.ok(bytes.byteLength > 1000, "Fish returned an unexpectedly small audio body");
  await writeFile(fixture, bytes);
  return { bytes, synthesisMs: performance.now() - startedAt };
}

async function loadClip(page) {
  const root = panel(page, "Speech");
  await root.getByLabel("audio file", { exact: true }).setInputFiles(fixture);
  await page.waitForFunction(() => window.__avatarLabTest.speech.snapshot().clip !== null);
}

async function installCapture(page, kind) {
  await page.evaluate((captureKind) => {
    const ctx = window.__avatarLabTest.scene.current;
    const capture = { kind: captureKind, frames: [], sawPlaying: false, done: false };
    let off = () => undefined;
    off = ctx.hooks.add("beforeModelUpdate", () => {
      const speech = window.__avatarLabTest.speech.snapshot();
      const manager = ctx.internal.motionManager;
      const custom = window.__avatarLabTest.custom;
      const raw = manager.currentAudio && manager.currentAnalyzer ? manager.mouthSync() : null;
      const writer = custom?.writer?.snapshot();
      capture.frames.push({
        atMs: performance.now(), playing: speech.audio.isPlaying, raw,
        final: Object.fromEntries(ctx.facts.lipSyncIds.map((id) => [id, ctx.params.has(id) ? ctx.params.get(id) : null])),
        writer: writer ? { active: writer.active, fallback: writer.fallback, elapsedMs: writer.elapsedMs,
          openness: writer.sample.openness, mouth: writer.sample.mouth, writes: writer.writes.length } : null,
      });
      if (speech.audio.isPlaying) capture.sawPlaying = true;
      if (capture.sawPlaying && !speech.audio.isPlaying) { capture.done = true; off(); }
    });
    window.__avatarLabTest.capture = capture;
  }, kind);
}

async function finishCapture(page) {
  await page.waitForFunction(() => window.__avatarLabTest.capture?.done === true, undefined, { timeout: 30000 });
  return page.evaluate(() => {
    const capture = window.__avatarLabTest.capture;
    delete window.__avatarLabTest.capture;
    return capture?.frames ?? [];
  });
}

async function play(page) {
  await panel(page, "Speech").getByRole("button", { name: "Play loaded clip", exact: true }).click();
  await page.waitForFunction(() => {
    const state = window.__avatarLabTest.speech.snapshot();
    return state.audio.isPlaying && state.audio.contextState === "running";
  }, undefined, { timeout: 15000 });
}

async function playAndCapture(page, kind) {
  await installCapture(page, kind);
  await play(page);
  return finishCapture(page);
}

async function attachCustomWriter(page, bytes) {
  const base64 = Buffer.from(bytes).toString("base64");
  return page.evaluate(async (encoded) => {
    const ctx = window.__avatarLabTest.scene.current;
    const setupStartedAt = performance.now();
    const binary = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const decoder = new OfflineAudioContext(1, 1, 44100);
    const decodeStartedAt = performance.now();
    const audio = await decoder.decodeAudioData(binary.buffer);
    const decodeMs = performance.now() - decodeStartedAt;
    const [{ analyzeMouthEnvelope }, { createMouthTrack }, { getMouthProfile }, { createMouthWriter }] = await Promise.all([
      import("/lab/scene/mouth-envelope.ts"), import("/lab/scene/mouth-track.ts"),
      import("/lab/scene/mouth-profile.ts"), import("/lab/scene/mouth-writer.ts"),
    ]);
    const envelopeStartedAt = performance.now();
    const envelope = analyzeMouthEnvelope({ pcm: audio.getChannelData(0), sampleRate: audio.sampleRate });
    const envelopeMs = performance.now() - envelopeStartedAt;
    const cues = envelope.frames.flatMap((frame) => {
      const endMs = Math.min(envelope.durationMs, frame.timeMs + envelope.frameMs);
      return endMs <= frame.timeMs ? [] : [{ startMs: frame.timeMs, endMs,
        mouth: frame.closed || frame.value === 0 ? "rest" : "open", openness: frame.value, confidence: 1 }];
    });
    const track = createMouthTrack({ durationMs: envelope.durationMs, cues, source: "envelope", approximate: false });
    const profile = getMouthProfile(ctx.entry.costume);
    if (profile === null) throw new Error(`No measured mouth profile for ${ctx.entry.costume}`);
    const previousLipSync = ctx.internal.lipSync;
    ctx.internal.lipSync = false;
    const state = { startedAt: null };
    const clock = () => {
      if (state.startedAt === null && ctx.internal.motionManager.currentAudio?.isPlaying) state.startedAt = performance.now();
      return state.startedAt === null ? 0 : performance.now() - state.startedAt;
    };
    const writer = createMouthWriter({ hooks: ctx.hooks, params: ctx.params, profile, track, clock });
    window.__avatarLabTest.custom = { writer, previousLipSync, state };
    return { durationMs: envelope.durationMs, frameCount: envelope.frames.length,
      closures: envelope.frames.filter((frame) => frame.closed).length, peak: envelope.peak, decodeMs, envelopeMs,
      writerSetupMs: performance.now() - setupStartedAt };
  }, base64);
}

async function resetCustomWriter(page) {
  await page.evaluate(() => {
    const custom = window.__avatarLabTest.custom;
    const ctx = window.__avatarLabTest.scene.current;
    custom?.writer?.dispose();
    if (custom) ctx.internal.lipSync = custom.previousLipSync;
    delete window.__avatarLabTest.custom;
  });
}

async function captureWriterImages(page, label) {
  await page.waitForFunction(() => window.__avatarLabTest.capture?.frames.some((frame) => frame.playing && frame.writer?.active && frame.writer.openness > 0.1) === true, undefined, { timeout: 15000 });
  await page.locator("canvas").screenshot({ path: resolve(output, `${label}-model.png`) });
  await page.waitForTimeout(180);
  await page.locator("canvas").screenshot({ path: resolve(output, `${label}-model-next.png`) });
  return inspectPixels(output, label);
}

function range(values) {
  return values.length ? [Math.min(...values), Math.max(...values)] : [null, null];
}

function summarize(frames) {
  const raw = frames.map((frame) => frame.raw).filter((value) => typeof value === "number" && Number.isFinite(value));
  const final = frames.flatMap((frame) => Object.values(frame.final ?? {}))
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const writerRows = frames.map((frame) => frame.writer).filter((value) => value !== null && typeof value === "object");
  const active = writerRows.filter((row) => row.active === true);
  const playing = frames.filter((frame) => frame.playing === true);
  const audioStartAtMs = playing[0]?.atMs ?? null;
  const firstRawAtMs = frames.find((frame) => frame.playing === true && typeof frame.raw === "number" && frame.raw > 0.05)?.atMs ?? null;
  const firstWriterAtMs = frames.find((frame) => frame.playing === true && frame.writer?.active === true && frame.writer.openness > 0.1)?.atMs ?? null;
  return { frames: frames.length, playingFrames: frames.filter((frame) => frame.playing === true).length,
    positiveRawFrames: raw.filter((value) => value > 0).length, rawRange: range(raw), finalRange: range(final),
    writerActiveFrames: active.length, writerFallbackFrames: writerRows.filter((row) => row.fallback === true).length,
    writerOpennessRange: range(active.map((row) => row.openness).filter((value) => typeof value === "number")),
    timing: { audioStartAtMs, firstRawAtMs, firstWriterAtMs,
      audioToRawMs: audioStartAtMs !== null && firstRawAtMs !== null ? firstRawAtMs - audioStartAtMs : null,
      audioToWriterMs: audioStartAtMs !== null && firstWriterAtMs !== null ? firstWriterAtMs - audioStartAtMs : null },
  };
}

const fish = await requestFish();
const bytes = fish.bytes;
const results = [];
try {
  for (const costume of selected) {
    const { context, page, errors } = await openCostume(browser, costume, { speech: true });
    try {
      await loadClip(page);
      const nativeFrames = await playAndCapture(page, "native");
      const native = summarize(nativeFrames);
      assert.ok(native.playingFrames > 10, `${costume}: native playback did not sustain`);
      assert.ok(native.positiveRawFrames > 0, `${costume}: native mouthSync never became positive`);
      assert.ok((native.finalRange[1] ?? 0) > (native.finalRange[0] ?? 0), `${costume}: native final mouth parameter did not move`);

      await loadClip(page);
      const track = await attachCustomWriter(page, bytes);
      const customFramesPromise = playAndCapture(page, "custom");
      const imagesPromise = captureWriterImages(page, `${costume}-custom`);
      const customFrames = await customFramesPromise;
      const images = await imagesPromise;
      const custom = summarize(customFrames);
      assert.ok(custom.writerActiveFrames > 0, `${costume}: custom writer never became active`);
      assert.ok((custom.writerOpennessRange[1] ?? 0) > 0, `${costume}: custom writer openness stayed zero`);
      assert.ok(images.foregroundRatio > 0.01, `${costume}: custom canvas is blank`);
      assert.ok(images.changedRatio > 0, `${costume}: custom canvas did not change`);
      await resetCustomWriter(page);
      results.push({ costume, generation: (await page.evaluate(() => window.__avatarLabTest.scene.current.facts.generation)), track, native, custom, images, errors });
      console.log(JSON.stringify({ costume, native, custom, track, images, errors }));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
const report = { provider: "fish-audio", model: modelId, text, bytes: bytes.byteLength, synthesisMs: fish.synthesisMs, costumes: results };
await writeFile(resolve(output, "summary.json"), JSON.stringify(report, null, 2));

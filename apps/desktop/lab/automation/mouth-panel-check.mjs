/**
 * INPUT:  a running Lab, installed Playwright and an existing Fish WAV (or explicitly enabled live Fish synthesis).
 * OUTPUT: normal-panel C2/C3 desktop/mobile acceptance with snapshots, actual mouth parameters and screenshots.
 * POS:    experimental / lab - not in production path; credentials are never written to generated evidence.
 */
/* global window, console */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { openCostume } from "./browser-driver.mjs";
import { checkPoses, checkReplacement, checkSuspendResume, comparePlayback, loadPanelClip, speech, state } from "./mouth-panel-scenarios.mjs";

const installed = process.env.TAKI_LAB_PLAYWRIGHT_MODULE;
if (!installed) throw new Error("Set TAKI_LAB_PLAYWRIGHT_MODULE to an installed Playwright index.mjs");
const output = resolve(process.argv[2] ?? ".trellis/.runtime/avatar-lab-panel-20260911/check");
let fixture = resolve(process.env.TAKI_LAB_FISH_FIXTURE ?? ".trellis/.runtime/avatar-lab-fish-mouth-20260910-final/fish-live.wav");
let audioBytes = await readFile(fixture);
const live = process.env.TAKI_LAB_FISH_LIVE === "1";
const apiKey = process.env.TAKI_LAB_FISH_API_KEY ?? "";
if (live && (!apiKey || !process.env.TAKI_LAB_FISH_VOICE_ID)) throw new Error("Live synthesis requires Fish credentials in process environment");
const requested = process.env.TAKI_LAB_CASES?.split(",");
const costumes = process.argv.slice(3).length ? process.argv.slice(3) : ["arbeit", "live_01"];
const viewports = process.env.TAKI_LAB_PANEL_DESKTOP_ONLY === "1" ? [[1440, 1000]] : [[1440, 1000], [390, 844]];
const { chromium } = await import(pathToFileURL(resolve(installed)).href);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
const results = [];
/** Per costume/viewport: the final side-by-side ranges of the three arms on the same retained clip. */
const armRanges = {};
let providerEvidence = null;

async function synthesize(page) {
  const root = speech(page);
  await root.getByLabel("provider", { exact: true }).selectOption("fish-audio");
  await root.getByLabel("transport", { exact: true }).selectOption("proxy");
  await root.getByLabel("API key", { exact: true }).fill(live ? apiKey : "lab-fixture-key");
  await root.getByLabel("voice", { exact: true }).fill(live ? process.env.TAKI_LAB_FISH_VOICE_ID : "lab-fixture-voice");
  await root.getByLabel("model", { exact: true }).fill("s2.1-pro-free");
  await root.getByLabel("format", { exact: true }).selectOption("wav");
  await root.getByLabel("speech text", { exact: true }).fill("这是第一句。请暂停一下，然后继续说第二句。");
  if (!live) await page.route("**/lab-tts/fish/v1/tts", (route) => route.fulfill({ status: 200, contentType: "audio/wav", body: audioBytes }));
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/lab-tts/fish/v1/tts"));
  await root.getByRole("button", { name: "Synthesize", exact: true }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, "Fish synthesis response failed");
  const returned = await response.body();
  await root.getByLabel("API key", { exact: true }).fill("");
  await page.waitForFunction(() => window.__avatarLabTest.speech.snapshot().custom.preparation.status === "ready",
    undefined, { timeout: 20000 });
  const prepared = await state(page);
  assert.equal(prepared.clip.providerId, "fish-audio");
  assert.equal(prepared.audio.isPlaying, false, "Synthesize should prepare without auto-playing");
  if (live) {
    audioBytes = returned;
    fixture = resolve(output, "fish-live.wav");
    await writeFile(fixture, returned);
  } else await page.unroute("**/lab-tts/fish/v1/tts");
  return { liveProvider: live, source: live ? "Fish via normal Speech panel proxy" : "intercepted Fish response using retained real Fish audio",
    status: response.status(), bytes: returned.byteLength, prepared };
}

async function runScenario(test, id, run) {
  if (requested && !requested.includes(id)) return;
  try {
    const evidence = await run(test);
    const errors = [...new Set(test.errors)];
    assert.equal(errors.length, 0, `Page errors: ${errors.join(", ")}`);
    if (evidence?.ranges) armRanges[test.label] = evidence.ranges;
    results.push({ label: `${test.label}-${id}`, passed: true, evidence });
    console.log(JSON.stringify({ label: `${test.label}-${id}`, passed: true }));
  } catch (error) {
    await speech(test.page).getByLabel("API key", { exact: true }).fill("").catch(() => undefined);
    const detail = apiKey ? String(error).replaceAll(apiKey, "[redacted]") : String(error);
    results.push({ label: `${test.label}-${id}`, passed: false, error: detail,
      snapshot: await state(test.page).catch(() => null) });
    await test.page.screenshot({ path: resolve(output, `${test.label}-${id}-failure.png`) }).catch(() => undefined);
    console.log(JSON.stringify({ label: `${test.label}-${id}`, passed: false, error: detail }));
  }
  await saveReport();
}

async function saveReport() {
  await writeFile(resolve(output, "summary.json"), JSON.stringify({ browser: browser.version(), fixture,
    clipSha256: createHash("sha256").update(audioBytes).digest("hex"), providerEvidence, armRanges, results }, null, 2));
}

async function runSuite(costume, viewport) {
  process.env.TAKI_LAB_VIEWPORT_WIDTH = String(viewport[0]);
  process.env.TAKI_LAB_VIEWPORT_HEIGHT = String(viewport[1]);
  const { context, page, errors } = await openCostume(browser, costume, { speech: true });
  const test = { page, errors, costume, output, label: `${costume}-${viewport[0]}` };
  try {
    if (providerEvidence === null) providerEvidence = await synthesize(page);
    else await loadPanelClip(page, fixture);
    await runScenario(test, "native", (value) => comparePlayback(value, "native"));
    await runScenario(test, "native-tuned", (value) => comparePlayback(value, "native-tuned"));
    await runScenario(test, "envelope", (value) => comparePlayback(value, "envelope"));
    await runScenario(test, "suspend-resume", checkSuspendResume);
    await runScenario(test, "poses", checkPoses);
    await runScenario(test, "replacement", checkReplacement);
  } finally { await context.close(); }
}

try {
  for (const viewport of viewports) {
    for (const costume of costumes) await runSuite(costume, viewport);
  }
} finally {
  await saveReport();
  await browser.close();
}
process.exitCode = results.some((result) => !result.passed) ? 1 : 0;

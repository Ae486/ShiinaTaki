/**
 * INPUT:  running lab URL, an installed Playwright module, and an evidence output directory.
 * OUTPUT: isolated browser regressions, screenshots, frame samples, and JSON findings for the Phase 2 gate.
 * POS:    experimental / lab - not in production path; scene access is injected only into test responses.
 */
/* global console */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { capture, openCostume } from "./browser-driver.mjs";
import { scenarios } from "./browser-scenarios.mjs";
import { createContactSheet } from "./browser-images.mjs";

const modulePath = process.env.TAKI_LAB_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error("Set TAKI_LAB_PLAYWRIGHT_MODULE to an installed Playwright index.mjs");
const { chromium } = await import(pathToFileURL(resolve(modulePath)).href);
const output = resolve(process.argv[2] ?? ".trellis/.runtime/avatar-lab-browser");
const selected = process.argv.slice(3).length ? process.argv.slice(3) : ["arbeit", "live_01"];
const requested = process.env.TAKI_LAB_CASES?.split(",");
const cases = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });

function verify(result, scenario) {
  const failures = [];
  const moving = result.frames.filter((row) => row.motion || row.parallel.some(Boolean)).length;
  if (result.frames.length < 10) failures.push("insufficient rendered frames");
  if (result.pixels.foregroundRatio < 0.01) failures.push("model screenshot is blank");
  if (result.pixels.changedRatio === 0) failures.push("model screenshot did not change between frames");
  const expected = scenario.expected;
  if (["smiling", "filtered", "parallel-filtered", "parallel-mixed"].includes(expected)) {
    if (moving < result.frames.length * 0.7) failures.push("motion did not remain active");
    const id = result.generation === "cubism2" ? "PARAM_EYE_FORM" : "Paramsmile01";
    if (result.ranges[id]?.final.some((value) => value === null || Math.abs(value - 1) > 0.05) ?? true) failures.push("smile probe was not held at 1");
    if (/expression\([^\n]+\) -> false/u.test(result.readout)) failures.push("Set was rejected");
    const form = result.generation === "cubism2" ? "PARAM_BROW_R_FORM" : "ParamBrowLForm";
    const expectedForm = result.generation === "cubism2" ? 0.5 : 0.3;
    if (result.ranges[form]?.final.some((value) => value === null || Math.abs(value - expectedForm) > 0.05) ?? true) failures.push("brow form did not preserve the expression");
  }
  if (["unapplied", "unavailable"].includes(expected) && /expression (survives motion|parameter probe): (yes|no)/u.test(result.readout)) failures.push("unapplied expression was assigned a survival verdict");
  if (expected === "reference" && /expression (survives motion|parameter probe): (yes|no)/u.test(result.readout)) failures.push("idle reference was assigned a motion survival verdict");
  if (expected === "stopped" && moving !== 0) failures.push("Stop all did not keep every channel stopped");
  if (expected === "unavailable" && !/n\/a|unavailable|unknown/iu.test(result.readout)) failures.push("missing parameter was not disclosed");
  failures.push(...verifyCache(result, scenario));
  return failures;
}

function verifyCache(result, scenario) {
  const failures = [];
  const legacy = result.generation === "cubism2";
  const group = scenario.id.startsWith("eyes-") ? (legacy ? "idle01" : "mtn_idle01_C") : (legacy ? "angry02" : "mtn_angry02_C");
  const curves = result.cache[group]?.[0];
  const filtered = ["filtered", "parallel-filtered"].includes(scenario.expected) || scenario.id.startsWith("eyes-");
  if (filtered) {
    const count = legacy ? (scenario.id.endsWith("included") ? 42 : 44) : 54;
    if (curves !== count) failures.push(`filtered cache count ${curves} differs from expected ${count}`);
  }
  if (["motion-only", "expression-then-unfiltered", "unfiltered-then-expression", "cache-invalidated-replay", "parallel-one-unfiltered"].includes(scenario.id)) {
    if (curves !== (legacy ? 64 : 105)) failures.push(`unfiltered cache count ${curves} is incorrect`);
  }
  if (scenario.expected?.startsWith("parallel-") && !result.frames.some((row) => row.motion && row.parallel[0])) failures.push("primary and parallel did not run together");
  if (["pending-set-reset", "pending-set-switch", "failed-set"].includes(scenario.id) && result.expression.currentIndex !== -1) failures.push("cancelled/failed Set became the current expression");
  return failures;
}

async function runCase(costume, scenario) {
  const { context, page, errors } = await openCostume(browser, costume);
  const test = {
    page, costume, output, id: scenario.id,
    name: costume === "arbeit" ? "smile01" : "exp_smile01",
    group: costume === "arbeit" ? "angry02" : "mtn_angry02_C",
    idle: costume === "arbeit" ? "idle01" : "mtn_idle01_C",
  };
  try {
    await scenario.run(test);
    const result = await capture(page, { output, label: `${costume}-${scenario.id}`, frameMs: scenario.frameMs });
    const failures = [...verify(result, scenario), ...new Set(errors)];
    cases.push({ label: result.label, failures, frames: result.frames.length, playingFrames: result.frames.filter((row) => row.motion || row.parallel.some(Boolean)).length, ranges: result.ranges, cache: result.cache, expression: result.expression, pixels: result.pixels, errors, findings: result.readout.split("findings:")[1] });
    console.log(JSON.stringify({ case: result.label, frames: result.frames.length, failures, last: result.readout.split("findings:")[1]?.trim().split("\n").slice(-3) }));
  } catch (error) {
    cases.push({ label: `${costume}-${scenario.id}`, failures: [String(error)] });
    console.error(`${costume}-${scenario.id}: ${String(error)}`);
  } finally {
    await context.close();
    await writeFile(resolve(output, "summary.json"), JSON.stringify({ browser: browser.version(), cases }, null, 2));
  }
}

try {
  for (const costume of selected) {
    for (const scenario of scenarios) {
      if (scenario.only && scenario.only !== costume) continue;
      if (requested ? !requested.includes(scenario.id) : scenario.diagnostic) continue;
      await runCase(costume, scenario);
    }
  }
  await createContactSheet(browser, output);
  await createContactSheet(browser, output, "reset");
} finally {
  await browser.close();
}
process.exitCode = cases.some((item) => item.failures.length > 0) ? 1 : 0;

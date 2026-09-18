/**
 * INPUT:  the running isolated lab and installed Playwright, with real arbeit/live_01 models.
 * OUTPUT: declared mouth ranges, direct parameter pose screenshots, exact frame readbacks and comparison sheets.
 * POS:    research-only browser experiment; no source/engine patches, audio requests, or production state writes.
 */
/* global window, document, Image, console */

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { openCostume } from "../../../../apps/desktop/lab/automation/browser-driver.mjs";

const installed = process.env.TAKI_LAB_PLAYWRIGHT_MODULE;
if (!installed) throw new Error("Set TAKI_LAB_PLAYWRIGHT_MODULE to an installed Playwright index.mjs");
const { chromium } = await import(pathToFileURL(resolve(installed)).href);
const { PNG } = createRequire(resolve(installed))("./lib/utilsBundle.js");
const output = resolve(process.argv[2] ?? ".trellis/.runtime/avatar-lab-mouth-poses-20260908");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });

async function prepare(page) {
  return page.evaluate(() => {
    const ctx = window.__avatarLabTest.scene.current;
    const core = ctx.internal.coreModel;
    const legacy = core.getModelContext?.();
    // The legacy runtime has no public enumerator. These observed fields are pinned to this installed runtime:
    // setParamFloat's source clamps against _$Rr/_$Or; _$pb contains the IDs before any candidate is touched.
    const rows = legacy ? legacy["_$pb"].map((entry, index) => entry ? ({ id: entry.id, index,
      min: legacy["_$Rr"][index], max: legacy["_$Or"][index], value: core.getParamFloat(index) }) : null).filter(Boolean)
      : ctx.params.listIds().map((id, index) => ({ id, index, min: core.getParameterMinimumValue(index),
        max: core.getParameterMaximumValue(index), value: core.getParameterDefaultValue(index) }));
    const mouths = rows.filter(({ id }) => /mouth/i.test(id) || ["Param9", "Param16", "Param30", "Param31"].includes(id));
    ctx.internal.motionManager.stopAllMotions();
    ctx.internal.lipSync = false;
    const state = { values: {}, observed: {}, rows };
    window.__avatarLabTest.poseProbe = state;
    ctx.hooks.add("beforeModelUpdate", () => {
      for (const { id, value } of rows) ctx.params.set(id, value);
      for (const [id, value] of Object.entries(state.values)) ctx.params.set(id, value);
      state.observed = Object.fromEntries(Object.keys(state.values).map((id) => [id, ctx.params.get(id)]));
    });
    const stage = window.__avatarLabTest.app.screen;
    const anchor = { x: stage.width * 0.5, y: stage.height * (legacy ? 0.38 : 0.237) };
    const center = { x: stage.width * 0.5, y: stage.height * 0.5 };
    const position = { x: ctx.model.x, y: ctx.model.y };
    ctx.model.scale.set(ctx.model.scale.x * 4, ctx.model.scale.y * 4);
    ctx.model.position.set(center.x - (anchor.x - position.x) * 4, center.y - (anchor.y - position.y) * 4);
    return { costume: ctx.entry.costume, generation: ctx.facts.generation, lipSyncIds: ctx.facts.lipSyncIds,
      rows: mouths, legacySetter: legacy?.setParamFloat.toString() ?? null };
  });
}

function poseCases(facts) {
  const legacy = facts.generation === "cubism2";
  const open = legacy ? "PARAM_MOUTH_OPEN_Y" : "ParamMouthOpenY";
  const form = legacy ? "PARAM_MOUTH_FORM_01" : "ParamMouthForm";
  if (process.env.TAKI_MOUTH_POSE_SET === "candidates") {
    const presets = legacy ? [
      ["closed-MBP", 0, 0, {}], ["candidate-A", 0.9, -0.5, {}],
      ["candidate-E", 0.4, 0, {}], ["candidate-I", 0.22, 1, {}],
      ["candidate-O", 0.7, -0.5, { PARAM_MOUTH_SCALE: -1 }],
      ["candidate-U", 0.45, -0.5, { PARAM_MOUTH_SCALE: -1 }],
      ["candidate-U-umlaut", 0.35, -0.2, { PARAM_MOUTH_SCALE: -1 }],
    ] : [
      ["closed-MBP", 0, 0, {}], ["candidate-A", 0.85, 0, {}],
      ["candidate-E", 0.35, 0.45, {}], ["candidate-I", 0.22, 1, {}],
      ["candidate-O", 0.6, -1, {}],
      ["candidate-U", 0.48, -1, { Param31: -1, Param16: -1 }],
      ["candidate-U-umlaut", 0.32, -0.6, { Param31: -0.65 }],
    ];
    return presets.map(([label, amount, shape, extra]) => ({ label,
      values: { [open]: amount, [form]: shape, ...extra } }));
  }
  const cases = [{ label: "neutral", values: { [open]: 0, [form]: 0 } }];
  for (const amount of [0.25, 0.5, 0.75, 1]) cases.push({ label: `open-${amount}`, values: { [open]: amount, [form]: 0 } });
  for (const param of facts.rows.filter((row) => row.id !== open)) {
    for (const value of [param.min, param.max]) {
      cases.push({ label: `${param.id}-${value}`, values: { [open]: 0.5, [param.id]: value } });
    }
  }
  const poses = { aa: [0.55, 0], ow: [0.34, -0.72], iy: [0.28, 0.82], uw: [0.22, -1], mbp: [0, 0], fv: [0.18, 0.32] };
  for (const [name, [amount, shape]] of Object.entries(poses)) cases.push({ label: `bandori-${name}`, values: { [open]: amount, [form]: shape } });
  if (legacy) cases.push({ label: "bandori-unmapped-form", values: { [open]: 0.5, PARAM_MOUTH_FORM: 1 }, phantomDiagnostic: true });
  return cases;
}

function pixelDifference(first, second) {
  let changed = 0;
  let total = 0;
  for (let at = 0; at < first.data.length; at += 4) {
    const difference = [0, 1, 2].reduce((sum, channel) => sum + Math.abs(first.data[at + channel] - second.data[at + channel]), 0);
    total += difference;
    if (difference > 12) changed += 1;
  }
  return { changedPixels: changed, meanChannelDifference: total / (first.width * first.height * 3) };
}

async function capturePose(page, item, facts) {
  await page.evaluate((values) => { window.__avatarLabTest.poseProbe.values = values; }, item.values);
  await page.waitForTimeout(140);
  const observed = await page.evaluate(() => window.__avatarLabTest.poseProbe.observed);
  for (const [id, wanted] of Object.entries(item.values)) {
    const param = facts.rows.find((row) => row.id === id);
    if (!param) continue;
    const clamped = Math.max(param.min, Math.min(param.max, wanted));
    assert.ok(Math.abs(observed[id] - clamped) < 0.001, `${id} did not hold ${clamped}`);
  }
  const canvas = await page.locator("canvas").boundingBox();
  const clip = { x: canvas.x + canvas.width / 2 - 210, y: canvas.y + canvas.height / 2 - 145, width: 420, height: 290 };
  const file = resolve(output, `${facts.costume}-${item.label}.png`);
  const bytes = await page.screenshot({ path: file, clip });
  return { ...item, observed, image: file, png: PNG.sync.read(bytes) };
}

async function contactSheet(facts, cases) {
  const page = await browser.newPage();
  try {
    const cells = [];
    for (const item of cases) cells.push({ label: item.label, observed: item.observed,
      data: `data:image/png;base64,${(await readFile(item.image)).toString("base64")}` });
    const data = await page.evaluate(async ({ title, cells }) => {
      const canvas = document.createElement("canvas");
      const columns = 4, cellWidth = 440, cellHeight = 355;
      canvas.width = columns * cellWidth;
      canvas.height = 65 + Math.ceil(cells.length / columns) * cellHeight;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fafafa"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#141414"; ctx.font = "bold 23px Arial"; ctx.fillText(title, 15, 34);
      for (const [index, cell] of cells.entries()) {
        const x = index % columns * cellWidth + 10, y = Math.floor(index / columns) * cellHeight + 65;
        const img = new Image(); img.src = cell.data; await img.decode();
        ctx.drawImage(img, x, y, 420, 290);
        ctx.font = "18px Arial"; ctx.fillStyle = "#141414"; ctx.fillText(cell.label, x, y + 314);
        ctx.font = "12px monospace";
        const label = Object.entries(cell.observed).map(([id, value]) => `${id}=${Number(value).toFixed(2)}`).join(" ");
        ctx.fillText(label, x, y + 335, 420);
      }
      return canvas.toDataURL("image/png");
    }, { title: `${facts.costume}: actual rig parameter poses (diagnostic, no phoneme alignment)`, cells });
    const file = resolve(output, `${facts.costume}-contact-sheet.png`);
    await writeFile(file, Buffer.from(data.split(",")[1], "base64"));
    return file;
  } finally { await page.close(); }
}

const results = [];
try {
  for (const costume of ["arbeit", "live_01"]) {
    const { context, page, errors } = await openCostume(browser, costume);
    try {
      const facts = await prepare(page);
      const cases = [];
      for (const item of poseCases(facts)) cases.push(await capturePose(page, item, facts));
      const baselineCase = cases.find((item) => item.label === "open-0.5") ?? cases[0];
      const baseline = baselineCase.png;
      const sheet = await contactSheet(facts, cases);
      const report = { facts, errors, sheet, pixelBaseline: baselineCase.label,
        cases: cases.map(({ png, ...item }) => ({ ...item, difference: pixelDifference(baseline, png) })) };
      await writeFile(resolve(output, `${costume}.json`), JSON.stringify(report, null, 2));
      results.push(report);
      console.log(JSON.stringify({ costume, errors, sheet, parameters: facts.rows, cases: cases.length }));
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(resolve(output, "summary.json"), JSON.stringify({ results }, null, 2));
process.exitCode = results.some((result) => result.errors.length > 0) ? 1 : 0;

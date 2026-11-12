/**
 * INPUT:  Playwright pages on the lab and an output directory for local evidence.
 * OUTPUT: real UI actions, isolated model loads, frame samples, screenshots, and cache/manager observations.
 * POS:    experimental / lab - not in production path; no product or engine source is patched.
 */
/* global window, document, performance, setTimeout */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

import { inspectPixels } from "./browser-images.mjs";

export const origin = process.env.TAKI_LAB_URL ?? "http://localhost:1420";

export function panel(page, title) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

export async function openCostume(browser, costume, options = {}) {
  const width = Number(process.env.TAKI_LAB_VIEWPORT_WIDTH ?? 1440);
  const height = Number(process.env.TAKI_LAB_VIEWPORT_HEIGHT ?? 1000);
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route("**/lab/page/main.ts*", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const anchor = "const scene = createLabScene(app);";
    if (!source.includes(anchor)) throw new Error("Lab bootstrap changed; update the test injection anchor");
    let body = source.replace(anchor, `${anchor}\nwindow.__avatarLabTest = { app, scene };`);
    if (options.speech) {
      const speechAnchor = "const speech = mountPanelSpeech(deps);";
      if (!body.includes(speechAnchor)) throw new Error("Speech bootstrap changed; update the test injection anchor");
      body = body.replace(speechAnchor, `${speechAnchor}\nwindow.__avatarLabTest.speech = speech;`);
    }
    await route.fulfill({ response, body });
  });
  await page.goto(`${origin}/lab/lab.html`);
  await loadCostume(page, costume);
  return { context, page, errors };
}

export async function loadCostume(page, costume) {
  const model = panel(page, "Model");
  await model.locator("select").nth(0).selectOption("taki");
  await model.locator("select").nth(1).selectOption(costume);
  await model.getByRole("button", { name: "Load", exact: true }).click();
  await page.waitForFunction((name) => window.__avatarLabTest?.scene.current?.entry.costume === name, costume);
  await page.evaluate(() => {
    const ctx = window.__avatarLabTest.scene.current;
    const body = ctx.facts.generation === "cubism2" ? ["PARAM_ANGLE_X", "PARAM_ANGLE_Y", "PARAM_BODY_ANGLE_X"] : ["ParamAngleX", "ParamAngleY", "ParamBodyAngleX"];
    ctx.sampler.track([...ctx.facts.faceSet.map((param) => param.id), ...body]);
  });
}

export async function expression(page, name, options = {}) {
  const root = panel(page, "Expression");
  await root.locator("select").selectOption(name);
  await root.getByRole("button", { name: "Set", exact: true }).click();
  if (options.settle !== false) await page.waitForTimeout(1600);
}

export async function reset(page) {
  await panel(page, "Expression").getByRole("button", { name: "Reset", exact: true }).click();
}

export async function motion(page, options) {
  const root = panel(page, "Motion");
  await root.locator("select").nth(0).selectOption(options.group);
  await root.locator("select").nth(1).selectOption("0");
  await root.locator("select").nth(2).selectOption("3");
  await root.locator("select").nth(3).selectOption(options.channel ?? "primary");
  await root.locator('input[type="checkbox"]').nth(0).setChecked(options.loop ?? true);
  await root.locator('input[type="checkbox"]').nth(1).setChecked(options.filtered ?? false);
  await root.locator('input[type="checkbox"]').nth(2).setChecked(options.eyeOpen ?? false);
  if (options.invalidate) await root.getByRole("button", { name: "Invalidate cached motion", exact: true }).click();
  await root.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(1600);
}

export async function stop(page) {
  await panel(page, "Motion").getByRole("button", { name: "Stop all", exact: true }).click();
}

export async function capture(page, options) {
  const frames = await collectFrames(page, options.frameMs ?? 1800);
  await panel(page, "Expression").getByRole("button", { name: "Sample now", exact: true }).click();
  await page.waitForTimeout(130);
  const state = await observeState(page);
  await page.screenshot({ path: resolve(options.output, `${options.label}-page.png`) });
  await page.locator("canvas").screenshot({ path: resolve(options.output, `${options.label}-model.png`) });
  await page.waitForTimeout(300);
  await page.locator("canvas").screenshot({ path: resolve(options.output, `${options.label}-model-next.png`) });
  const pixels = await inspectPixels(options.output, options.label);
  const result = { label: options.label, ...state, frames, ranges: summarize(frames), pixels };
  await writeFile(resolve(options.output, `${options.label}.json`), JSON.stringify(result, null, 2));
  return result;
}

async function collectFrames(page, frameMs) {
  return page.evaluate((duration) => new Promise((done) => {
    const ctx = window.__avatarLabTest.scene.current;
    const rows = [];
    const detach = ctx.hooks.add("beforeModelUpdate", () => {
      rows.push({ at: performance.now(), motion: !ctx.internal.motionManager.isFinished(), parallel: ctx.internal.parallelMotionManager.map((manager) => manager.playing), samples: ctx.sampler.snapshot().samples });
    });
    setTimeout(() => { detach(); done(rows); }, duration);
  }), frameMs);
}

async function observeState(page) {
  return page.evaluate(() => {
    const ctx = window.__avatarLabTest.scene.current;
    const manager = ctx.internal.motionManager.expressionManager;
    return {
      costume: ctx.entry.costume,
      generation: ctx.facts.generation,
      faceSet: ctx.facts.faceSet,
      missingFaceIds: ctx.facts.faceSet.filter((param) => !ctx.params.has(param.id)).map((param) => param.id),
      expression: {
        currentIndex: manager.expressions.indexOf(manager.currentExpression),
        reservedIndex: manager.reserveExpressionIndex,
        finished: manager.isFinished(),
        runtimeParams: manager.currentExpression?.params ?? null,
      },
      cache: Object.fromEntries(Object.entries(ctx.internal.motionManager.motionGroups).map(([group, slots]) => [group, slots.map((motion) => motion ? (motion.motions?.length ?? motion._motionData?.curveCount ?? null) : null)])),
      readout: document.querySelector("pre").textContent,
    };
  });
}

function summarize(frames) {
  const ranges = {};
  for (const frame of frames) {
    for (const [id, sample] of Object.entries(frame.samples)) {
      const range = ranges[id] ??= { after: [null, null], final: [null, null] };
      for (const phase of ["after", "final"]) {
        if (!Number.isFinite(sample[phase])) continue;
        range[phase][0] = Math.min(range[phase][0] ?? Infinity, sample[phase]);
        range[phase][1] = Math.max(range[phase][1] ?? -Infinity, sample[phase]);
      }
    }
  }
  return ranges;
}

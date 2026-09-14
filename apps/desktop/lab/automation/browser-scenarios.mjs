/**
 * INPUT:  an isolated real lab page per scenario, costume-specific names, and an evidence capture callback.
 * OUTPUT: reproducible Phase 2 experiments and lifecycle regressions driven through the visible controls.
 * POS:    experimental / lab - not in production path; diagnostic engine calls are explicitly named controls.
 */
/* global window */

import { capture, expression, loadCostume, motion, panel, reset, stop } from "./browser-driver.mjs";

async function pendingExpression(test, action) {
  const expressionFile = test.costume === "arbeit" ? "**/data/expressions/smile01.exp.json" : "**/expressions/exp_smile01.exp3.json";
  const blocked = Promise.withResolvers();
  const release = Promise.withResolvers();
  await test.page.route(expressionFile, async (route) => {
    blocked.resolve();
    await release.promise;
    await route.continue();
  });
  await expression(test.page, test.name, { settle: false });
  // A time-based delay can expire while Playwright is still selecting the replacement costume on a slow renderer.
  // Keep the engine's real fetch blocked until the cancellation action has completed, then allow it to finish.
  await Promise.race([blocked.promise, test.page.waitForTimeout(5000).then(() => { throw new Error("expression request was not intercepted"); })]);
  try {
    await action();
  } finally {
    release.resolve();
  }
  await test.page.waitForTimeout(2000);
}

async function parallelPair(test, filtered) {
  await motion(test.page, { group: test.idle, filtered: true });
  await motion(test.page, { group: test.group, channel: "0", filtered });
  await expression(test.page, test.name);
}

async function cacheReplay(test, options) {
  await motion(test.page, { group: test.group, filtered: true });
  await expression(test.page, test.name);
  await capture(test.page, { output: test.output, label: `${test.costume}-${test.id}-filtered` });
  await stop(test.page);
  await motion(test.page, { group: test.group, ...options });
  await expression(test.page, test.name);
}

export const scenarios = [
  { id: "expression-only", run: ({ page, name }) => expression(page, name), expected: "reference" },
  { id: "motion-only", run: ({ page, group }) => motion(page, { group }), expected: "unapplied" },
  { id: "expression-then-unfiltered", run: async ({ page, name, group }) => { await expression(page, name); await motion(page, { group }); }, expected: "smiling" },
  { id: "unfiltered-then-expression", run: async ({ page, name, group }) => { await motion(page, { group }); await expression(page, name); }, expected: "smiling" },
  { id: "filtered-then-expression", run: async ({ page, name, group }) => { await motion(page, { group, filtered: true }); await expression(page, name); }, expected: "filtered" },
  { id: "cache-unfiltered-replay", run: (test) => cacheReplay(test, {}), expected: "filtered" },
  { id: "cache-invalidated-replay", run: (test) => cacheReplay(test, { invalidate: true }), expected: "smiling" },
  { id: "cache-shared-parallel", run: (test) => cacheReplay(test, { channel: "0" }), expected: "filtered" },
  { id: "parallel-both-filtered", run: (test) => parallelPair(test, true), expected: "parallel-filtered" },
  { id: "parallel-one-unfiltered", run: (test) => parallelPair(test, false), expected: "parallel-mixed" },
  { id: "three-parallel-stop", run: async (test) => {
    await motion(test.page, { group: test.idle, filtered: true });
    for (const channel of ["0", "1", "2"]) await motion(test.page, { group: test.group, channel, filtered: true });
    await expression(test.page, test.name);
    const live = await capture(test.page, { output: test.output, label: `${test.costume}-three-parallel-playing` });
    if (!live.frames.some((frame) => frame.motion && frame.parallel.length === 3 && frame.parallel.every(Boolean))) throw new Error("The four channels were not running together");
    await stop(test.page);
    await test.page.waitForTimeout(3000);
  }, expected: "stopped" },
  { id: "loop-duration", run: async ({ page, name, group }) => {
    await motion(page, { group });
    await expression(page, name);
    await page.waitForTimeout(11000);
  }, expected: "smiling" },
  { id: "eyes-excluded", run: ({ page, idle }) => motion(page, { group: idle, filtered: true, eyeOpen: false }), expected: "unapplied", frameMs: 7500 },
  { id: "eyes-included", run: ({ page, idle }) => motion(page, { group: idle, filtered: true, eyeOpen: true }), expected: "unapplied", frameMs: 7500 },
  { id: "eyes-expression-excluded", run: async ({ page, idle, name }) => { await motion(page, { group: idle, filtered: true }); await expression(page, name); }, expected: "smiling", frameMs: 7500 },
  { id: "eyes-expression-included", run: async ({ page, idle, name }) => { await motion(page, { group: idle, filtered: true, eyeOpen: true }); await expression(page, name); }, expected: "smiling", frameMs: 7500 },
  { id: "reset-set", run: async (test) => {
    await motion(test.page, { group: test.group });
    await expression(test.page, test.name);
    await reset(test.page);
    await test.page.waitForTimeout(1600);
    await capture(test.page, { output: test.output, label: `${test.costume}-after-reset` });
    await expression(test.page, test.name);
  }, expected: "smiling" },
  { id: "repeated-set", run: async ({ page, name, group }) => {
    await motion(page, { group });
    await expression(page, name);
    await expression(page, name);
  }, expected: "smiling" },
  { id: "selection-without-set", run: async ({ page, name, group }) => {
    await motion(page, { group });
    await expression(page, name);
    await panel(page, "Expression").locator("select").selectOption(name === "smile01" ? "angry01" : "exp_angry01");
  }, expected: "smiling" },
  { id: "pending-set-reset", run: (test) => pendingExpression(test, () => reset(test.page)), expected: "unapplied" },
  { id: "pending-set-switch", run: (test) => pendingExpression(test, () => loadCostume(test.page, test.costume === "arbeit" ? "live_01" : "arbeit")), expected: "unapplied" },
  { id: "failed-set", run: async (test) => {
    await test.page.route(test.costume === "arbeit" ? "**/data/expressions/smile01.exp.json" : "**/expressions/exp_smile01.exp3.json", (route) => route.fulfill({ status: 503, body: "injected expression failure" }));
    await expression(test.page, test.name);
  }, expected: "unapplied" },
  { id: "unavailable-param", only: "live_01", run: async ({ page }) => {
    await panel(page, "Parameter hold").locator('input[type="text"]').fill("ParamNotDeclaredInThisModel");
    await page.waitForTimeout(500);
  }, expected: "unavailable" },
  { id: "reset-restore-control", diagnostic: true, run: async ({ page, name, group }) => {
    await motion(page, { group });
    await expression(page, name);
    await reset(page);
    await page.waitForTimeout(1600);
    await page.evaluate(() => window.__avatarLabTest.scene.current.internal.motionManager.expressionManager.restoreExpression());
    await page.waitForTimeout(1600);
  } },
  { id: "reset-change-expression-control", diagnostic: true, run: async ({ page, name }) => {
    await expression(page, name);
    await reset(page);
    await expression(page, name === "smile01" ? "angry01" : "exp_angry01");
    await expression(page, name);
  } },
];

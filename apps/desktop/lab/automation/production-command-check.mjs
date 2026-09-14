/**
 * INPUT:  real Core avatar tools, the unchanged production renderer entry, and isolated lab models.
 * OUTPUT: command publication, original engine Promise results, reset events, parameters, and screenshots.
 * POS:    experimental / lab - not in production path; diagnoses existing composition, never implements an engine.
 */
/* global window, performance, console */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createAvatarTools } from "../../../../packages/core/src/avatar/avatar-tools.ts";
import { createAvatarSubscriptions } from "../../../../packages/core/src/avatar/avatar-subscriptions.ts";
import { capture, openCostume } from "./browser-driver.mjs";

const modulePath = process.env.TAKI_LAB_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error("Set TAKI_LAB_PLAYWRIGHT_MODULE to the installed Playwright index.mjs");
const { chromium } = await import(pathToFileURL(resolve(modulePath)).href);
const output = resolve(process.argv[2] ?? ".trellis/.runtime/production-avatar-command-check");
const requested = process.env.TAKI_LAB_CASES?.split(",");
const results = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });

function commandTools(vocab) {
  const subscriptions = createAvatarSubscriptions();
  const published = [];
  subscriptions.subscribe("taki", {}, (command) => published.push(command));
  const logger = { child() { return this; }, info() {}, warn() {} };
  const tools = createAvatarTools({ characterId: "taki", subscriptions, vocab, logger });
  return { tools, published };
}

async function prepare(page, preserve) {
  return page.evaluate(async (override) => {
    const { applyAvatarCommand } = await import("/src/renderer/live2d/avatar-commands.ts");
    const { createAvatarController } = await import("/src/renderer/live2d/avatar-controller.ts");
    const { readVocabulary } = await import("/src/renderer/live2d/model-vocabulary.ts");
    const entry = performance.getEntriesByType("resource").find((item) => item.name.includes("/deps/untitled-pixi-live2d-engine.js"));
    if (!entry) throw new Error("Cannot locate the already-loaded engine module URL");
    const { config } = await import(entry.name);
    const { scene, app } = window.__avatarLabTest;
    const model = scene.current.model;
    const vocabulary = readVocabulary(model);
    const state = { calls: [], pending: [], resets: [], frontendAcks: [], originalPreserve: config.preserveExpressionOnMotion };
    if (typeof override === "boolean") config.preserveExpressionOnMotion = override;
    state.effectivePreserve = config.preserveExpressionOnMotion;
    for (const kind of ["expression", "motion"]) {
      const original = model[kind].bind(model);
      model[kind] = (...args) => {
        const call = { kind, name: args[0], args, startedAt: performance.now() };
        state.calls.push(call);
        const promise = original(...args);
        state.pending.push(promise);
        promise.then((value) => { call.result = value; call.finishedAt = performance.now(); }, (error) => { call.error = String(error); });
        return promise;
      };
    }
    const manager = model.internalModel.motionManager.expressionManager;
    const reset = manager.resetExpression.bind(manager);
    manager.resetExpression = () => { state.resets.push({ at: performance.now(), priority: model.internalModel.motionManager.state.currentPriority }); return reset(); };
    state.apply = (command) => {
      const accepted = applyAvatarCommand({ model, command, vocabulary });
      state.frontendAcks.push({ command, accepted });
    };
    state.avatar = createAvatarController({ model, characterId: "taki", center: { x: app.screen.width / 2, y: app.screen.height / 2 } });
    window.__productionCommandCheck = state;
    return vocabulary;
  }, preserve);
}

async function dispatch(page, publisher, requests) {
  const start = publisher.published.length;
  const acks = await Promise.all(requests.map((request, index) => {
    const tool = publisher.tools[request.kind === "expression" ? "avatar_set_expression" : "avatar_play_motion"];
    return tool.execute(tool.inputSchema.parse(request), { toolCallId: `c${start + index}`, messages: [] });
  }));
  await page.evaluate((commands) => commands.forEach((command) => window.__productionCommandCheck.apply(command)), publisher.published.slice(start));
  await page.evaluate(() => Promise.allSettled(window.__productionCommandCheck.pending));
  return acks;
}

const scenarios = [
  { id: "expression-then-motion", steps: ["E", "M"], gap: 1600, expression: "base" },
  { id: "motion-then-expression", steps: ["M", "E"], gap: 100, expression: "base" },
  { id: "same-batch-expression-first", steps: ["EM"], expression: "base" },
  { id: "same-batch-motion-first", steps: ["ME"], expression: "base" },
  { id: "same-expression-twice", steps: ["E", "E"], gap: 1600, rejected: true, expression: "base" },
  { id: "busy-normal-motion-and-expression", steps: ["M", "NE"], gap: 100, rejected: true, expression: "base" },
  { id: "competing-expressions", steps: ["EX"], rejected: true, expression: "other" },
  { id: "click-replaces-expression", steps: ["E"], click: true, expression: "other" },
  { id: "diagnostic-preserve-off", steps: ["E", "M"], gap: 1600, preserve: false, reset: true, diagnostic: true },
  { id: "diagnostic-preserve-off-batch", steps: ["EM"], delayedMotion: true, preserve: false, reset: true, diagnostic: true },
];

function commands(costume) {
  const legacy = costume === "arbeit";
  return {
    E: { kind: "expression", name: legacy ? "smile01" : "exp_smile01" },
    X: { kind: "expression", name: legacy ? "angry01" : "exp_angry01" },
    M: { kind: "motion", name: legacy ? "angry02" : "mtn_angry02_C", priority: "normal", loop: false },
    N: { kind: "motion", name: legacy ? "smile01" : "mtn_smile01_C", priority: "normal", loop: false },
  };
}

async function runActions(page, publisher, input) {
  const acks = [];
  const { scenario, names, costume } = input;
  if (scenario.delayedMotion) {
    await page.route(costume === "arbeit" ? "**/data/motions/angry02.mtn" : "**/motions/mtn_angry02_C.motion3.json", async (route) => {
      await page.waitForTimeout(700);
      await route.continue();
    });
  }
  for (const [index, step] of scenario.steps.entries()) {
    acks.push(...await dispatch(page, publisher, [...step].map((key) => names[key])));
    if (index < scenario.steps.length - 1) await page.waitForTimeout(scenario.gap ?? 100);
  }
  if (scenario.click) {
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const { model } = window.__avatarLabTest.scene.current;
      window.__productionCommandCheck.avatar.reactToClick(model.x, model.y - model.height * 0.4);
      return Promise.allSettled(window.__productionCommandCheck.pending);
    });
  }
  await page.waitForTimeout(1300);
  return acks;
}

async function observe(page) {
  return page.evaluate(() => {
    const state = window.__productionCommandCheck;
    const { internal, facts } = window.__avatarLabTest.scene.current;
    const manager = internal.motionManager.expressionManager;
    const index = manager.expressions.indexOf(manager.currentExpression);
    return { calls: state.calls, resets: state.resets, frontendAcks: state.frontendAcks, originalPreserve: state.originalPreserve, effectivePreserve: state.effectivePreserve, rememberedExpression: facts.expressions[index] ?? null };
  });
}

function verify(result, scenario, names) {
  assert.equal(result.trace.originalPreserve, true);
  assert.ok(result.acks.every((ack) => ack.ok));
  assert.ok(result.trace.frontendAcks.every((ack) => ack.accepted));
  assert.equal(result.errors.length, 0);
  assert.equal(result.trace.calls.some((call) => call.result === false), scenario.rejected ?? false);
  assert.equal(result.trace.resets.length > 0, scenario.reset ?? false);
  if (scenario.expression === "base") assert.equal(result.trace.rememberedExpression, names.E.name);
  if (scenario.expression === "other") assert.notEqual(result.trace.rememberedExpression, names.E.name);
  if (scenario.expression === "base") {
    const id = result.costume === "arbeit" ? "PARAM_EYE_FORM" : "Paramsmile01";
    assert.ok(result.snapshot.ranges[id].final.every((value) => Math.abs(value - 1) < 0.05));
  }
}

async function runCase(costume, scenario) {
  const { context, page, errors } = await openCostume(browser, costume);
  const names = commands(costume);
  const label = `${costume}-${scenario.id}`;
  try {
    const publisher = commandTools(await prepare(page, scenario.preserve));
    const acks = await runActions(page, publisher, { scenario, names, costume });
    const snapshot = await capture(page, { output, label, frameMs: 650 });
    const trace = await observe(page);
    const result = { label, costume, diagnostic: scenario.diagnostic ?? false, acks, published: publisher.published, trace, snapshot, errors };
    await writeFile(resolve(output, `${label}-production.json`), JSON.stringify(result, null, 2));
    verify(result, scenario, names);
    results.push({ label, ok: true, diagnostic: result.diagnostic, acks, trace, ranges: snapshot.ranges });
    console.log(JSON.stringify({ label, ok: true, preserve: trace.effectivePreserve, calls: trace.calls.map(({ kind, name, result }) => ({ kind, name, result })), resets: trace.resets.length }));
  } catch (error) {
    results.push({ label, ok: false, error: String(error) });
    console.error(`${label}: ${String(error)}`);
  } finally {
    await context.close();
    await writeFile(resolve(output, "summary.json"), JSON.stringify({ results }, null, 2));
  }
}

try {
  for (const costume of ["arbeit", "live_01"]) {
    for (const scenario of scenarios) {
      if (!requested || requested.includes(scenario.id)) await runCase(costume, scenario);
    }
  }
} finally {
  await browser.close();
}
process.exitCode = results.some((result) => !result.ok) ? 1 : 0;

/**
 * INPUT: existing isolated native shell, production Home/Core and local scripted model HTTP.
 * OUTPUT: actual UI send/stop/continue, durable receipts/results and screenshots in task evidence.
 * POS: automated integration acceptance; no real provider, user profile or human acceptance.
 */
import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, extname, sep } from "node:path";
import process from "node:process";
import console from "node:console";
import { fileURLToPath, URL } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { withScriptedAgentContextScenario } from "../../../e2e/src/fixture/agent-context-scenario.ts";
import { startScriptedProvider } from "../../../e2e/src/fixture/scripted-provider.ts";
import { deliveredInboxEvents, scriptedInboxReply } from "../../../e2e/src/fixture/agent-context-inbox.ts";
import { CONFIG_METHODS, ConfigSetResultSchema } from "../../../packages/shared/src/index.ts";
import { connectCdp, waitFor } from "./c2-native-driver.mjs";
import { subagentNativeManifest } from "./subagent-native-manifest.mjs";

const { fetch } = globalThis;
const { WebSocket, WebSocketServer } = createRequire(new URL("../../../packages/core/package.json", import.meta.url))("ws");
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = resolve(process.env.TAKI_E2E_EVIDENCE_DIR ?? join(desktop, "../../target/acceptance-implementation-20261030/native-runtime"),
  new Date().toISOString().replaceAll(/[:.]/g, "-"));
const correction = "PRIVATE_NATIVE_INPUT_82653";
const label = "实际运行时界面验收";
const secondLabel = "长会话与来源验收";
const runningInput = "PRIVATE_RUNNING_INPUT_52814";
const secondDraft = "PRIVATE_SECOND_DRAFT_64217";
const longReport = "PRIVATE_LONG_REPORT_START\n" + "这是工作记录中的证据，并非用户自身经历。\n".repeat(700) + "PRIVATE_LONG_REPORT_END";
const checks = [];
await mkdir(artifacts, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "taki-s7-native-fixture-"));
await writeFile(join(artifacts, "fixture-location.json"), JSON.stringify({ retainedOwnedFixture: directory }, null, 2));
const sourceBefore = await subagentNativeManifest();
await writeFile(join(artifacts, "native-source-before.json"), JSON.stringify(sourceBefore, null, 2));
const output = join(directory, "assets");
await build({ configFile: false, root: desktop, plugins: [react(), tailwindcss()], logLevel: "warn",
  resolve: { alias: { "@": join(desktop, "src") } },
  build: { target: "esnext", outDir: output, emptyOutDir: false,
    rollupOptions: { input: join(desktop, "test/c3-pattern-fixture.html") } } });

let releaseFirstChild;
const firstChildHeld = new Promise((done) => { releaseFirstChild = done; });
let childRequests = 0;
let secondRequests = 0;
let delegated = false;
let native;
let relay;
let passed = false;
let summaryRequests = 0;
const provider = await startScriptedProvider(async (request) => ({ ...await nativeReply(request),
  usage: { prompt_tokens: 101, completion_tokens: 17, total_tokens: 118 } }));

async function nativeReply(request) {
  if (request.stream !== true && JSON.stringify(request.messages).includes("Summarize completed private task work")) {
    summaryRequests++;
    return { text: "Task SECOND_NATIVE_WORKER: preserve the original external source; the user did not have that experience. Completed private progress rounds remain exact evidence. Continue the same review; final report remains pending." };
  }
  if (hasTool(request, "complete_subagent")) {
    if (JSON.stringify(request.messages).includes("SECOND_NATIVE_WORKER")) {
      secondRequests += 1;
      if (secondRequests <= 55) return { text: `第 ${secondRequests} 个完整工作回合。` + "外部讲述者的经历不能归属为用户经历。".repeat(45),
        calls: [{ name: "interact_parent", arguments: { kind: "message", text: `PRIVATE_PROGRESS_${secondRequests}` } }] };
      return { calls: [{ name: "complete_subagent", arguments: { text: longReport, materials: [] } }] };
    }
    childRequests += 1;
    if (childRequests === 1) {
      await firstChildHeld;
      return { text: "First request was held until the real user-stop cancelled it." };
    }
    assert.equal(childRequests, 2);
    assert.ok(JSON.stringify(request.messages).includes(correction));
    assert.ok(JSON.stringify(request.messages).includes(runningInput));
    return { calls: [{ name: "complete_subagent", arguments: { text: correction, materials: [] } }] };
  }
  const events = deliveredInboxEvents(request);
  if (JSON.stringify(request.messages).includes("This unattended inbox opportunity cannot create children.")) {
    assert.equal(hasTool(request, "delegate_subagent"), false);
    for (const toolName of ["send_subagent_message", "stop_subagent", "read_agent_inbox", "handle_agent_event"])
      assert.equal(hasTool(request, toolName), true);
  }
  const inbox = scriptedInboxReply(request, () => ({ kind: "needs_user_input", note: "The check-in requires a direct user decision; keep the same review paused." }));
  if (inbox) return inbox;
  assert.equal(events.length, 0);
  assert.equal(hasTool(request, "finish_parent_continuation"), false);
  assert.equal(hasTool(request, "delegate_subagent"), true);
  if (delegated) return { text: "主会话仍能正常响应。" };
  delegated = true;
  return { calls: [{ name: "delegate_subagent", arguments: {
    label, subagentId: null, direction: "Wait for addressed input, then return it with complete_subagent.",
    context: { kind: "fresh" }, completionPolicy: "record_only",
    toolSelection: { mode: "allow", names: ["complete_subagent"] }, materials: [],
  } }, { name: "delegate_subagent", arguments: {
    label: secondLabel, subagentId: null, direction: "SECOND_NATIVE_WORKER: report progress and preserve the original source.",
    context: { kind: "fresh" }, completionPolicy: "record_only",
    toolSelection: { mode: "allow", names: ["complete_subagent"] }, materials: [],
  } }] };
}

try {
  await withScriptedAgentContextScenario({ name: "native-home-production-runtime", providerBaseUrl: provider.baseUrl,
    evidenceRoot: artifacts, maxUpstreamRequests: 110, sessionDeadlineMs: 420_000,
    contextTokens: 24000, historyRatio: 0.2, compactKeepMessages: 4 }, async (scenario) => {
    const defaults = await scenario.effectiveSettings();
    assert.equal(defaults.entries.find((entry) => entry.key === "TAKI_SUBAGENT_CHECKIN_STEPS")?.value, 50);
    assert.equal(defaults.entries.find((entry) => entry.key === "TAKI_SUBAGENT_CHECKIN_PARENT_APPROVALS")?.value, 3);
    ConfigSetResultSchema.parse(await scenario.rpc(CONFIG_METHODS.set, { key: "TAKI_SUBAGENT_CHECKIN_PARENT_APPROVALS", value: 0 }));
    scenario.checkpoint("native-effective-config", { defaults, effective: await scenario.effectiveSettings(),
      reason: "Keep default N=50; explicit K=0 exercises the bounded direct-user attention path in native UI." });
    await scenario.ask("创建一个隔离的子代理工作，用于检查私有会话界面。");
    const child = await waitFor(async () => (await scenario.list()).entries.find((entry) => entry.label === label && entry.activeRunId), "running child");
    const second = await waitFor(async () => (await scenario.list()).entries.find((entry) => entry.label === secondLabel), "second child");
    await waitFor(() => childRequests === 1, "held actual child request");
    relay = await openCoreRelay(scenario.wsUrl);
    native = await openNative(relay.wsUrl);
    const home = native.home;
    await click(home, "子代理");
    await waitFor(() => hasText(home, label), "real child read-model");
    await selectChild(home, label);
    await waitFor(() => hasText(home, "已纳入模型请求意图"), "real initial receipt");
    await screenshot(home, "running-private-conversation");
    record("Production Home reads the actual Core-created child and model-intent receipt");

    await enterDraft(home, runningInput);
    await click(home, "发送输入");
    const runningAccepted = await waitFor(async () => (await scenario.history(child.subagentId)).inputs.find((input) =>
      input.direction === runningInput), "running addressed input");
    assert.equal(runningAccepted.consumed, null);
    assert.equal((await scenario.history(child.subagentId)).conversation.activeRunId, child.activeRunId);
    record("A running child accepts asynchronous input while its actual request and Stop control remain active");

    await enterDraft(home, correction);
    await selectChild(home, secondLabel);
    await enterDraft(home, secondDraft);
    await selectChild(home, label);
    assert.equal(await home.evaluate("document.querySelector('textarea[aria-label=向这项工作补充说明]').value"), correction);
    await selectChild(home, secondLabel);
    assert.equal(await home.evaluate("document.querySelector('textarea[aria-label=向这项工作补充说明]').value"), secondDraft);
    await selectChild(home, label);
    assert.equal((await scenario.ask("孩子们继续工作时，主会话还能响应吗？")).text, "主会话仍能正常响应。");
    assert.equal(childRequests, 1);
    record("Concurrent main chat and two child views preserve independently addressed drafts");

    await click(home, "停止此子代理");
    await waitFor(async () => {
      const history = await scenario.history(child.subagentId);
      return history.conversation.stopOrigin === "user" && history.conversation.activeRunId === null;
    }, "durable stopped child");
    releaseFirstChild();
    const stopped = await scenario.history(child.subagentId);
    assert.equal(stopped.executions.find((execution) => execution.runId === child.activeRunId)?.state, "cancelled");
    await waitFor(() => hasText(home, "你已停止此子代理"), "real user-stop UI");
    scenario.checkpoint("native-stop", stopped);
    record("Native Stop commits the user latch and cancels exactly the real child Run");

    assert.equal(await home.evaluate("document.querySelector('textarea[aria-label=向这项工作补充说明]').value"), correction);
    assert.equal(childRequests, 1);
    if (await hasText(home, "使用当前目标")) await click(home, "使用当前目标");
    await screenshot(home, "stopped-retained-draft");
    await click(home, "发送并继续");
    const completed = await waitFor(async () => {
      const history = await scenario.history(child.subagentId);
      return history.results.some((result) => result.result.child.outcome === "completed"
        && result.result.child.body === correction) && history;
    }, "completed continuation");
    assert.equal(completed.conversation.stopOrigin, null);
    assert.equal(new Set(completed.executions.map((execution) => execution.runId)).size, 2);
    const included = completed.inputs.find((input) => input.direction === correction);
    assert.equal(typeof included.consumed?.effectId, "string");
    assert.notEqual(included.consumed.runId, child.activeRunId);
    assert.equal(completed.executions.find((execution) => execution.runId === child.activeRunId)?.state, "cancelled");
    assert.ok(completed.results.every((result) => result.result.parentRunId === null));
    assert.equal(scenario.rows("SELECT run_id FROM run_deliveries").length, 0);
    assert.equal(scenario.rows("SELECT content FROM timeline_messages").some((row) => String(row.content).includes(correction)), false);
    await waitFor(() => home.evaluate(`document.querySelector('[data-subagent-id] [aria-label="聊天记录"]')?.textContent.includes(${JSON.stringify(correction)})`), "actual retained result UI");
    assert.equal(await home.evaluate("/执行 [0-9]+ ·/.test(document.body.innerText)"), false);
    await screenshot(home, "completed-private-result");
    scenario.checkpoint("native-complete", completed);
    record("Native Send and continue performs one addressed continuation, retaining the cancelled Run and both private inputs");

    const checkpoint = await waitFor(async () => {
      const current = (await scenario.history(second.subagentId)).conversation;
      return current.activeRunId === null && current.pendingRequest?.reason === "check_in" && current;
    }, "default N50 native check-in", 120_000);
    assert.equal(secondRequests, 50);
    assert.equal(checkpoint.progress.completedSteps, 50);
    assert.equal(checkpoint.pendingRequest.checkIn.requiredActor, "user");
    assert.ok(summaryRequests > 1);
    const beforeContinue = await scenario.history(second.subagentId);
    const firstLongRun = beforeContinue.executions[0].runId;
    assert.equal(new Set(beforeContinue.executions.map((execution) => execution.runId)).size, 1);
    assert.equal(scenario.rows(`SELECT attempt_id FROM run_attempts WHERE run_id='${firstLongRun}'`).length, 1);
    assert.ok(scenario.rows("SELECT revision FROM subagent_context_summaries").length > 1);
    await click(home, "聊天");
    await waitFor(() => hasText(home, "进度检查需要你决定"), "check-in attention while private page hidden");
    await screenshot(home, "main-chat-user-required-checkin");
    await click(home, "打开工作并决定");
    await waitFor(() => hasText(home, "已完成 50 个模型步骤"), "rendered cumulative default check-in count");
    await waitFor(() => hasText(home, "必须由你明确继续或调整方向"), "rendered user-only check-in");
    assert.ok(checkpoint.tokenUsage.complete);
    assert.ok(checkpoint.tokenUsage.totalTokens > 0);
    await waitFor(() => home.evaluate(`document.body.innerText.includes('累计 ' + (${checkpoint.tokenUsage.totalTokens}).toLocaleString() + ' token')`), "actual complete provider usage");
    assert.equal(await home.evaluate("document.querySelector('textarea[aria-label=向这项工作补充说明]').value"), secondDraft);
    await enterDraft(home, "");
    if (await hasText(home, "使用当前目标")) await click(home, "使用当前目标");
    await screenshot(home, "default-50-checkin-before-user-continue");
    await click(home, "继续此工作");
    record("Default N=50 crosses multiple same-Attempt compaction segments, pauses visibly, and direct UI Continue resumes the same work; explicit K=0 proves user-required attention and actual usage");

    await waitFor(async () => (await scenario.history(second.subagentId)).results.some((result) =>
      result.result.child.body === longReport), "long second conversation", 90_000);
    await selectChild(home, secondLabel);
    await waitFor(() => hasText(home, "PRIVATE_LONG_REPORT_START"), "bounded long report preview");
    assert.equal(await home.evaluate("document.querySelector('textarea[aria-label=向这项工作补充说明]').value"), "");
    if (!await hasText(home, "PRIVATE_LONG_REPORT_END")) await click(home, "读取完整正文");
    await waitFor(() => hasText(home, "PRIVATE_LONG_REPORT_END"), "full body pages");
    await screenshot(home, "long-report-body");
    const scrollSelector = "document.querySelector('[data-subagent-id] [aria-label=\"聊天记录\"]')";
    await home.evaluate(`${scrollSelector}.scrollTop = 0`);
    for (let page = 0; page < 8 && !await hasText(home, "第 1 个完整工作回合。"); page++) {
      const previous = await home.evaluate("document.querySelectorAll('[data-subagent-id] [data-transcript-key]').length");
      await click(home, "加载更早消息");
      await waitFor(() => home.evaluate(`document.querySelectorAll('[data-subagent-id] [data-transcript-key]').length > ${previous}`), "older exact conversation page");
    }
    assert.equal(await hasText(home, "第 1 个完整工作回合。"), true);
    await screenshot(home, "older-conversation-page");
    const secondHistory = await scenario.history(second.subagentId);
    assert.equal(secondRequests, 56);
    assert.equal(new Set(secondHistory.executions.map((execution) => execution.runId)).size, 2);
    assert.equal(new Set(secondHistory.executions.map((execution) => execution.workInputId)).size, 1);
    assert.equal(secondHistory.conversation.progress.completedSteps, 56);
    assert.equal(secondHistory.conversation.progress.intervalStartSteps, 50);
    assert.equal(secondHistory.conversation.progress.consecutiveParentApprovals, 0);
    assert.equal(secondHistory.inputs.filter((input) => input.replyToEventId === checkpoint.pendingRequest.eventId).length, 1);
    assert.equal(scenario.rows("SELECT content FROM timeline_messages").some((row) => String(row.content).includes("PRIVATE_PROGRESS_")), false);
    record("The original 56-step work finishes after the exact UI check-in answer in a new Run; older history and complete body remain reachable, with private source/publication boundaries intact");

    await selectChild(home, label);
    await enterDraft(home, "PRIVATE_RECONNECT_DRAFT");
    const connectedBefore = relay.connectionCount();
    relay.setOffline(true);
    await waitFor(() => hasText(home, "连接正在恢复，记录与草稿已保留，当前无法提交操作。"), "actual disconnected private view");
    await screenshot(home, "disconnected-retained-draft");
    relay.setOffline(false);
    await waitFor(async () => relay.connectionCount() > connectedBefore && !await hasText(home,
      "连接正在恢复，记录与草稿已保留，当前无法提交操作。"), "fresh authenticated UI connection");
    assert.equal(await home.evaluate("document.querySelector('textarea[aria-label=向这项工作补充说明]').value"), "PRIVATE_RECONNECT_DRAFT");
    assert.equal((await scenario.history(child.subagentId)).inputs.some((input) => input.direction === "PRIVATE_RECONNECT_DRAFT"), false);
    record("A real WebSocket loss and new authenticated connection preserve the unsent draft without mutation replay");
    assert.equal(childRequests, 2);
    assert.equal(provider.errors.length, 0);
    // Close the UI before its Core so the native client cannot keep issuing recovery reads during teardown.
    await native.close();
    native = undefined;
    await relay.close();
    relay = undefined;
  });
  passed = true;
} catch (cause) {
  await writeFile(join(artifacts, "failure.txt"), String(cause));
  if (native) await screenshot(native.home, "failure").catch(() => undefined);
  throw cause;
} finally {
  releaseFirstChild();
  await finishNativeEvidence();
}
console.log(JSON.stringify({ checks: checks.length, artifacts }));

async function finishNativeEvidence() {
  const cleanup = await Promise.allSettled([Promise.resolve().then(() => native?.close()),
    Promise.resolve().then(() => relay?.close()), provider.close()]);
  const cleanupFailed = cleanup.some((result) => result.status === "rejected");
  let evidenceFailed;
  try {
    const sourceAfter = await subagentNativeManifest();
    const sourceUnchanged = JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter);
    evidenceFailed = !sourceUnchanged;
    await writeFile(join(artifacts, "native-evidence.json"), JSON.stringify({ status: passed && !cleanupFailed && sourceUnchanged ? "passed" : "failed",
      checks, artifacts, directory, childRequests, secondRequests, summaryRequests, cleanupFailed, sourceUnchanged, sourceAfter,
      retainedOwnedFixture: directory, checkInSteps: 50, parentApprovals: 0,
      scope: "Actual production Home/WsClient/Core/SubagentService/SQLite and SDK HTTP. Two local scripted workers; one held cancelled request, a long worker conversation and native controls. Isolated native shell; no real model, real user data, playback or human acceptance." }, null, 2));
  } catch { evidenceFailed = true; }
  if (passed && (cleanupFailed || evidenceFailed)) throw new Error("native fixture cleanup or evidence failed");
}

function record(check) { checks.push(check); console.log(`PASS ${check}`); }
function hasTool(request, name) { return request.tools?.some((tool) => tool.function?.name === name) ?? false; }
function hasText(session, text) { return session.evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`); }
function button(text) { return `[...document.querySelectorAll('button')].find(e => !e.closest('[hidden]') && e.textContent.trim() === ${JSON.stringify(text)} && !e.disabled)`; }
async function click(session, text) {
  await waitFor(() => session.evaluate(`(() => { const target = ${button(text)};
    if (!target) return false; target.click(); return true; })()`), `ready ${text}`);
}
async function selectChild(session, text) {
  const selector = `[...document.querySelectorAll('button')].find(e => !e.closest('[hidden]') && e.textContent.includes(${JSON.stringify(text)}))`;
  await waitFor(() => session.evaluate(`Boolean(${selector})`), `child ${text}`);
  await session.evaluate(`${selector}.click()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-subagent-id] h2')?.textContent === ${JSON.stringify(text)}
    && Boolean(document.querySelector('textarea[aria-label=向这项工作补充说明]'))`), "selected child composer");
}
async function enterDraft(session, text) {
  await session.evaluate(`(() => { const field = document.querySelector('textarea[aria-label=向这项工作补充说明]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(text)});
    field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor(() => session.evaluate(`document.querySelector('textarea[aria-label=向这项工作补充说明]').value === ${JSON.stringify(text)}`), "controlled draft");
}
async function screenshot(session, name) {
  const shot = await session.call("Page.captureScreenshot", { format: "png" });
  await writeFile(join(artifacts, `${name}.png`), Buffer.from(shot.data, "base64"));
}

async function openCoreRelay(wsUrl) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const pairs = new Set();
  let offline = false;
  let count = 0;
  server.on("connection", (client) => {
    if (offline) { client.terminate(); return; }
    const upstream = new WebSocket(wsUrl);
    const pair = { client, upstream };
    pairs.add(pair);
    const queued = [];
    const close = () => {
      pairs.delete(pair);
      if (client.readyState !== WebSocket.CLOSED) client.terminate();
      if (upstream.readyState !== WebSocket.CLOSED) upstream.terminate();
    };
    client.on("error", close);
    upstream.on("error", close);
    client.on("close", close);
    upstream.on("close", close);
    client.on("message", (data, binary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
      else queued.push({ data, binary });
    });
    upstream.on("open", () => {
      count++;
      for (const frame of queued.splice(0)) upstream.send(frame.data, { binary: frame.binary });
    });
    upstream.on("message", (data, binary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }); });
  });
  await once(server, "listening");
  return { wsUrl: `ws://127.0.0.1:${server.address().port}`, connectionCount: () => count,
    setOffline(value) {
      offline = value;
      if (offline) for (const pair of pairs) { pair.client.terminate(); pair.upstream.terminate(); }
    },
    async close() {
      offline = true;
      for (const pair of pairs) { pair.client.terminate(); pair.upstream.terminate(); }
      await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
    } };
}

async function openNative(wsUrl) {
  const assets = createServer((request, response) => {
    const name = new URL(request.url, "http://fixture").pathname.replace("c2-presence-fixture.html", "c3-pattern-fixture.html");
    const path = resolve(output, `.${name}`);
    if (!path.startsWith(`${resolve(output)}${sep}`)) { response.writeHead(403).end(); return; }
    void readFile(path).then((bytes) => {
      response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[extname(path)] || "application/octet-stream");
      response.end(bytes);
    }, () => response.writeHead(404).end());
  });
  const sessions = [];
  let gui;
  let guiOutput = "";
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    const cleanup = await Promise.allSettled([
      Promise.resolve().then(async () => {
        for (const session of sessions) session.close();
        if (gui?.pid && gui.exitCode === null && gui.signalCode === null) {
          gui.kill();
          await waitFor(() => gui.exitCode !== null || gui.signalCode !== null, "native fixture exit", 10_000);
        }
      }),
      Promise.resolve().then(async () => {
        assets.closeAllConnections();
        if (assets.listening) await new Promise((done, reject) => assets.close((error) => error ? reject(error) : done()));
      }),
      writeFile(join(artifacts, "native-output.log"), guiOutput),
    ]);
    if (cleanup.some((result) => result.status === "rejected")) throw new Error("native shell teardown failed");
  };
  try {
    assets.listen(0, "127.0.0.1"); await once(assets, "listening");
    const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
    const debugPort = reservation.address().port; await new Promise((done) => reservation.close(done));
    const target = process.env.CARGO_TARGET_DIR || join(desktop, "src-tauri/target");
    gui = spawn(join(target, "debug/examples/c2-presence-fixture.exe"), [], { windowsHide: true, shell: false,
      stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, C2_FIXTURE_ROOT: directory,
        C2_FIXTURE_ASSET_PORT: String(assets.address().port), C2_FIXTURE_WS_PORT: new URL(wsUrl).port,
        WEBVIEW2_USER_DATA_FOLDER: join(directory, "webview"),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}` } });
    for (const stream of [gui.stdout, gui.stderr]) stream.on("data", (chunk) => { guiOutput = (guiOutput + chunk.toString()).slice(-12000); });
    await once(gui, "spawn");
    const pages = await waitFor(async () => {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      return list.filter((page) => page.type === "page").length === 2 && list.filter((page) => page.type === "page");
    }, "native windows");
    for (const page of pages) sessions.push(await connectCdp(page));
    const labels = await Promise.all(sessions.map((session) => session.evaluate("window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label")));
    const home = sessions[labels.indexOf("home")];
    assert.ok(home);
    return { home, close };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}

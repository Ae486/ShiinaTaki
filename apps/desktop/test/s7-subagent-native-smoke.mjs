import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { once } from "node:events";
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
import { createSubagentFixture } from "./s7-subagent-native-server.mjs";
import { connectCdp, waitFor } from "./c2-native-driver.mjs";
import { subagentNativeManifest } from "./subagent-native-manifest.mjs";
const { fetch } = globalThis;
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.env.CARGO_TARGET_DIR || join(desktop, "src-tauri/target");
const artifacts = resolve(process.env.TAKI_E2E_EVIDENCE_DIR ?? join(desktop, "../../target/acceptance-implementation-20261030/native-ui-only"), new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(artifacts, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "taki-s7-ui-only-fixture-"));
await writeFile(join(artifacts, "fixture-location.json"), JSON.stringify({ retainedOwnedFixture: directory }, null, 2));
const sourceBefore = await subagentNativeManifest();
await writeFile(join(artifacts, "native-source-before.json"), JSON.stringify(sourceBefore, null, 2));
const output = join(directory, "assets");
await build({ configFile: false, root: desktop, plugins: [react(), tailwindcss()], logLevel: "warn",
  resolve: { alias: { "@": join(desktop, "src") } },
  build: { target: "esnext", outDir: output, emptyOutDir: false, rollupOptions: { input: join(desktop, "test/c3-pattern-fixture.html") } } });
let fixture, assets, gui, guiOutput = "", passed = false;
const openAssets = () => createServer((request, response) => {
  const name = new URL(request.url, "http://fixture").pathname.replace("c2-presence-fixture.html", "c3-pattern-fixture.html");
  const path = resolve(output, `.${name}`);
  if (!path.startsWith(`${resolve(output)}${sep}`)) { response.writeHead(403).end(); return; }
  void readFile(path).then((bytes) => { response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[extname(path)] || "application/octet-stream"); response.end(bytes); }, () => response.writeHead(404).end());
});
const sessions = [], checks = [];
const pass = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const shot = async (session, name) => {
  const image = await session.call("Page.captureScreenshot", { format: "png" });
  await writeFile(join(artifacts, `${name}.png`), Buffer.from(image.data, "base64"));
};
const hasText = (session, text) => session.evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
const buttonLookup = (text) => `[...document.querySelectorAll('button')].find(e => !e.closest('[hidden]') && e.textContent.trim() === ${JSON.stringify(text)} && !e.disabled)`;
const click = async (session, text) => { await waitFor(() => session.evaluate(`Boolean(${buttonLookup(text)})`), `ready ${text}`); await session.evaluate(`${buttonLookup(text)}.click()`); };
const draft = "document.querySelector('textarea[aria-label=向这项工作补充说明]')";
const setDraft = (session, text) => session.evaluate(`(() => { const field = ${draft}; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(text)}); field.dispatchEvent(new Event('input', {bubbles:true})); field.focus(); field.setSelectionRange(2, 5); })()`);
const captureState = async (session, name) => {
  const dom = await session.evaluate(`({ label: window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label,
    body: document.body.innerText, draft: ${draft}?.value ?? null,
    buttons: [...document.querySelectorAll('button')].filter(e => !e.closest('[hidden]')).map(e => ({text: e.textContent.trim(), disabled: e.disabled})) })`);
  await writeFile(join(artifacts, `${name}.json`), JSON.stringify({ dom, calls: fixture?.controlCalls ?? [],
    conversation: fixture?.children?.[0]?.conversation }, null, 2));
};
try {
  fixture = await createSubagentFixture(join(directory, "fixture.sqlite"));
  assets = openAssets();
  assets.listen(0, "127.0.0.1"); await once(assets, "listening");
  const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const debugPort = reservation.address().port; await new Promise((done) => reservation.close(done));
  gui = spawn(join(target, "debug/examples/c2-presence-fixture.exe"), [], { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, C2_FIXTURE_ROOT: directory, C2_FIXTURE_ASSET_PORT: String(assets.address().port), C2_FIXTURE_WS_PORT: String(fixture.port),
      WEBVIEW2_USER_DATA_FOLDER: join(directory, "webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}` } });
  for (const stream of [gui.stdout, gui.stderr]) stream.on("data", (chunk) => { guiOutput = (guiOutput + chunk.toString()).slice(-12000); });
  const pages = await waitFor(async () => { const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); return list.filter((page) => page.type === "page").length === 2 && list.filter((page) => page.type === "page"); }, "native windows");
  for (const page of pages) sessions.push(await connectCdp(page));
  const labels = await Promise.all(sessions.map((session) => session.evaluate("window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label")));
  const home = sessions[labels.indexOf("home")];
  await click(home, "子代理");
  await waitFor(() => hasText(home, "视频中的城市记忆"), "child list");
  await home.evaluate("[...document.querySelectorAll('button')].find(e => e.textContent.includes('视频中的城市记忆')).click()");
  await waitFor(() => hasText(home, "已纳入模型请求意图"), "private receipts");
  assert.equal(await hasText(home, "已接收 · 等待纳入"), true);
  await shot(home, "conversation-input-receipts");
  pass("Home registry opens private conversation with distinct queued and consumed receipts");

  await setDraft(home, "保留中的补充草稿");
  await home.evaluate(`window.__s7Draft = ${draft}; window.__s7Row = document.querySelector('[data-subagent-id] [data-transcript-key]'); window.__s7Start = window.__s7Draft.selectionStart; window.__s7End = window.__s7Draft.selectionEnd;`);
  fixture.holdHistory = true; fixture.change();
  await waitFor(() => fixture.heldHistory.length > 0, "held refresh");
  assert.equal(await home.evaluate(`${draft} === window.__s7Draft && document.contains(window.__s7Row)`), true);
  assert.equal(await home.evaluate(`${buttonLookup("发送输入")} === undefined`), true);
  fixture.releaseHistory(); await waitFor(() => home.evaluate(`Boolean(${buttonLookup("发送输入")})`), "restored controls");
  assert.equal(await home.evaluate(`${draft} === window.__s7Draft && window.__s7Draft.value === '保留中的补充草稿' && window.__s7Draft.selectionStart === window.__s7Start && window.__s7Draft.selectionEnd === window.__s7End`), true);
  pass("held same-child refresh keeps draft and transcript nodes with immediately disabled actions");

  await click(home, "停止此子代理");
  await waitFor(() => hasText(home, "你已停止此子代理"), "user stop latch");
  assert.equal(fixture.controlCalls[0].method, "subagent.stop");
  await click(home, "聊天"); await waitFor(() => hasText(home, "子代理已暂停，请查看工作中的待决定事项"), "paused Co-Watching card");
  await click(home, "查看子代理工作");
  if (await hasText(home, "使用当前目标")) await click(home, "使用当前目标");
  await waitFor(() => home.evaluate(`Boolean(${buttonLookup("发送并继续")})`), "linked child readiness");
  assert.equal(fixture.controlCalls.length, 1);
  pass("paused Co-Watching opens the exact child/work without resuming it");
  await click(home, "发送并继续"); await waitFor(() => fixture.controlCalls.length === 2, "single addressed continuation");
  assert.equal(fixture.controlCalls[1].method, "subagent.continue");
  assert.equal(fixture.controlCalls[1].params.target.expectedRunId, null);
  assert.equal(fixture.controlCalls[1].params.direction, "保留中的补充草稿");
  assert.equal(fixture.children[0].conversation.stopOrigin, null);
  await waitFor(() => home.evaluate(`Boolean(${buttonLookup("停止此子代理")}) && ${draft}.value === ''
    && document.body.innerText.includes('继续请求已接收')`), "continued work reconciled by client");
  pass("stop is child-specific; deliberate Send and continue uses one exact idle Run/version RPC");
  await captureState(home, "continue-client-reconciled");

  fixture.holdHistory = true;
  fixture.dropSend = true;
  await setDraft(home, "断线也要保留的输入"); await click(home, "发送输入");
  await waitFor(() => home.evaluate("document.body.innerText.includes('尚未确认') || document.body.innerText.includes('未能确认操作结果')"), "unknown mutation receipt");
  await waitFor(() => fixture.heldHistory.length > 0, "replacement canonical read held");
  assert.equal(await home.evaluate(`${draft}.value`), "断线也要保留的输入");
  assert.equal(fixture.controlCalls.filter((call) => call.method === "subagent.send").length, 1);
  await captureState(home, "reconnect-before-canonical-read");
  await shot(home, "reconnect-unknown-draft");
  fixture.releaseHistory();
  await waitFor(() => home.evaluate(`Boolean(${buttonLookup("停止此子代理")}) && ${draft}.value === ''
    && document.querySelector('[data-subagent-id]').innerText.includes('断线也要保留的输入')`), "canonical accepted input resolves unknown draft");
  const sent = fixture.controlCalls.filter((call) => call.method === "subagent.send");
  assert.equal(sent.length, 1);
  assert.equal(fixture.children[0].inputs.filter((input) => input.operationKey === sent[0].params.operationKey).length, 1);
  assert.equal(await home.evaluate("document.querySelector('[data-subagent-id]').innerText.split('断线也要保留的输入').length - 1"), 1);
  assert.equal(await home.evaluate("document.body.innerText.includes('未能确认操作结果') || document.body.innerText.includes('刚才操作的结果尚未确认')"), false);
  await captureState(home, "reconnect-after-canonical-read");
  await shot(home, "reconnect-canonical-input");
  pass("lost send acknowledgement retains an unknown draft until canonical recovery confirms the same accepted input once, without replay");

  await setDraft(home, "读取失败仍保留的草稿");
  fixture.failHistory = true; fixture.change();
  await waitFor(() => hasText(home, "读取私有会话失败"), "retained read error");
  assert.equal(await hasText(home, "视频中的城市记忆"), true);
  assert.equal(await home.evaluate(`${draft}.value`), "读取失败仍保留的草稿");
  await shot(home, "retained-read-error"); await click(home, "刷新状态");
  await waitFor(() => home.evaluate(`Boolean(${buttonLookup("发送输入")})`), "manual retry");
  await home.evaluate("document.querySelector('[data-subagent-id]').scrollIntoView({block:'end'})");
  await shot(home, "linked-parent-result");
  assert.equal(fixture.children[0].results[0].deliveryState, null);
  fixture.empty = true; fixture.change(); await waitFor(() => hasText(home, "还没有子代理"), "empty list");
  pass("failed refresh retains child detail; explicit retry restores it; empty list and undelivered parent synthesis remain truthful");
  passed = true;
} catch (cause) {
  await writeFile(join(artifacts, "failure.txt"), `${String(cause)}\n${guiOutput}`);
  for (const [index, session] of sessions.entries()) {
    await shot(session, `failure-${index}`).catch(() => undefined);
    await captureState(session, `failure-state-${index}`).catch(() => undefined);
  }
  throw cause;
} finally {
  const cleanup = await Promise.allSettled([Promise.resolve().then(async () => {
    sessions.forEach((session) => session.close());
    if (gui?.pid && gui.exitCode === null && gui.signalCode === null) {
      gui.kill(); await waitFor(() => gui.exitCode !== null || gui.signalCode !== null, "UI-only fixture exit", 10_000);
    }
  }), Promise.resolve().then(() => fixture?.close()), Promise.resolve().then(async () => {
    assets?.closeAllConnections();
    if (assets?.listening) await new Promise((done, reject) => assets.close((error) => error ? reject(error) : done()));
  })]);
  const cleanupFailed = cleanup.some((result) => result.status === "rejected");
  let evidenceFailed;
  try {
    const sourceAfter = await subagentNativeManifest();
    const sourceUnchanged = JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter);
    evidenceFailed = !sourceUnchanged;
    await writeFile(join(artifacts, "evidence.json"), JSON.stringify({ status: passed && !cleanupFailed && sourceUnchanged ? "passed" : "failed",
    checks, artifacts, retainedOwnedFixture: directory, cleanupFailed, exitCode: gui?.exitCode ?? null,
    sourceUnchanged, sourceAfter,
    scope: "Supplemental UI-only: actual WebView2 and production Home/WsClient/controller; Shared-validated scripted RPC state. No model, real Core lifecycle or owner acceptance.",
    calls: fixture?.controlCalls ?? [], guiOutput }, null, 2)); } catch { evidenceFailed = true; }
  requireValidCleanup({ passed, cleanupFailed, evidenceFailed });
}
console.log(JSON.stringify({ checks: checks.length, artifacts }));

function requireValidCleanup({ passed, cleanupFailed, evidenceFailed }) {
  if (passed && (cleanupFailed || evidenceFailed)) throw new Error("UI-only native fixture cleanup/evidence failed");
}

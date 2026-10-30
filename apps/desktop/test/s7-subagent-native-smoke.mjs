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
import { connectCdp, delay, waitFor } from "./c2-native-driver.mjs";
const { fetch } = globalThis;
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(join(tmpdir(), "taki-s7-subagent-native-"));
const target = process.env.CARGO_TARGET_DIR || join(desktop, "src-tauri/target");
const artifacts = resolve(desktop, "../../.trellis/tasks/10-21-agent-delegation-runtime/research/s7-recovery/native", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(artifacts, { recursive: true });
const output = join(directory, "assets");
await build({ configFile: false, root: desktop, plugins: [react(), tailwindcss()], logLevel: "warn",
  resolve: { alias: { "@": join(desktop, "src") } },
  build: { target: "esnext", outDir: output, emptyOutDir: false, rollupOptions: { input: join(desktop, "test/c3-pattern-fixture.html") } } });
const fixture = await createSubagentFixture(join(directory, "fixture.sqlite"));
const assets = createServer((request, response) => {
  const name = new URL(request.url, "http://fixture").pathname.replace("c2-presence-fixture.html", "c3-pattern-fixture.html");
  const path = resolve(output, `.${name}`);
  if (!path.startsWith(`${resolve(output)}${sep}`)) { response.writeHead(403).end(); return; }
  void readFile(path).then((bytes) => { response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[extname(path)] || "application/octet-stream"); response.end(bytes); }, () => response.writeHead(404).end());
});
assets.listen(0, "127.0.0.1"); await once(assets, "listening");
const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
const debugPort = reservation.address().port; await new Promise((done) => reservation.close(done));
let gui, guiOutput = "";
const sessions = [], checks = [];
const pass = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const shot = async (session, name) => {
  const image = await session.call("Page.captureScreenshot", { format: "png" });
  await writeFile(join(artifacts, `${name}.png`), Buffer.from(image.data, "base64"));
};
const hasText = (session, text) => session.evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
const buttonLookup = (text) => `[...document.querySelectorAll('button')].find(e => !e.closest('[hidden]') && e.textContent.trim() === ${JSON.stringify(text)} && !e.disabled)`;
const click = async (session, text) => { await waitFor(() => session.evaluate(`Boolean(${buttonLookup(text)})`), `ready ${text}`); await session.evaluate(`${buttonLookup(text)}.click()`); };
const setDraft = (session, text) => session.evaluate(`(() => { const field = document.getElementById('subagent-draft'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(text)}); field.dispatchEvent(new Event('input', {bubbles:true})); field.focus(); field.setSelectionRange(2, 5); })()`);
try {
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
  await home.evaluate("window.__s7Draft = document.getElementById('subagent-draft'); window.__s7Row = document.querySelector('[data-private-message]'); window.__s7Start = window.__s7Draft.selectionStart; window.__s7End = window.__s7Draft.selectionEnd;");
  fixture.holdHistory = true; fixture.change();
  await waitFor(() => fixture.heldHistory.length > 0, "held refresh");
  assert.equal(await home.evaluate("document.getElementById('subagent-draft') === window.__s7Draft && document.contains(window.__s7Row)"), true);
  assert.equal(await home.evaluate(`${buttonLookup("发送输入")} === undefined`), true);
  fixture.releaseHistory(); await waitFor(() => home.evaluate(`Boolean(${buttonLookup("发送输入")})`), "restored controls");
  assert.equal(await home.evaluate("document.getElementById('subagent-draft') === window.__s7Draft && window.__s7Draft.value === '保留中的补充草稿' && window.__s7Draft.selectionStart === window.__s7Start && window.__s7Draft.selectionEnd === window.__s7End"), true);
  pass("held same-child refresh keeps draft and transcript nodes with immediately disabled actions");

  await click(home, "停止此子代理");
  await waitFor(() => hasText(home, "你已停止此子代理"), "user stop latch");
  assert.equal(fixture.controlCalls[0].method, "subagent.stop");
  await click(home, "聊天"); await waitFor(() => hasText(home, "子代理已停止，等待你明确继续"), "paused Co-Watching card");
  await click(home, "查看子代理工作");
  await waitFor(() => home.evaluate(`Boolean(${buttonLookup("发送输入")})`), "linked child readiness");
  assert.equal(fixture.controlCalls.length, 1);
  pass("paused Co-Watching opens the exact child/work without resuming it");
  await click(home, "发送输入"); await waitFor(() => fixture.controlCalls.length === 2, "queued user input");
  assert.equal(fixture.children[0].conversation.stopOrigin, "user");
  await click(home, "继续此工作"); await waitFor(() => fixture.controlCalls.length === 3, "explicit continue");
  assert.equal(fixture.controlCalls[2].method, "subagent.continue");
  assert.equal(fixture.controlCalls[2].params.target.expectedRunId, null);
  pass("stop is child-specific; queued input does not resume; deliberate Continue uses exact idle Run/version");

  fixture.dropSend = true;
  await setDraft(home, "断线也要保留的输入"); await click(home, "发送输入");
  await waitFor(() => home.evaluate("document.body.innerText.includes('尚未确认') || document.body.innerText.includes('未能确认操作结果')"), "unknown mutation receipt");
  await waitFor(() => home.evaluate(`Boolean(${buttonLookup("发送输入")})`), "replacement read readiness");
  assert.equal(await home.evaluate("document.getElementById('subagent-draft').value"), "断线也要保留的输入");
  assert.equal(fixture.controlCalls.filter((call) => call.method === "subagent.send").length, 2);
  await shot(home, "reconnect-unknown-draft");
  pass("lost send acknowledgement reconnects without mutation replay and preserves draft plus unknown outcome");

  fixture.failHistory = true; fixture.change();
  await waitFor(() => hasText(home, "读取私有会话失败"), "retained read error");
  assert.equal(await hasText(home, "视频中的城市记忆"), true);
  await shot(home, "retained-read-error"); await click(home, "刷新状态");
  await waitFor(() => home.evaluate(`Boolean(${buttonLookup("发送输入")})`), "manual retry");
  await home.evaluate("document.querySelector('[data-subagent-id]').scrollIntoView({block:'end'})");
  await shot(home, "linked-parent-result");
  assert.equal(await hasText(home, "尚无送达确认"), true);
  fixture.empty = true; fixture.change(); await waitFor(() => hasText(home, "还没有子代理"), "empty list");
  pass("failed refresh retains child detail; explicit retry restores it; empty list and undelivered parent synthesis remain truthful");
} catch (cause) {
  await writeFile(join(artifacts, "failure.txt"), `${String(cause)}\n${guiOutput}`);
  for (const [index, session] of sessions.entries()) await shot(session, `failure-${index}`).catch(() => undefined);
  throw cause;
} finally {
  await writeFile(join(artifacts, "evidence.json"), JSON.stringify({ checks, artifacts, directory,
    scope: "Actual WebView2 and production Home/WsClient/controller. Shared-validated scripted child RPC state; no model, real Runtime execution or owner acceptance.", calls: fixture.controlCalls, guiOutput }, null, 2));
  sessions.forEach((session) => session.close()); gui?.kill();
  await fixture.close(); await new Promise((done) => assets.close(done)); await delay(100);
}
console.log(JSON.stringify({ checks: checks.length, artifacts }));

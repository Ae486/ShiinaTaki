/**
 * INPUT: existing isolated native fixture shell, production Home modules and real SQLite PatternService.
 * OUTPUT: recorded WebView2 evidence for review, CAS conflicts, drafts, history and reconnect stability.
 * POS: C3 engineering QA; scripted transport/setup/Timeline, no primary model or real user data.
 */
import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import console from "node:console";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, extname, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createPatternFixture, testDefinition } from "./c3-pattern-native-server.mjs";
import { connectCdp, delay, waitFor } from "./c2-native-driver.mjs";
const { fetch } = globalThis;

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.env.CARGO_TARGET_DIR || join(desktop, "src-tauri/target");
const directory = await mkdtemp(join(tmpdir(), "taki-c3-pattern-native-"));
const output = join(directory, "assets");
const artifacts = join(target, "c3-pattern-native-evidence", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(artifacts, { recursive: true });
await build({ configFile: false, root: desktop, plugins: [react(), tailwindcss()], logLevel: "warn",
  resolve: { alias: { "@": join(desktop, "src") } },
  build: { target: "esnext", outDir: output, emptyOutDir: false, rollupOptions: { input: join(desktop, "test/c3-pattern-fixture.html") } } });
const fixture = await createPatternFixture(join(directory, "patterns.sqlite"));
const assets = createServer((request, response) => {
  const name = new URL(request.url, "http://fixture").pathname.replace("c2-presence-fixture.html", "c3-pattern-fixture.html");
  const path = resolve(output, `.${name}`);
  if (!path.startsWith(`${resolve(output)}${sep}`)) { response.writeHead(403).end(); return; }
  void readFile(path).then((bytes) => {
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[extname(path)] || "application/octet-stream");
    response.setHeader("Content-Security-Policy", `default-src 'self'; connect-src 'self' ipc: http://ipc.localhost ws://127.0.0.1:${fixture.port}; img-src 'self' data: blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'`);
    response.end(bytes);
  }, () => response.writeHead(404).end());
});
assets.listen(0, "127.0.0.1"); await once(assets, "listening");
const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
const debugPort = reservation.address().port; await new Promise((done) => reservation.close(done));
let gui, guiOutput = "";
const sessions = [], checks = [];
const pass = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const screenshot = async (session, name) => {
  const shot = await session.call("Page.captureScreenshot", { format: "png" });
  await writeFile(join(artifacts, `${name}.png`), Buffer.from(shot.data, "base64"));
};
const hasText = (session, text) => session.evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
const clickText = async (session, text) => {
  const lookup = `[...document.querySelectorAll('button')].find(e => !e.closest('[hidden]') && e.textContent.trim() === ${JSON.stringify(text)} && !e.disabled)`;
  await waitFor(() => session.evaluate(`Boolean(${lookup})`), `ready action ${text}`);
  await session.evaluate(`${lookup}.click()`);
};
const findButton = (session, text) => session.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(e => e.textContent.includes(${JSON.stringify(text)})); if (!button) throw Error('Missing button'); button.click(); })()`);
const setField = (session, label, value) => session.evaluate(`(() => {
  const label = [...document.querySelectorAll('label')].find(e => e.textContent === ${JSON.stringify(label)});
  const input = label && document.getElementById(label.htmlFor); if (!input) throw Error('Missing field');
  const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', {bubbles:true})); input.focus(); input.setSelectionRange(2, 5);
})()`);

try {
  gui = spawn(join(target, "debug/examples/c2-presence-fixture.exe"), [], { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, C2_FIXTURE_ROOT: directory, C2_FIXTURE_ASSET_PORT: String(assets.address().port), C2_FIXTURE_WS_PORT: String(fixture.port),
      WEBVIEW2_USER_DATA_FOLDER: join(directory, "webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}` } });
  for (const stream of [gui.stdout, gui.stderr]) stream.on("data", (chunk) => { guiOutput = (guiOutput + chunk.toString()).slice(-12000); });
  const pages = await waitFor(async () => {
    const items = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return items.filter((page) => page.type === "page").length === 2 && items.filter((page) => page.type === "page");
  }, "native fixture windows");
  for (const page of pages) sessions.push(await connectCdp(page));
  const labels = await Promise.all(sessions.map((session) => session.evaluate("window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label")));
  const home = sessions[labels.indexOf("home")];
  await waitFor(() => fixture.calls.some((call) => call.method === "initiative.setup.read"), "Home setup baseline");
  for (let index = 0; index < 36; index += 1) fixture.append(`原生阅读锚点 ${index}：这是一段用于验证刷新前后阅读位置的隔离测试消息。`);
  await waitFor(() => hasText(home, "原生阅读锚点 35"), "initial conversation");
  await home.evaluate(`(() => {const scroller = document.querySelector('[aria-label="聊天记录"]'); scroller.scrollTop = 200; scroller.dispatchEvent(new Event('scroll')); window.__c3Scroll = scroller.scrollTop; window.__c3Row = document.querySelector('[data-transcript-key]');})()`);
  assert.equal(await home.evaluate("window.__c3Scroll > 0"), true);
  let row = fixture.propose();
  await waitFor(() => hasText(home, "待确认的互动提案"), "live candidate card");
  assert.equal(await home.evaluate("document.querySelector('[aria-label=\"聊天记录\"]').scrollTop === window.__c3Scroll"), true);
  assert.equal(await home.evaluate("document.querySelector('[data-transcript-key]') === window.__c3Row"), true);
  pass("actual Chat candidate append preserves historical reader scroll and row node");

  await clickText(home, "查看并确认"); await waitFor(() => hasText(home, "确认这份提案并生效"), "exact review");
  assert.equal(await hasText(home, "25%"), true);
  assert.equal(await home.evaluate(`document.body.innerHTML.includes(${JSON.stringify(row.patternId)})`), false);
  assert.equal(await home.evaluate(`document.body.innerHTML.includes(${JSON.stringify(row.candidateRevision.revisionId)})`), false);
  await screenshot(home, "candidate-review");
  await clickText(home, "暂不确认"); assert.equal(fixture.current(row.patternId).state, "proposed");
  pass("concrete review contains units and limits, hides identifiers, and close does not activate");

  await clickText(home, "查看并确认");
  row = fixture.propose(testDefinition("并发更新后的互动目的"), row);
  await waitFor(() => hasText(home, "不能确认旧内容"), "review conflict");
  assert.equal(await home.evaluate("[...document.querySelectorAll('button')].find(e => e.textContent === '确认这份提案并生效').disabled"), true);
  assert.equal(fixture.current(row.patternId).state, "proposed");
  await clickText(home, "查看更新后的提案");
  await waitFor(() => home.evaluate("![...document.querySelectorAll('button')].find(e => e.textContent === '确认这份提案并生效')?.disabled"), "updated review ready");
  await clickText(home, "确认这份提案并生效"); await waitFor(() => fixture.current(row.patternId).state === "active", "real Core confirmation");
  pass("concurrent proposal cannot activate unseen content; explicit reread confirms exact real SQLite revision");

  await clickText(home, "主动互动"); await waitFor(() => hasText(home, "新建互动规则"), "management page");
  await findButton(home, "晚间回顾"); await waitFor(() => hasText(home, "修改并提案"), "selected detail");
  await clickText(home, "修改并提案"); await setField(home, "互动目的", "保留这份尚未提交的草稿内容");
  await home.evaluate("window.__c3Editor = [...document.querySelectorAll('textarea')].find(e => !e.closest('[hidden]')); window.__c3Start = window.__c3Editor.selectionStart; window.__c3End = window.__c3Editor.selectionEnd;");
  fixture.holdList = true; await clickText(home, "刷新规则"); await waitFor(() => fixture.held.length > 0, "held warm refresh");
  assert.equal(await home.evaluate("document.contains(window.__c3Editor) && document.activeElement === window.__c3Editor && window.__c3Editor.selectionStart === window.__c3Start && window.__c3Editor.selectionEnd === window.__c3End"), true);
  fixture.failList = true; fixture.release(); await waitFor(() => hasText(home, "读取互动规则失败"), "retained read error");
  assert.equal(await home.evaluate("document.contains(window.__c3Editor) && window.__c3Editor.value === '保留这份尚未提交的草稿内容'"), true);
  await clickText(home, "刷新规则"); await waitFor(() => home.evaluate("![...document.querySelectorAll('button')].find(e => e.textContent === '保存为待确认提案')?.disabled"), "recovered draft");
  pass("held and failed warm refresh preserve editor DOM, focus, selection and unsaved draft");

  row = fixture.current(row.patternId); row = fixture.propose(testDefinition("其他窗口的新提案"), row);
  await waitFor(() => hasText(home, "当前内容已更新，你的草稿已保留"), "draft CAS conflict");
  assert.equal(await home.evaluate("window.__c3Editor.value"), "保留这份尚未提交的草稿内容");
  await clickText(home, "已核对最新内容，保留草稿继续");
  await clickText(home, "保存为待确认提案");
  await waitFor(() => fixture.current(row.patternId).candidateRevision?.definition.purpose === "保留这份尚未提交的草稿内容", "draft proposal stored");
  await waitFor(() => home.evaluate("![...document.querySelectorAll('textarea')].some(e => !e.closest('[hidden]'))"), "completed editor closes");
  await clickText(home, "查看并确认"); await clickText(home, "确认这份提案并生效");
  await waitFor(() => fixture.current(row.patternId).candidateRevision === null, "revision accepted");
  await clickText(home, "暂停"); await waitFor(() => fixture.current(row.patternId).state === "paused", "paused");
  await clickText(home, "恢复"); await waitFor(() => fixture.current(row.patternId).state === "active", "resumed");
  pass("manual revision preserves draft through CAS conflict and uses real pause/resume authority");

  await home.evaluate("[...document.querySelectorAll('summary')].find(e => e.textContent.includes('已确认')).click()");
  await clickText(home, "以此内容创建新提案");
  await waitFor(() => fixture.current(row.patternId).candidateRevision !== null, "rollback candidate");
  assert.equal(fixture.current(row.patternId).state, "active");
  const acceptedBefore = fixture.current(row.patternId).effectiveRevision.revisionId;
  await clickText(home, "查看并确认"); fixture.dropConfirm = true;
  const confirmations = fixture.calls.filter((call) => call.method === "interaction-pattern.confirm").length;
  await clickText(home, "确认这份提案并生效");
  await waitFor(() => fixture.current(row.patternId).effectiveRevision.revisionId !== acceptedBefore, "rollback accepted once");
  await waitFor(() => home.evaluate("document.body.innerText.includes('结果尚未确认') || document.body.innerText.includes('未能确认操作结果')"), "unknown response across reconnect");
  await waitFor(() => home.evaluate("[...document.querySelectorAll('button')].some(e => e.textContent === '修改并提案' && !e.disabled)"), "restored operator readiness");
  assert.equal(fixture.calls.filter((call) => call.method === "interaction-pattern.confirm").length, confirmations + 1);
  pass("history rollback creates a reviewable new revision; lost acknowledgement reconnects without replay");

  await clickText(home, "修改并提案"); await setField(home, "互动目的", "断线后继续保留的编辑草稿");
  await home.evaluate("window.__c3Editor = [...document.querySelectorAll('textarea')].find(e => !e.closest('[hidden]')); window.__c3Start = window.__c3Editor.selectionStart; window.__c3End = window.__c3Editor.selectionEnd;");
  const connections = fixture.connectionCount; fixture.disconnectHome();
  await waitFor(() => fixture.connectionCount > connections, "replacement socket");
  await waitFor(() => home.evaluate("[...document.querySelectorAll('button')].some(e => e.textContent === '保存为待确认提案' && !e.disabled)"), "draft readiness restored");
  assert.equal(await home.evaluate("document.contains(window.__c3Editor) && window.__c3Editor.value === '断线后继续保留的编辑草稿' && window.__c3Editor.selectionStart === window.__c3Start && window.__c3Editor.selectionEnd === window.__c3End"), true);
  await screenshot(home, "reconnected-draft-history");
  await clickText(home, "取消编辑"); await clickText(home, "停用"); await clickText(home, "取消");
  assert.equal(fixture.current(row.patternId).state, "active");
  await clickText(home, "停用"); await clickText(home, "确认停用"); await waitFor(() => fixture.current(row.patternId).state === "retired", "retired");
  pass("reconnect retains the same draft node and selection; retirement needs an explicit second action");

  await clickText(home, "新建互动规则"); await setField(home, "名称", "午后轻松聊聊");
  await setField(home, "互动目的", "下午有空时聊聊最近的兴趣"); await clickText(home, "保存为待确认提案");
  await waitFor(() => fixture.service.list({ characterId: "taki", after: null, limit: 100 }).patterns.length === 2, "manual new proposal");
  await findButton(home, "午后轻松聊聊"); await clickText(home, "查看并确认");
  await screenshot(home, "manual-new-review"); await clickText(home, "暂不确认");
  const manual = fixture.service.list({ characterId: "taki", after: null, limit: 100 }).patterns.find((item) => item.patternId !== row.patternId);
  assert.equal(manual.state, "proposed"); assert.equal(manual.effectiveRevision, null);
  pass("new manual authoring saves complete supported data and remains inactive when review closes");
} catch (cause) {
  await writeFile(join(artifacts, "failure.txt"), `${String(cause)}\n${guiOutput}\n${JSON.stringify(fixture.calls)}`);
  for (const [index, session] of sessions.entries()) await screenshot(session, `failure-${index}`).catch(() => undefined);
  throw cause;
} finally {
  await writeFile(join(artifacts, "evidence.json"), JSON.stringify({ checks, scope: "Real WebView2 + production Home modules + production PatternService/SQLite; scripted transport/setup/Timeline; no primary model or owner acceptance", artifacts, directory, calls: fixture.calls, guiOutput }, null, 2));
  sessions.forEach((session) => session.close()); gui?.kill();
  await fixture.close(); await new Promise((done) => assets.close(done));
  await delay(100);
}
console.log(JSON.stringify({ checks: checks.length, artifacts }));

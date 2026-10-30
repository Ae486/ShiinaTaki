// Isolated built Home -> production Rust adapter -> actual helper/Host/SQLite.
// No Taki Node/Core boot, live QQ/model, default installation or user WebView data.
import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import console from "node:console";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL } from "node:url";

const { fetch, WebSocket } = globalThis;
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(desktop, "../../../..", "QQMessageMonitor");
const targetDirectory = process.env.CARGO_TARGET_DIR || join(desktop, "src-tauri/target");
const built = (path) => import(pathToFileURL(join(repository, "dist", path)).href);
const { ConfigSchema } = await built("config/schema.js");
const { openDatabase } = await built("storage/database.js");
const { createStorage } = await built("storage/index.js");
const { seedSummaryHistory } = await import(pathToFileURL(join(repository, "apps/management-desktop/test/native-summary-fixture.mjs")).href);
const { seedToolResultHistory, assertToolBaseline, verifyNativeToolParts } = await import(pathToFileURL(join(repository, "apps/management-desktop/test/native-tool-result-fixture.mjs")).href);
const { nativeM4View } = await import(pathToFileURL(join(repository, "apps/management-desktop/test/native-m4-view.mjs")).href);
const { runNativeM4 } = await import(pathToFileURL(join(repository, "apps/management-desktop/test/native-m4-scenarios.mjs")).href);
const { createStandaloneHostClient } = await built("client/standalone-host-client.js");
const directory = await mkdtemp(join(tmpdir(), "taki-qqmm-home-"));
const artifacts = join(targetDirectory, "qqmm-evidence", `m4-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`);
await mkdir(artifacts, { recursive: true });
const configPath = join(directory, "config.json"), dbPath = join(directory, "fixture.db");
const installation = join(directory, "installation.json");
const bridge = createServer((_request, response) => { response.statusCode = 503; response.end(); });
bridge.on("upgrade", (_request, socket) => socket.destroy());
bridge.listen(0, "127.0.0.1"); await once(bridge, "listening");
const config = ConfigSchema.parse({ configVersion: 2, account: { targetSelfUin: "10001" },
  bridge: { url: `ws://127.0.0.1:${bridge.address().port}`, accessTokenEnv: "QQMM_TAKI_FIXTURE_TOKEN", connectTimeoutMs: 1000 },
  capture: { groups: { whitelist: ["123"] }, friends: { mode: "whitelist", whitelist: [] } }, summary: { enabled: false, dimensions: { facts: { description: "后来配置的新说明" } } },
  storage: { databasePath: dbPath }, logging: { level: "error", includeMessageContent: false } });
await writeFile(configPath, JSON.stringify(config));
const now = Date.now(), oldText = "旧消息将在缩短保留期后删除", youngText = "原生 Taki 历史 <script> 不执行 </script> deadbeef-1.2.3";
const longText = youngText + "。这是需要分段阅读的消息正文".repeat(450);
const seedDb = openDatabase(dbPath);
let summaryFixture, toolFixture;
try {
  const storage = createStorage(seedDb, { retentionDays: 30, now: () => now, targetSelfUin: "10001" });
  const add = (id, timestamp, projection) => storage.messages.ingest(
    { selfUin: "10001", type: "group", sourceId: "123", displayName: "离线测试群", summaryEnabled: false },
    { sourceMessageId: id, sourceTimestamp: timestamp, senderUin: "20002", senderName: "测试成员", isOwner: false, direction: "in", projection }, timestamp);
  add("old", now - 10 * 86400000, oldText);
  for (let index = 0; index < 129; index++) add(`young-${index}`, now - (130 - index) * 1000, `离线消息 ${index + 1}`);
  add("latest", now, longText);
  toolFixture = seedToolResultHistory({ storage, db: seedDb, config, now });
  summaryFixture = seedSummaryHistory({ storage, db: seedDb, now });
} finally { seedDb.close(); }
const profileId = "taki-native-fixture";
await writeFile(installation, JSON.stringify({ version: 1, nodeExecutable: process.execPath, helperEntry: join(repository, "dist/client/management-helper-main.js"), rootDirectory: directory, profileId, configPath, apiVersion: "v1" }));
const env = { ...process.env, QQMM_TAKI_FIXTURE_TOKEN: "isolated-fixture-only", QQMM_MANAGEMENT_INSTALLATION: installation, QQMM_FIXTURE_ROOT: directory };
const args = ["--root-directory", directory, "--profile-id", profileId, "--config", configPath, "--api-version", "v1"];
const probe = createStandaloneHostClient({ rootDirectory: directory, profileId, configPath, apiVersion: "v1", startupTimeoutMs: 15000, pollIntervalMs: 100 },
  { launcher: { launch: async () => { throw new Error("The fixture probe never launches Host"); } } });
let host, gui, home;
let debugPort;
let guiOutput = "", observedPages = [];
const sockets = [], checks = [];
function check(name) { checks.push(name); console.log(`PASS ${name}`); }
async function waitFor(callback, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const value = await callback(); if (value) return value; }
    catch { /* Startup probes may fail until the isolated process is ready. */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Isolated native fixture wait timed out: ${callback.toString().slice(0, 180)}`);
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([once(child, "exit"), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("Owned process did not exit")), 10000); timer.unref(); })]);
}
async function startHost() {
  host = spawn(process.execPath, [join(repository, "dist/host/main.js"), ...args], { env, windowsHide: true, stdio: "ignore", shell: false });
  await waitFor(async () => (await probe.ensureHost()).pid === host.pid);
}
async function connectCdp(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl); sockets.push(socket); await once(socket, "open");
  const pending = new Map(); let id = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data), waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    }
  });
  const call = (method, params = {}) => new Promise((resolveResult, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout ${method}`)); }, 10000);
    pending.set(requestId, { resolve: (value) => { clearTimeout(timer); resolveResult(value); }, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  return { call, evaluate: async (expression) => {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  } };
}
async function startGui() {
  const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = reservation.address().port; await new Promise((done) => reservation.close(done));
  debugPort = port;
  guiOutput = ""; observedPages = [];
  gui = spawn(join(targetDirectory, "debug/examples/qqmm-home-fixture.exe"), [], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: false,
    env: { ...env, WEBVIEW2_USER_DATA_FOLDER: join(directory, "webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
  for (const pipe of [gui.stdout, gui.stderr]) pipe.on("data", (chunk) => { guiOutput = (guiOutput + chunk.toString()).slice(-8000); });
  const pages = await waitFor(async () => {
    const items = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    observedPages = items;
    return items.filter((page) => page.type === "page").length === 4 ? items : false;
  });
  const sessions = await Promise.all(pages.filter((page) => page.type === "page").map(connectCdp));
  const labels = await Promise.all(sessions.map((session) => waitFor(() => session.evaluate("window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label || null"))));
  const windows = Object.fromEntries(labels.map((label, index) => [label, sessions[index]]));
  home = windows.home;
  await waitFor(() => home.evaluate("document.querySelectorAll('[data-qqmm-row]').length > 0"));
  return windows;
}
async function closeGui() {
  if (home && gui?.exitCode === null) await home.evaluate("window.__TAURI_INTERNALS__.invoke('qqmm_close').then(()=>true)").catch(() => {});
  if (home && await home.evaluate("!!window.fixtureChannels").catch(() => false)) {
    await waitFor(() => home.evaluate("window.fixtureChannels.second.ended"));
  }
  for (const socket of sockets.splice(0)) socket.close();
  await stop(gui); gui = undefined; home = undefined;
}
async function clickText(text) {
  await home.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error('Missing button');button.click();})()`);
}
async function input(label, value) {
  await home.evaluate(`(()=>{const l=[...document.querySelectorAll('label')].find(e=>e.textContent===${JSON.stringify(label)});const e=document.getElementById(l.htmlFor);const proto=e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
}
async function screenshot(name) {
  const shot = await home.call("Page.captureScreenshot", { format: "png" });
  await writeFile(join(artifacts, `${name}.png`), Buffer.from(shot.data, "base64"));
}
const management = nativeM4View("taki", (expression) => home.evaluate(expression), waitFor);
async function closeAndReopenHome(windows) {
  // Send WM_CLOSE only to this owned fixture process's visible Home window.
  // The other native fixture windows keep the app alive, so Destroyed cleanup
  // and reuse of the Home label are exercised independently of process exit.
  const closer = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `$fixtureProcess = Get-Process -Id ${gui.pid}\nif (-not $fixtureProcess.CloseMainWindow()) { exit 1 }`], { windowsHide: true, stdio: "ignore", shell: false });
  const [code] = await once(closer, "exit"); assert.equal(code, 0);
  await waitFor(async () => !(await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).some((page) => page.url.includes("home.html")));
  home = undefined;
  assert.equal(gui.exitCode, null); assert.equal((await probe.ensureHost()).pid, host.pid);
  await windows.pet.evaluate("window.__TAURI_INTERNALS__.invoke('plugin:webview|create_webview_window',{options:{label:'home',url:'home.html?page=qqmm',title:'QQMM isolated reopened Home',width:1100,height:850}})");
  const page = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((item) => item.url.includes("home.html")));
  home = await connectCdp(page);
  await waitFor(() => home.evaluate("document.querySelectorAll('[data-qqmm-row]').length > 0"));
  assert.equal(await home.evaluate("fetch(location.href).then(r=>r.headers.get('content-security-policy')).then(p=>!p.includes('ws://'))"), true);
  assert.equal(await home.evaluate("document.querySelector('[aria-label=\"记录与设置\"]').textContent.includes('当前 7 天')"), true);
  await screenshot("home-recreated");
}
const count = () => home.evaluate("document.querySelectorAll('[data-qqmm-row]').length");

async function selectConversation(name) {
  const value = await waitFor(() => home.evaluate(`(()=>{const l=[...document.querySelectorAll('label')].find(e=>e.textContent==='会话');return [...document.getElementById(l.htmlFor).options].find(e=>e.textContent.includes(${JSON.stringify(name)}))?.value;})()`));
  assert.notEqual(value, undefined); await input("会话", value);
}
const detailBody = "document.querySelector('[aria-label=\"日志详情\"] [tabindex=\"0\"] p')";
async function closeDetail() { await home.evaluate("document.querySelector('[aria-label=\"日志详情\"] button[aria-label=\"关闭\"]').click()"); }
async function browseSummary() {
  await input("会话", ""); await input("搜索内容", ""); await input("类型", "summary");
  await waitFor(async () => await count() === 100); await clickText("加载更早记录"); await waitFor(async () => await count() > 100);
  await selectConversation(summaryFixture.conversationName); await waitFor(async () => await count() === 3);
  await home.evaluate("document.querySelector('[data-qqmm-row]:first-child button').click()");
  await waitFor(() => home.evaluate(`!!${detailBody}`));
  assert.equal(await home.evaluate(`${detailBody}.textContent.includes('原始摘要正文')`), false);
  assert.equal(await home.evaluate("[...document.querySelector('[aria-label=\"日志详情\"]').querySelectorAll('button')].some(e=>e.textContent==='下一项')"), false);
  await closeDetail(); await home.evaluate("document.querySelector('[data-qqmm-row]:last-child button').click()");
  await waitFor(() => home.evaluate(`${detailBody}?.textContent.startsWith('原始摘要正文')`));
  assert.equal(await home.evaluate(`${detailBody}.textContent`), Array.from(summaryFixture.summaryText).slice(0, 4096).join(""));
  await clickText("下一段"); await waitFor(() => home.evaluate("document.querySelector('[aria-label=\"日志详情\"]').textContent.includes('第 4097')"));
  await clickText("下一项"); await waitFor(() => home.evaluate(`document.querySelector('[aria-label="日志详情"] h3').textContent===${JSON.stringify(summaryFixture.savedTitle)}`));
  assert.equal(await home.evaluate(`${detailBody}.textContent`), Array.from(summaryFixture.findingText).slice(0, 4096).join(""));
  assert.equal(await home.evaluate(`document.querySelector('[aria-label="日志详情"]').textContent.includes(${JSON.stringify(summaryFixture.currentTitle)})`), false);
  assert.equal(await home.evaluate("document.querySelector('[aria-label=\"日志详情\"]').textContent.includes('空分项不展示')"), false);
  await home.evaluate(`${detailBody}.parentElement.scrollTop=${detailBody}.parentElement.scrollHeight`);
  assert.ok(await home.evaluate(`${detailBody}.parentElement.scrollTop > 0`));
  await clickText("下一项"); await waitFor(() => home.evaluate(`document.querySelector('[aria-label="日志详情"] h3').textContent===${JSON.stringify(summaryFixture.repeatedTitle)}`));
  assert.equal(await home.evaluate(`${detailBody}.parentElement.scrollTop`), 0);
  await home.evaluate(`${detailBody}.parentElement.scrollTop=${detailBody}.parentElement.scrollHeight`);
  assert.ok(await home.evaluate(`${detailBody}.parentElement.scrollTop > 0`));
  await clickText("下一段"); await waitFor(() => home.evaluate("document.querySelector('[aria-label=\"日志详情\"]').textContent.includes('第 4097')"));
  assert.equal(await home.evaluate(`${detailBody}.parentElement.scrollTop`), 0);
  await screenshot("summary-saved-dimension"); await clickText("返回摘要");
  await waitFor(() => home.evaluate(`${detailBody}?.textContent.startsWith('原始摘要正文')`));
  await clickText("查看来源消息"); await waitFor(() => home.evaluate("document.querySelectorAll('ul[aria-label=\"来源消息\"] li').length===20"));
  assert.equal(await home.evaluate("document.querySelector('[aria-label=\"日志详情\"]').textContent.includes('原始消息 23 条 · 1 条原文不可用')"), true);
  await home.evaluate("document.querySelector('ul[aria-label=\"来源消息\"] li:first-child button').click()");
  await waitFor(() => home.evaluate(`${detailBody}?.textContent.startsWith('当时原文')`));
  assert.equal(await home.evaluate(`${detailBody}.textContent`), Array.from(summaryFixture.sourceText).slice(0, 4096).join(""));
  assert.equal(await home.evaluate("document.querySelector('[aria-label=\"日志详情\"]').textContent.includes('已撤回')"), true);
  await clickText("下一段"); await waitFor(() => home.evaluate("document.querySelector('[aria-label=\"日志详情\"]').textContent.includes('第 4097')"));
  await screenshot("summary-recorded-source"); await clickText("返回来源列表");
  await home.evaluate("document.querySelector('ul[aria-label=\"来源消息\"] li:nth-child(2) button').click()");
  await waitFor(() => home.evaluate("document.querySelector('[aria-label=\"日志详情\"]').textContent.includes('未保留这条来源')"));
  assert.equal(await home.evaluate(`!!document.querySelector('[aria-label="日志详情"]') && !${detailBody}`), true);
  await clickText("返回来源列表"); await clickText("下一页来源");
  await waitFor(() => home.evaluate("document.querySelectorAll('ul[aria-label=\"来源消息\"] li').length===3"));
  assert.equal(await home.evaluate("document.querySelector('ul[aria-label=\"来源消息\"]').textContent.includes('来源尾部独立保留')"), true);
  await closeDetail();
  check("summary stages, saved nonempty dimension, Unicode chunks and recalled/missing source pages remain faithful through the actual Home adapter");
}
async function setNativeDays(days) {
  await home.evaluate(`(async()=>{const invoke=window.__TAURI_INTERNALS__.invoke;const config=await invoke('qqmm_request',{command:'config.get',params:{}});const params={retentionDays:${days},revision:config.revision};await invoke('qqmm_request',{command:'config.validate',params});await invoke('qqmm_request',{command:'config.apply',params});})()`);
}
async function verifyToolsUnchanged(afterExpiry = false) {
  await waitFor(() => {
    const inspect = openDatabase(dbPath);
    try { assertToolBaseline(inspect, toolFixture.baseline, afterExpiry ? inspect.raw.prepare("SELECT cutoff FROM retention_state WHERE id=1").get().cutoff : null); return true; }
    finally { inspect.close(); }
  });
}
async function browseToolEntry(entry, index) {
  await home.evaluate(`document.querySelectorAll('[data-qqmm-row]')[${index}].querySelector('button').click()`);
  const advance = async (label) => { await home.evaluate(`${detailBody}.parentElement.scrollTop=${detailBody}.parentElement.scrollHeight`); await clickText(label); };
  await verifyNativeToolParts({ entry, waitFor,
    read: () => home.evaluate(`(()=>{const d=document.querySelector('[aria-label="日志详情"]');if(!d||!${detailBody})return null;const buttons=[...d.querySelectorAll('button')].map(e=>e.textContent.trim());return {title:d.querySelector('h3')?.textContent,text:${detailBody}.textContent,header:d.textContent,position:d.textContent,scrollTop:${detailBody}.parentElement.scrollTop,hasNextPart:buttons.includes('下一部分'),hasNextChunk:buttons.includes('下一段'),sources:buttons.includes('查看来源消息'),summaryNavigation:buttons.includes('返回摘要')};})()`),
    nextChunk: () => advance("下一段"), nextPart: () => advance("下一部分"),
  });
  assert.equal(await home.evaluate("document.querySelector('[aria-label=\"日志详情\"] h2').textContent"), "工具结果详情");
  assert.equal(await home.evaluate("document.querySelector('[aria-label=\"日志详情\"]').textContent.includes('private-native')"), false);
  if (entry.name === "literal") await screenshot("tool-literal-parts");
  await closeDetail();
}
async function browseTools() {
  await input("会话", ""); await input("搜索内容", ""); await input("类型", "tool_result");
  await waitFor(async () => await count() === toolFixture.records.length);
  for (const [index, entry] of toolFixture.records.entries()) await browseToolEntry(entry, index);
  const feed = toolFixture.records.find((entry) => entry.name === "feed");
  for (const conversation of toolFixture.conversations) {
    await input("会话", conversation.ref);
    const selected = toolFixture.records.filter((entry) => conversation.recordIds.includes(entry.record.recordId));
    await waitFor(async () => await count() === selected.length);
    await browseToolEntry(feed, selected.indexOf(feed));
  }
  await verifyToolsUnchanged();
  check("actual tool results preserve complete saved parts, Unicode/NUL, recall, labels and occurrence counts; either conversation filter returns the whole invocation and browsing preserves both progress tables/tool records");
}
async function expireSelectedTool() {
  await input("会话", ""); await input("搜索内容", ""); await input("类型", "tool_result");
  await waitFor(async () => await count() === toolFixture.records.length);
  const index = toolFixture.records.findIndex((entry) => entry.name === "mixed");
  await home.evaluate(`document.querySelectorAll('[data-qqmm-row]')[${index}].querySelector('button').click()`);
  await waitFor(() => home.evaluate(`!!${detailBody}`)); await clickText("下一部分");
  await waitFor(() => home.evaluate("document.querySelector('[aria-label=\"日志详情\"]').textContent.includes('返回结果开头')"));
  // The tool ancestor is exactly three days old. Keep the two-day M2 summary
  // alive so its selected-source expiry is still exercised independently below.
  await setNativeDays(3); await waitFor(() => home.evaluate("!document.querySelector('[aria-label=\"日志详情\"]')"));
  await input("类型", "message"); await input("搜索内容", toolFixture.survivorText); await waitFor(async () => await count() === 1);
  await verifyToolsUnchanged(true); await setNativeDays(7);
  check("three-level mixed-date tool expiry clears the entire selected result and preserves the younger original without any new tool invocation");
}
async function expireSelectedSummary() {
  await home.evaluate("document.querySelector('[data-qqmm-row]:last-child button').click()");
  await waitFor(() => home.evaluate(`!!${detailBody}`)); await clickText("查看来源消息");
  await waitFor(() => home.evaluate("document.querySelectorAll('ul[aria-label=\"来源消息\"] li').length===20"));
  await home.evaluate("document.querySelector('ul[aria-label=\"来源消息\"] li:first-child button').click()");
  await waitFor(() => home.evaluate(`${detailBody}?.textContent.startsWith('当时原文')`)); await setNativeDays(1);
  await waitFor(() => home.evaluate("!document.querySelector('[aria-label=\"日志详情\"]') && document.querySelectorAll('[data-qqmm-row]').length===0"));
  assert.equal(await home.evaluate("document.body.textContent.includes('当时原文')"), false);
  await input("类型", "message"); await input("搜索内容", summaryFixture.survivorText); await waitFor(async () => await count() === 1);
  await setNativeDays(7); await waitFor(() => home.evaluate("document.querySelector('[aria-label=\"记录与设置\"]').textContent.includes('当前 7 天')"));
  check("selected parent expiry removes every source/detail fragment and younger original messages remain independently readable");
}

try {
  await startHost(); const windows = await startGui();
  const policy = await home.evaluate("fetch(location.href).then(response => response.headers.get('content-security-policy'))");
  assert.ok(policy && !policy.includes("ws://") && !policy.includes("wss://"));
  assert.equal(await home.evaluate("document.querySelector('main').innerText.includes('Core')"), false);
  const aclDenials = [];
  for (const label of ["main", "pet", "other"]) for (const command of ["qqmm_open", "qqmm_request", "qqmm_close"]) {
    const response = await windows[label].evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},{command:'config.apply',params:{}}).then(()=>({allowed:true}),e=>({allowed:false,error:String(e)}))`);
    assert.equal(response.allowed, false); assert.match(response.error, /not allowed|not found|forbidden/i);
    aclDenials.push({ label, command, error: response.error });
  }
  await writeFile(join(artifacts, "acl-denials.json"), JSON.stringify(aclDenials, null, 2));
  check("built Home automatically connects with Core networking blocked; main/pet/other QQMM commands are denied");
  for (const label of ["home", "main", "pet"]) await windows[label].evaluate(`(async()=>{
    window.fixtureEvents={any:0,home:0};
    for(const [key,target] of [['any',{kind:'Any'}],['home',{kind:'WebviewWindow',label:'home'}]]) {
      const handler=window.__TAURI_INTERNALS__.transformCallback(()=>{window.fixtureEvents[key]++;});
      await window.__TAURI_INTERNALS__.invoke('plugin:event|listen',{event:'qqmm://event',target,handler});
    }
  })()`);
  await input("类型", "message"); await selectConversation("离线测试群"); await waitFor(async () => await count() === 100);
  await home.evaluate("document.querySelector('[aria-label=\"日志列表\"]').scrollTop=0");
  const before = await home.evaluate("(()=>{const e=document.querySelector('[data-qqmm-row]');return {text:e.innerText,top:e.getBoundingClientRect().top};})()");
  await clickText("加载更早记录"); await waitFor(async () => await count() === 131);
  const after = await home.evaluate(`(()=>{const e=[...document.querySelectorAll('[data-qqmm-row]')].find(e=>e.innerText===${JSON.stringify(before.text)});return e.getBoundingClientRect().top;})()`);
  assert.ok(Math.abs(after - before.top) < 2, `scroll anchor drift ${after - before.top}`);
  await home.evaluate("document.querySelector('[data-qqmm-row]:last-child button').click()");
  await waitFor(() => home.evaluate("!!document.querySelector('[aria-label=\"日志详情\"] .whitespace-pre-wrap')"));
  assert.equal(await home.evaluate("document.querySelector('[aria-label=\"日志详情\"] .whitespace-pre-wrap').textContent"), longText.slice(0, 4096));
  await clickText("下一段");
  await waitFor(() => home.evaluate("document.querySelector('[aria-label=\"日志详情\"]').textContent.includes('第 4097')"));
  await screenshot("detail");
  await home.evaluate("document.querySelector('[aria-label=\"日志详情\"] button[aria-label=\"关闭\"]').click()");
  check("bounded older-page history preserves the visible anchor; literal detail paginates without executing authored markup");
  await browseSummary(); await browseTools();
  await input("类型", "message"); await selectConversation("离线测试群"); await waitFor(async () => await count() === 100);
  await clickText("设置");
  await waitFor(() => home.evaluate("!document.querySelector('[aria-label=\"QQ 消息\"]').textContent.includes('测试成员')"));
  await clickText("QQ 消息"); await waitFor(async () => await count() > 0);
  await clickText("暂停显示"); await clickText("清空当前视图"); await waitFor(async () => await count() === 0);
  await clickText("继续显示"); await input("搜索内容", oldText); await waitFor(async () => await count() === 1);
  // Directly exercise native Channel rebinding on an already open view. Each
  // callback belongs to this actual WebView; the old one must receive its end.
  await home.evaluate(`(async()=>{
    window.fixtureChannels={first:{events:0,ended:false},second:{events:0,ended:false}};
    for(const name of ['first','second']) {
      const id=window.__TAURI_INTERNALS__.transformCallback(raw=>{
        if(raw.end){window.fixtureChannels[name].ended=true;window.__TAURI_INTERNALS__.unregisterCallback(id);}
        else window.fixtureChannels[name].events++;
      });
      await window.__TAURI_INTERNALS__.invoke('qqmm_open',{onEvent:'__CHANNEL__:'+id});
    }
  })()`);
  await waitFor(() => home.evaluate("window.fixtureChannels.first.ended"));
  const firstEvents = await home.evaluate("window.fixtureChannels.first.events");
  await management.settings(); await management.input("保留天数", "7"); await management.save();
  await waitFor(() => home.evaluate("document.querySelector('[aria-label=\"记录与设置\"]').textContent.includes('当前 7 天')"));
  await waitFor(() => home.evaluate("window.fixtureChannels.second.events > 0"));
  assert.equal(await home.evaluate("window.fixtureChannels.first.events"), firstEvents);
  for (const label of ["home", "main", "pet"]) assert.deepEqual(await windows[label].evaluate("window.fixtureEvents"), { any: 0, home: 0 });
  await management.records();
  await waitFor(async () => await count() === 0);
  await input("搜索内容", ""); await waitFor(async () => await count() === 100);
  await screenshot("history-retention");
  check("route hiding clears retained content; pause/clear/filter work; native save expires old content and emits only to Home");
  await closeAndReopenHome(windows);
  check("actual Home destruction releases its view; recreating Home via the existing Pet permission reconnects independently of Core");
  await closeGui(); assert.equal(host.exitCode, null); assert.equal((await probe.ensureHost()).pid, host.pid);
  const inspect = openDatabase(dbPath);
  try { assertToolBaseline(inspect, toolFixture.baseline); }
  finally { inspect.close(); }
  const previousPid = host.pid; await stop(host); await startHost(); assert.notEqual(host.pid, previousPid); await startGui();
  await input("类型", "message"); await input("搜索内容", oldText); await waitFor(async () => await count() === 0);
  assert.equal(await home.evaluate("document.querySelector('[aria-label=\"记录与设置\"]').textContent.includes('当前 7 天')"), true);
  await input("搜索内容", youngText); await waitFor(async () => await count() === 1); await screenshot("restarted");
  await browseTools(); await expireSelectedTool(); await browseSummary(); await expireSelectedSummary();
  await verifyToolsUnchanged(true);
  await closeGui(); assert.equal((await probe.ensureHost()).pid, host.pid);
  check("Host survives window teardown; restart preserves history/retention without reviving expired data or advancing Agent progress");
  checks.push(...await runNativeM4({ kind: "taki", executable: join(targetDirectory, "debug/examples/qqmm-home-fixture.exe"), repository, artifacts: join(artifacts, "management") }));
  await writeFile(join(artifacts, "result.json"), JSON.stringify({ milestone: "M4", checks, fixtureDirectory: directory, toolInvocations: toolFixture.records.length, baseline: toolFixture.baseline }, null, 2));
  console.log(`Evidence: ${artifacts}`);
} catch (error) {
  await writeFile(join(artifacts, "native-launch.json"), JSON.stringify({ exitCode: gui?.exitCode, output: guiOutput, pages: observedPages }, null, 2));
  if (home) {
    await screenshot("failed").catch(() => {});
    await writeFile(join(artifacts, "failure.json"), JSON.stringify({ error: String(error), text: await home.evaluate("document.body.innerText").catch(() => "unavailable") }, null, 2));
  }
  throw error;
} finally {
  try { await closeGui(); } catch { await stop(gui); }
  await probe.close(); await stop(host);
  bridge.closeAllConnections(); await new Promise((done) => bridge.close(done));
}

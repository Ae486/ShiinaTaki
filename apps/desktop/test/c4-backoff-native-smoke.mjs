/**
 * INPUT: already-built C2 isolated WebView2 shell and current production Home/Monitor components.
 * OUTPUT: C4 native screenshots, protocol-call assertions and a source-hash evidence manifest.
 * POS: presentation QA with scripted domain/protocol data; no real Core/model/user profile or owner acceptance.
 */
import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import console from "node:console";
import { createHash, randomInt } from "node:crypto";
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
import { createBackoffFixture } from "./c4-backoff-native-server.mjs";
import { connectCdp, delay, waitFor } from "./c2-native-driver.mjs";
const { fetch } = globalThis;

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(desktop, "../..");
const target = resolve(process.env.CARGO_TARGET_DIR || join(desktop, "src-tauri/target"));
const binary = join(target, "debug/examples/c2-presence-fixture.exe");
assert.ok(binary.startsWith(`${workspace}${sep}`), "Only the verified T4 fixture shell may be used");
const directory = await mkdtemp(join(tmpdir(), "taki-c4-backoff-native-"));
const output = join(directory, "assets");
const artifacts = join(workspace, ".trellis/tasks/09-11-initiative-intentions-acceptance/research/validation",
  `backoff-native-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`);
const sourcePaths = ["test/c3-pattern-fixture.tsx", "test/c4-backoff-native-server.mjs", "test/c4-backoff-native-smoke.mjs",
  "src/windows/home/home-shell.tsx", "src/features/initiative-patterns/initiative-backoff-controller.ts",
  "src/features/initiative-patterns/initiative-backoff-view.tsx", "src/features/initiative-patterns/use-initiative-backoff.ts",
  "src/features/initiative-patterns/initiative-policy-diagnostics.tsx", "src/features/initiative-patterns/follow-up-tool-display.ts",
  "src/windows/home/pages/chat/tool-result-display.ts", "src/lib/ws-client.ts", "src/lib/ws-client-routes.ts", "src/lib/ws-client-initiative.ts"];
const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async (path) =>
  [path, createHash("sha256").update(await readFile(join(desktop, path))).digest("hex")])));
const sourceHashes = await hashes();
const shellSha256 = createHash("sha256").update(await readFile(binary)).digest("hex");
await mkdir(artifacts, { recursive: true });
await build({ configFile: false, root: desktop, plugins: [react(), tailwindcss()], logLevel: "warn",
  resolve: { alias: { "@": join(desktop, "src") } },
  build: { target: "esnext", outDir: output, emptyOutDir: false, rollupOptions: { input: join(desktop, "test/c3-pattern-fixture.html") } } });
assert.deepEqual(await hashes(), sourceHashes, "Source changed during the frozen asset build");
const fixture = await createBackoffFixture(join(directory, "fixture.sqlite"));
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
await listenSafe(assets);
const reservation = createServer(); await listenSafe(reservation);
const debugPort = reservation.address().port; await new Promise((done) => reservation.close(done));
const sessions = [], checks = [], views = [];
let gui, guiOutput = "", failure = null;
const pass = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const section = `document.querySelector('section[aria-label="主动互动频率调整"]')`;
const hasText = (session, text) => session.evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
const readView = (session) => session.evaluate(`Object.fromEntries([...${section}.querySelectorAll('dl > div')].map(e => [e.querySelector('dt').textContent, e.querySelector('dd').textContent]))`);
const calls = (method) => fixture.calls.filter((call) => call.method === method).length;
const button = (label) => `[...document.querySelectorAll('button')].find(e => !e.closest('[hidden]') && e.textContent.trim() === ${JSON.stringify(label)})`;
const click = async (session, label) => {
  await waitFor(() => session.evaluate(`Boolean(${button(label)} && !${button(label)}.disabled)`), `ready action ${label}`);
  await session.evaluate(`${button(label)}.click()`);
};
const screenshot = async (session, name) => {
  const shot = await session.call("Page.captureScreenshot", { format: "png" });
  await writeFile(join(artifacts, `${name}.png`), Buffer.from(shot.data, "base64"));
};

try {
  gui = spawn(binary, [], { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, C2_FIXTURE_ROOT: directory, C2_FIXTURE_ASSET_PORT: String(assets.address().port), C2_FIXTURE_WS_PORT: String(fixture.port),
      WEBVIEW2_USER_DATA_FOLDER: join(directory, "webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}` } });
  for (const stream of [gui.stdout, gui.stderr]) stream.on("data", (chunk) => { guiOutput = (guiOutput + chunk.toString()).slice(-12000); });
  const pages = await waitFor(async () => {
    const items = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const visible = items.filter((page) => page.type === "page"); return visible.length === 2 && visible;
  }, "isolated WebView2 windows");
  for (const page of pages) sessions.push(await connectCdp(page));
  const labels = await Promise.all(sessions.map((session) => session.evaluate("window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label")));
  const home = sessions[labels.indexOf("home")]; assert.ok(home);
  await click(home, "运行监视");
  await waitFor(() => hasText(home, "主动互动判断"), "Monitor policy disclosure");
  await home.evaluate("[...document.querySelectorAll('summary')].find(e => e.textContent.startsWith('主动互动判断')).click()");
  await waitFor(() => hasText(home, "暂时无法读取退避状态"), "initial scripted read failure");
  assert.deepEqual(await readView(home), { 当前阶段: "未知", 最近七天有效未回应记录: "未知", 当前日额度占用: "未知", 退避等待至: "未知" });
  assert.equal(await home.evaluate(`${button("重置互动退避")}.disabled`), true);
  await screenshot(home, "01-unknown-status"); pass("cold read failure shows unknown fields and disabled reset, never fabricated zero");

  await click(home, "刷新退避状态"); await waitFor(() => hasText(home, "正常（1 倍间隔）"), "known normal stage");
  await home.evaluate(`void (window.__c4Section = ${section})`);
  for (const [stage, count, label] of [["double", 3, "降低频率（2 倍间隔）"], ["quadruple", 6, "降低频率（4 倍间隔）"], ["daily", 9, "每天最多一次判断"]]) {
    fixture.setBackoff(stage, count); await waitFor(() => hasText(home, label), `live ${stage} stage`);
    const view = await readView(home); views.push(view);
    assert.equal(view.最近七天有效未回应记录, `${count} 次`); assert.equal(view.当前日额度占用, "1 次判断");
    assert.equal(view.退避等待至, await home.evaluate(`new Date(${JSON.stringify(fixture.backoff.nextEligibleAt)}).toLocaleString('zh-CN', {hour12:false})`));
    assert.equal(await home.evaluate(`window.__c4Section === ${section}`), true);
  }
  await screenshot(home, "02-daily-stage"); pass("real components render scripted 1x/2x/4x/daily stages, counts and exact next eligibility without remounting");

  const reads = calls("observability.initiative-backoff"); fixture.holdBackoff = true;
  await click(home, "刷新退避状态"); await waitFor(() => fixture.heldBackoff.length === 1, "held status read");
  fixture.setBackoff("quadruple", 6); fixture.notify("observability.initiative-backoff-changed"); fixture.notify("observability.initiative-backoff-changed");
  assert.equal(await home.evaluate(`window.__c4Section === ${section}`), true);
  fixture.releaseBackoff(); await waitFor(() => hasText(home, "降低频率（4 倍间隔）"), "covering read after invalidation burst");
  assert.equal(calls("observability.initiative-backoff"), reads + 2);
  pass("held warm read retains the card and finite invalidations require one covering read");

  await click(home, "聊天"); const hiddenReads = calls("observability.initiative-backoff");
  fixture.setBackoff("daily", 9); await delay(300); assert.equal(calls("observability.initiative-backoff"), hiddenReads);
  await click(home, "运行监视"); await waitFor(() => hasText(home, "每天最多一次判断"), "visible return recovery");
  assert.equal(calls("observability.initiative-backoff"), hiddenReads + 1);
  pass("hidden Monitor keeps a dirty obligation without reading and refreshes on actual return");

  fixture.resetMode = "fail-refresh"; await click(home, "重置互动退避");
  await waitFor(() => hasText(home, "已重置主动互动退避"), "accepted reset feedback");
  await waitFor(() => hasText(home, "暂时无法读取退避状态"), "failed reset reconciliation");
  assert.equal((await readView(home)).当前日额度占用, "1 次判断");
  assert.equal(await home.evaluate(`${button("重置互动退避")}.disabled`), true);
  await screenshot(home, "03-accepted-reset-refresh-failure"); pass("accepted reset preserves daily usage while failed refresh stays independently visible");

  await click(home, "刷新退避状态"); await waitFor(() => home.evaluate(`!${button("重置互动退避")}.disabled`), "reset readiness recovered");
  fixture.setBackoff("daily", 9); await waitFor(() => hasText(home, "每天最多一次判断"), "daily stage for lost acknowledgement");
  const resets = calls("initiative.backoff.reset"), connections = fixture.connectionCount; fixture.resetMode = "drop";
  await click(home, "重置互动退避"); await waitFor(() => fixture.connectionCount > connections, "replacement Home socket");
  await waitFor(() => home.evaluate("document.body.innerText.includes('重置结果尚未确认') || document.body.innerText.includes('重置结果未能确认')"), "preserved unknown reset outcome");
  await waitFor(() => home.evaluate(`!${button("重置互动退避")}.disabled`), "new status restored");
  await delay(300); assert.equal(calls("initiative.backoff.reset"), resets + 1);
  assert.equal((await readView(home)).当前阶段, "正常（1 倍间隔）");
  await screenshot(home, "04-reconnected-without-reset-replay"); pass("lost reset acknowledgement reconnects and restores current data without replay or erasing uncertainty");

  await click(home, "聊天"); const canonical = fixture.appendFollowUp();
  await waitFor(() => hasText(home, "安排后续跟进"), "actual Chat tool card");
  await home.evaluate("[...document.querySelectorAll('summary')].find(e => !e.closest('[hidden]') && e.textContent.includes('展开或收起详情')).click()");
  await waitFor(() => hasText(home, "最早考虑时间"), "follow-up semantic disclosure");
  const selected = await home.evaluate("(() => {const text = [...document.querySelectorAll('pre')].find(e => !e.closest('[hidden]')); window.getSelection().selectAllChildren(text); return window.getSelection().toString();})()");
  const markup = await home.evaluate("document.body.innerHTML");
  const accessibility = await home.call("Accessibility.getFullAXTree");
  const accessibleText = JSON.stringify(accessibility.nodes.map((node) => ({ name: node.name?.value, description: node.description?.value })));
  for (const forbidden of ["private-follow-up-call", "plan_follow_up", "reportedEventTime", "toolCallId"]) {
    assert.equal(selected.includes(forbidden), false); assert.equal(markup.includes(forbidden), false); assert.equal(accessibleText.includes(forbidden), false);
  }
  assert.ok(selected.includes("不保证发言")); assert.ok(selected.includes("有效期至")); assert.ok(accessibleText.includes("安排后续跟进"));
  assert.deepEqual(fixture.rows.at(-1), canonical.row);
  await writeFile(join(artifacts, "follow-up-selected-text.json"), JSON.stringify({ selected, canonicalUnchanged: true }, null, 2));
  await screenshot(home, "05-follow-up-details-selection"); pass("actual Chat disclosure, native selected text and accessibility tree remain semantic without changing canonical parts");

  await click(home, "运行监视"); fixture.setBackoff("double", 3); await waitFor(() => hasText(home, "降低频率（2 倍间隔）"), "reset hint race baseline");
  fixture.notifyBeforeResetReply = true; fixture.resetMode = "fail-refresh";
  await click(home, "重置互动退避"); await waitFor(() => hasText(home, "已重置主动互动退避"), "reset echo following its own invalidation");
  await waitFor(() => hasText(home, "暂时无法读取退避状态"), "failed read raced by reset invalidation and echo", 5_000);
  await screenshot(home, "06-reset-invalidation-failure"); pass("a reset invalidation racing its accepted echo does not hide a failed status refresh");
} catch (cause) {
  failure = String(cause);
  for (const [index, session] of sessions.entries()) await screenshot(session, `failure-${index}`).catch(() => undefined);
  throw cause;
} finally {
  await writeFile(join(artifacts, "evidence.json"), JSON.stringify({ checks, passed: failure === null, failure,
    scope: "Real WebView2, production Home/Monitor/Chat/WsClient; scripted Shared-validated backoff/Monitor/Timeline data. No Core backoff/C2 human opportunity/model/owner acceptance.",
    artifacts, directory, sourceHashes, finalSourceHashes: await hashes(), shellSha256, views, calls: fixture.calls, guiOutput }, null, 2));
  sessions.forEach((session) => session.close()); gui?.kill();
  await fixture.close(); await new Promise((done) => assets.close(done)); await delay(100);
}
console.log(JSON.stringify({ checks: checks.length, artifacts }));

async function listenSafe(server) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    try {
      server.listen(randomInt(20_000, 60_000), "127.0.0.1"); await once(server, "listening"); return;
    } catch (cause) { if (cause.code !== "EADDRINUSE") throw cause; }
  }
  throw new Error("No browser-safe fixture HTTP port available");
}

/**
 * INPUT: built debug c2-presence-fixture executable and installed Vite/Tauri/CDP tooling
 * OUTPUT: real native Home/Chat/Pet reporter evidence in an isolated temporary WebView profile
 * POS: C2 native QA — scripted server and fixture-only Pet opener; no Core/provider/user database
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
import { createFixtureServer } from "./c2-native-server.mjs";
import { connectCdp, delay, waitFor, nativeWindow, trustedClick, clickText } from "./c2-native-driver.mjs";
const { fetch } = globalThis;

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.env.CARGO_TARGET_DIR || join(desktop, "src-tauri/target");
const output = join(target, "c2-webview-assets");
const directory = await mkdtemp(join(tmpdir(), "taki-c2-native-"));
const artifacts = join(target, "c2-native-evidence", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(artifacts, { recursive: true });
await build({ configFile: false, root: desktop, plugins: [react(), tailwindcss()], logLevel: "warn",
  resolve: { alias: { "@": join(desktop, "src") } }, define: { "process.env.NODE_ENV": JSON.stringify("development") },
  build: { target: "esnext", outDir: output, emptyOutDir: true, rollupOptions: { input: join(desktop, "test/c2-presence-fixture.html") } } });
const fixture = await createFixtureServer();
let holdMarkdown = true;
const held = [];
const assets = createServer((request, response) => {
  const path = resolve(output, `.${new URL(request.url, "http://fixture").pathname}`);
  if (!path.startsWith(`${resolve(output)}${sep}`)) { response.writeHead(403).end(); return; }
  const send = async () => {
    try {
      response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[extname(path)] || "application/octet-stream");
      response.setHeader("Content-Security-Policy", `default-src 'self'; connect-src 'self' ipc: http://ipc.localhost ws://127.0.0.1:${fixture.port}; img-src 'self' data: blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'`);
      response.end(await readFile(path));
    } catch { response.writeHead(404).end(); }
  };
  if (holdMarkdown && /markdown-view.*\.js$/.test(path)) held.push(send); else void send();
});
assets.listen(0, "127.0.0.1"); await once(assets, "listening");
const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
const debugPort = reservation.address().port; await new Promise((done) => reservation.close(done));
let gui, guiOutput = "";
const sessions = [];
const checks = [];
const diagnostics = [];
const pass = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const latestPresence = (surface) => fixture.state.reports.findLast((report) => report.method === "presence.report" && report.params.surface === surface);
const exposure = (name, seq, value = true) => fixture.state.reports.findLast((report) => report.name === name
  && report.method === "timeline.presentation.report" && report.params.timelineSeq === seq && report.params.exposed === value);
const screenshot = async (session, name) => {
  const shot = await session.call("Page.captureScreenshot", { format: "png" });
  await writeFile(join(artifacts, `${name}.png`), Buffer.from(shot.data, "base64"));
};

try {
  gui = spawn(join(target, "debug/examples/c2-presence-fixture.exe"), [], { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, C2_FIXTURE_ROOT: directory, C2_FIXTURE_ASSET_PORT: String(assets.address().port),
      C2_FIXTURE_WS_PORT: String(fixture.port), WEBVIEW2_USER_DATA_FOLDER: join(directory, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}` } });
  for (const stream of [gui.stdout, gui.stderr]) stream.on("data", (chunk) => { guiOutput = (guiOutput + chunk.toString()).slice(-12000); });
  const pages = await waitFor(async () => {
    const items = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return items.filter((page) => page.type === "page").length === 2 && items.filter((page) => page.type === "page");
  }, "two real WebView2 windows");
  for (const page of pages) sessions.push(await connectCdp(page));
  const labels = await Promise.all(sessions.map((session) => waitFor(() => session.evaluate("window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label"), "native initialization")));
  const home = sessions[labels.indexOf("home")], pet = sessions[labels.indexOf("pet")];
  for (const [label, session] of [["home", home], ["pet", pet]]) diagnostics.push(await session.evaluate(`Promise.all(['is_visible','is_minimized','is_focused'].map(async operation => ({label:${JSON.stringify(label)},operation,result:await window.__TAURI_INTERNALS__.invoke('plugin:window|'+operation,{label:${JSON.stringify(label)}}).catch(String),hidden:document.hidden})))`));
  await waitFor(() => ["home", "chat", "pet"].every((surface) => latestPresence(surface)?.params.visible), "all independent sources visible");
  assert(fixture.state.reports.filter((report) => report.method === "presence.report").every((report) => report.params.lastInput === null));
  for (const connection of fixture.state.clients) {
    const ids = new Set(fixture.state.reports.filter((report) => report.connection === connection.id).map((report) => report.params.sourceId));
    assert(ids.size <= 1, "StrictMode must keep one source for each physical connection");
  }
  pass("actual development StrictMode and independent Home/Chat/Pet sources; opening/focus is not input");

  const first = fixture.append("C2 native committed message");
  await waitFor(() => held.length > 0, "lazy Markdown request held"); await delay(2300);
  assert.equal(exposure("taki-chat", first.seq), undefined);
  assert.equal(exposure("taki-pet", first.seq), undefined);
  assert.equal(await pet.evaluate("!!document.querySelector('[data-pet-bubble-frame]')"), false);
  pass("lazy Skeleton and closed Pet do not expose committed messages or open the bubble");
  holdMarkdown = false; const renderedAfter = Date.now(); held.splice(0).forEach((send) => void send());
  await waitFor(() => exposure("taki-chat", first.seq), "actual rendered Chat exposure");
  assert(exposure("taki-chat", first.seq).at - renderedAfter >= 1900);
  await screenshot(home, "chat-rendered");
  await pet.evaluate("document.querySelector('[data-fixture-open]').click()");
  await waitFor(() => exposure("taki-pet", first.seq), "actual Pet committed Timeline exposure");
  assert.equal(latestPresence("pet").params.lastInput, null);
  await screenshot(pet, "pet-rendered");
  pass("real rendered Chat and Pet text qualify after two seconds; programmatic opening remains input-free");
  const petSource = latestPresence("pet").params.sourceId;
  await pet.evaluate("document.querySelector('[data-fixture-toggle]').click()");
  await waitFor(() => latestPresence("pet")?.params.visible === false, "Pet surface detach");
  await pet.evaluate("document.querySelector('[data-fixture-toggle]').click()");
  await waitFor(() => latestPresence("pet")?.params.visible, "Pet same-client remount");
  assert.equal(latestPresence("pet").params.sourceId, petSource);
  assert(fixture.state.reports.filter((report) => report.params.sourceId === petSource).every((report) => report.params.state !== "retired"));
  pass("actual StrictMode and same-client render remount keep one live source identity");

  await nativeWindow(pet, "pet", "set_focus");
  await waitFor(() => latestPresence("chat")?.params.visible && !latestPresence("chat")?.params.focused, "unfocused visible Chat");
  const unfocused = fixture.append("C2 visible without focus");
  await waitFor(() => exposure("taki-chat", unfocused.seq), "unfocused text exposure");
  pass("visible unfocused text remains eligible");
  await nativeWindow(home, "home", "minimize");
  await waitFor(() => latestPresence("chat")?.params.visible === false && latestPresence("home")?.params.visible === false, "native minimized retirement");
  const hidden = fixture.append("C2 native minimized message"); await delay(2300);
  assert.equal(exposure("taki-chat", hidden.seq), undefined);
  await nativeWindow(home, "home", "unminimize"); await nativeWindow(home, "home", "show");
  await waitFor(() => exposure("taki-chat", hidden.seq), "restored actual text requalifies");
  pass("native minimize ends both Home/Chat visibility; restore requires actual exposure again");

  await clickText(home, "设置");
  await waitFor(() => latestPresence("chat")?.params.visible === false, "retained inactive Chat route");
  const inactive = fixture.append("C2 inactive route message"); await delay(2300);
  assert.equal(exposure("taki-chat", inactive.seq), undefined);
  await clickText(home, "跟随此设备");
  await waitFor(() => fixture.state.timezone.mode === "follow-primary-device" && fixture.state.timezone.source === "device", "designated timezone report");
  assert(fixture.state.calls.filter((call) => call.method === "user-timezone.report").every((call) => fixture.state.clients.size > 0
    && [...fixture.state.clients].some((client) => client.id === call.connection && client.name === "taki-home")));
  await screenshot(home, "timezone-settings");
  await clickText(home, "聊天"); await waitFor(() => exposure("taki-chat", inactive.seq), "route restored text");
  pass("hidden retained Chat stays ineligible; Home settings use the designated source and real device zone");

  await nativeWindow(home, "home", "set_focus"); await delay(200);
  await home.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'a',bubbles:true}))"); await delay(1100);
  assert.equal(latestPresence("chat").params.lastInput, null);
  await trustedClick(home); await waitFor(() => latestPresence("chat")?.params.lastInput !== null, "trusted browser input");
  const input = latestPresence("chat").params.lastInput;
  await waitFor(() => latestPresence("chat")?.params.lastInput?.sequence === input.sequence
    && latestPresence("chat").params.lastInput.ageMs > 10_000, "renewal preserves input age", 20_000);
  pass("synthetic DOM input rejected; trusted browser input accepted; renewal preserves original age");
  const chatConnection = latestPresence("chat").connection;
  const oldHome = latestPresence("home").connection;
  fixture.disconnect("taki-home");
  await waitFor(() => latestPresence("home")?.connection !== oldHome && latestPresence("home")?.params.visible, "independent Home reconnect");
  assert.equal(latestPresence("home").params.lastInput, null);
  assert.equal(latestPresence("chat").connection, chatConnection);
  pass("Home reconnect replaces only Home source and carries no old input");

  await pet.evaluate("document.querySelector('button[aria-label=\"关闭\"]').click()");
  await waitFor(() => exposure("taki-pet", inactive.seq, false), "closed Pet exposure withdrawal");
  await nativeWindow(pet, "pet", "hide"); await waitFor(() => latestPresence("pet")?.params.visible === false, "native Pet hide");
  pass("closing the bubble and hiding its native window withdraw exposure");
  for (let index = 0; index < 35; index += 1) fixture.append(`History ${index}: ${"bounded native reading text. ".repeat(12)}`);
  await waitFor(() => home.evaluate("document.querySelector('[aria-label=\"聊天记录\"]').scrollHeight > 1500"), "scrollable real history");
  await home.evaluate("(() => {const scroller=document.querySelector('[aria-label=\"聊天记录\"]');scroller.scrollTop=0;scroller.dispatchEvent(new Event('scroll'));const node=document.querySelector('[data-transcript-key] p');const range=document.createRange();range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range);window.c2SelectedNode=node;window.c2SelectedText=getSelection().toString();})()");
  await delay(300); const belowFold = fixture.append("C2 new message remains below the reading position"); await delay(2500);
  assert.equal(exposure("taki-chat", belowFold.seq), undefined);
  assert.equal(await home.evaluate("document.querySelector('[aria-label=\"聊天记录\"]').scrollTop"), 0);
  assert.equal(await home.evaluate("window.c2SelectedNode.isConnected && getSelection().toString() === window.c2SelectedText"), true);
  await screenshot(home, "reading-anchor");
  pass("offscreen new content gives no exposure and preserves the reader scroll/selection anchor");
} finally {
  await writeFile(join(artifacts, "evidence.json"), JSON.stringify({ checks, diagnostics, directory, limitation: "scripted server; fixture Pet opener; no renderer/model or proof of human reading", reports: fixture.state.reports, calls: fixture.state.calls, guiOutput }, null, 2));
  for (const session of sessions) session.close();
  if (gui?.exitCode === null) { gui.kill(); await Promise.race([once(gui, "exit"), delay(5000)]); }
  held.splice(0).forEach((send) => void send());
  await fixture.close(); assets.closeAllConnections(); await new Promise((done) => assets.close(done));
  console.log(`C2 evidence: ${artifacts}`);
}

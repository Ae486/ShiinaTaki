// Isolated actual Core/WS/SDK/Settings browser verification. Synthetic pixels, fake credentials, zero paid calls.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID, createHash } from "node:crypto";
import { join, resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../packages/core/src/db/migrations/index-list.ts";
import { createConfigRepo } from "../../../../packages/core/src/db/config-repo.ts";
import { connectCdp, waitFor, delay } from "../../../../apps/desktop/test/c2-native-driver.mjs";

const run = new Date().toISOString().replaceAll(":", "-");
const task = resolve(".trellis/tasks/11-02-native-multimodal-model-capabilities/research");
const evidenceDir = join(task, "runtime-ui-evidence", run);
const dataDir = join(evidenceDir, "core-data");
const desktop = resolve("apps/desktop");
const fixture = join(desktop, "target", `native-multimodal-ui-${run}`);
mkdirSync(dataDir, { recursive: true }); mkdirSync(fixture, { recursive: true });
const reports = []; const requests = []; const cacheUpdates = []; const pending = new Map();
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1kAAAAASUVORK5CYII=";
const primaryModel = "isolated-primary-native";
let rpcId = 0; let socket; let session; let edge; let html; let corePort; let coreStarted = false;
const provider = createServer(async (request, response) => {
  let body = ""; for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body);
  const parts = payload.messages.flatMap((message) => Array.isArray(message.content) ? message.content : []);
  const images = parts.filter((part) => part.type === "image_url");
  const text = payload.messages.flatMap((message) => typeof message.content === "string" ? [message.content]
    : message.content.filter((part) => part.type === "text").map((part) => part.text)).join("\n");
  requests.push({ path: request.url, model: payload.model, stream: payload.stream, imageParts: images.length,
    nativePixelsExact: images.every((part) => part.image_url.url === `data:image/png;base64,${png}`),
    base64AbsentFromText: !text.includes(png), roleSequence: payload.messages.map((message) => message.role),
    requestDigest: createHash("sha256").update(body).digest("hex") });
  const usage = { prompt_tokens: 200, completion_tokens: 4, total_tokens: 204, prompt_tokens_details: { cached_tokens: 80 } };
  if (payload.stream) {
    response.setHeader("content-type", "text/event-stream");
    response.end(`data: ${JSON.stringify({ id: "isolated-fixture", object: "chat.completion.chunk", created: 0,
      model: primaryModel, choices: [{ index: 0, delta: { role: "assistant", content: "Synthetic image received." }, finish_reason: "stop" }], usage })}\n\ndata: [DONE]\n\n`);
  } else {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: "isolated-fixture", object: "chat.completion", created: 0, model: primaryModel,
      choices: [{ index: 0, message: { role: "assistant", content: "Synthetic maintenance evidence." }, finish_reason: "stop" }], usage }));
  }
});

async function listen(server) { await new Promise((done) => server.listen(0, "127.0.0.1", done)); return server.address().port; }
async function unusedPort() { const candidate = createServer(); const port = await listen(candidate); await new Promise((done) => candidate.close(done)); return port; }
function rpc(method, params = {}) {
  return new Promise((resolveCall, reject) => {
    const id = ++rpcId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout ${method}`)); }, 25_000);
    pending.set(id, { resolve: resolveCall, reject, timer }); socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}
function record(name, details) {
  reports.push({ name, ...details });
  console.log(JSON.stringify({ stage: name, artifact: details.artifact, model: details.model,
    nativeImageParts: details.nativeImageParts, message: details.message }));
}
async function screenshot(name, predicate) {
  await waitFor(() => session.evaluate(predicate), name, 30_000);
  await session.evaluate(`document.querySelector('[aria-label="主模型信息"]')?.scrollIntoView({block:'center'})`);
  const state = await session.evaluate(`({text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth,
    width:innerWidth,capabilityReads:window.__capabilityReads,model:document.querySelector('[aria-label="TAKI_PROVIDER_MODEL"]')?.value,
    baseURL:document.querySelector('[aria-label="TAKI_PROVIDER_BASE_URL"]')?.value,
    logos:[...document.querySelectorAll('[aria-label="主模型信息"] img')].map(i=>({src:i.src,loaded:i.complete&&i.naturalWidth>0})),
    cspViolations:window.__cspViolations??[]})`);
  assert.equal(state.overflow, false, `Horizontal overflow in ${name}`);
  const image = await session.call("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(evidenceDir, `${name}.png`), Buffer.from(image.data, "base64"));
  record(name, { state, artifact: `${name}.png` }); return state;
}
async function edit(key, value) {
  await session.evaluate(`(() => {const input=document.querySelector('[aria-label="${key}"]');input.scrollIntoView({block:'center'});input.focus();input.select();})()`);
  await session.call("Input.insertText", { text: value });
  await session.evaluate(`document.querySelector('[aria-label="${key}"]').blur()`);
  await waitFor(async () => (await rpc("config.list")).entries.find((entry) => entry.key === key)?.value === value,
    `Saved ${key}`);
}
async function chat() {
  const start = requests.length;
  const accepted = await rpc("chat.send", { characterId: "taki", message: "Inspect this synthetic pixel.",
    attachments: [{ mediaType: "image/png", dataBase64: png }] });
  const settled = await waitFor(async () => { const state = await rpc("run.status", { runId: accepted.runId });
    return ["completed", "failed", "cancelled"].includes(state.run.state) ? state : null; }, "Chat settlement");
  assert.equal(settled.run.state, "completed");
  const actual = requests.slice(start).filter((request) => request.stream);
  assert.equal(actual.length, 1); assert.equal(actual[0].model, primaryModel); assert.equal(actual[0].imageParts > 0, true);
  assert.equal(actual[0].nativePixelsExact, true); assert.equal(actual[0].base64AbsentFromText, true);
  return { runId: accepted.runId, model: actual[0].model, nativeImageParts: actual[0].imageParts };
}

try {
  const providerPort = await listen(provider); corePort = await unusedPort();
  const initial = openDatabase({ path: join(dataDir, "taki.db"), migrations: MIGRATIONS });
  const config = createConfigRepo(initial);
  config.upsert("TAKI_PROVIDER_BASE_URL", `http://127.0.0.1:${providerPort}/v1`);
  config.upsert("TAKI_PROVIDER_MODEL", primaryModel);
  config.upsert("TAKI_PROVIDER_INCLUDE_USAGE", true);
  config.upsert("TAKI_MONITOR_MODE", "FULL_LOCAL");
  initial.close();
  for (const key of Object.keys(process.env)) if (key.startsWith("TAKI_") || key.startsWith("HINDSIGHT_") || key === "CREDENTIALS_DIRECTORY") delete process.env[key];
  Object.assign(process.env, { TAKI_DATA_DIR: dataDir, TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(corePort),
    TAKI_PROVIDER_API_KEY: "synthetic-fixture-key", TAKI_LOG_LEVEL: "error", TAKI_TRUST_LOOPBACK_OPERATOR: "true" });
  await import(pathToFileURL(resolve("packages/core/src/main.ts")).href);
  coreStarted = true;
  socket = new WebSocket(`ws://127.0.0.1:${corePort}`); await once(socket, "open");
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data); const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result); }
    if (message.method === "observability.cacheUsageChanged") cacheUpdates.push(message.params);
  });
  await rpc("connect", { deviceId: randomUUID(), deviceName: "Native runtime UI verification", role: "operator", capabilities: [] });
  const entries = (await rpc("config.list")).entries;
  assert.equal(entries.some((entry) => entry.key.includes("VLM")), false);
  const capability = await rpc("config.modelCapabilities");
  assert.equal(capability.apply, "restart"); assert.equal(capability.adapter.nativeWebSearch, false);
  await rpc("observability.cacheUsageSubscribe", { characterId: "taki" });
  record("actual-core-boot", { node: process.version, stripOnly: true, configEntries: entries.length,
    obsoleteVlmAbsent: true, capability, dataDir: dataDir.replaceAll("\\", "/") });
  record("native-chat-before-config-edit", await chat());
  await waitFor(() => cacheUpdates.some((update) => update.snapshot.pairedRequests >= 1 && update.snapshot.ratio === 0.4), "Normal usage/cache notification");
  const requireDesktop = createRequire(join(desktop, "package.json"));
  const { build } = await import(pathToFileURL(requireDesktop.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(requireDesktop.resolve("@vitejs/plugin-react")).href);
  const { default: tailwind } = await import(pathToFileURL(requireDesktop.resolve("@tailwindcss/vite")).href);
  writeFileSync(join(fixture, "index.html"), '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>');
  writeFileSync(join(fixture, "qa.css"), '@import "../../src/styles.css";\n@source "../../src";\nhtml,body,#root{height:100%;margin:0}#root{display:flex}\n');
  writeFileSync(join(fixture, "main.tsx"), `import React from 'react';import {createRoot} from 'react-dom/client';
import {SettingsPage} from '../../src/windows/home/pages/settings/settings-page.tsx';
import {HomeClientContext} from '../../src/windows/home/home-client-context.ts';
import {usePageVisibilityStore} from '../../src/windows/home/page-visibility-store.ts';
import {createWsClient} from '../../src/lib/ws-client.ts';import {createBrowserTransport} from '../../src/lib/ws-transport.ts';
import {TIMING_POLICY_DEVELOPMENT_DEFAULTS} from '@taki/shared';import './qa.css';
usePageVisibilityStore.setState({activePage:'settings',documentVisible:true});
const client=createWsClient({transport:createBrowserTransport('ws://127.0.0.1:${corePort}')});
window.__capabilityReads=0;const read=client.configModelCapabilities.bind(client);client.configModelCapabilities=()=>{window.__capabilityReads++;return read();};
window.__cspViolations=[];document.addEventListener('securitypolicyviolation',e=>window.__cspViolations.push({directive:e.effectiveDirective,blocked:e.blockedURI}));
await client.connect({deviceId:crypto.randomUUID(),deviceName:'Native Settings browser verification',role:'operator',capabilities:[]});
createRoot(document.getElementById('root')).render(<HomeClientContext value={{client,status:{kind:'connected'},currentTimingPolicy:()=>TIMING_POLICY_DEVELOPMENT_DEFAULTS}}><main className="flex h-full min-w-0 flex-1 flex-col"><SettingsPage/></main></HomeClientContext>);
window.__visible=value=>usePageVisibilityStore.setState({documentVisible:value});window.__close=()=>client.close();window.__ready=true;`);
  await build({ configFile: false, root: fixture, plugins: [react(), tailwind()], logLevel: "warn",
    resolve: { alias: { "@": join(desktop, "src") } }, build: { target: "esnext", outDir: join(fixture, "dist"), emptyOutDir: true } });
  const packagedCsp = JSON.parse(readFileSync(join(desktop, "src-tauri/tauri.conf.json"), "utf8")).app.security.csp;
  assert.ok(packagedCsp["img-src"].split(" ").includes("https://models.dev"));
  // Only adapt the loopback test port. All image/script/style restrictions are the actual packaged policy.
  const csp = Object.entries(packagedCsp).map(([key, value]) => `${key} ${key === "connect-src"
    ? value.replaceAll(":8974", `:${corePort}`) : value}`).join("; ");
  html = createServer((request, response) => {
    response.setHeader("content-security-policy", csp);
    const name = request.url === "/" ? "index.html" : new URL(request.url, "http://localhost").pathname.slice(1);
    try { response.setHeader("content-type", { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[extname(name)] ?? "application/octet-stream"); response.end(readFileSync(join(fixture, "dist", name))); }
    catch { response.statusCode = 404; response.end(); }
  });
  const htmlPort = await listen(html); const cdpPort = await unusedPort();
  edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", "--disable-gpu", "--no-first-run",
    `--remote-debugging-port=${cdpPort}`, "--remote-allow-origins=*", `--user-data-dir=${join(evidenceDir, "edge-profile")}`,
    `http://127.0.0.1:${htmlPort}/`], { windowsHide: true, stdio: "ignore" });
  const pages = await waitFor(async () => { const response = await fetch(`http://127.0.0.1:${cdpPort}/json`); return response.ok ? response.json() : null; }, "Edge CDP");
  session = await connectCdp(pages.find((page) => page.type === "page"));
  await session.call("Emulation.setDeviceMetricsOverride", { width: 1100, height: 780, deviceScaleFactor: 1, mobile: false });
  await screenshot("settings-initial-custom-endpoint", "window.__ready && document.querySelector('[aria-label=\"主模型信息\"]') && !document.body.innerText.includes('正在读取能力声明')");
  await edit("TAKI_PROVIDER_BASE_URL", "https://api.deepseek.com"); await edit("TAKI_PROVIDER_MODEL", "deepseek-v4-flash");
  const declared = await rpc("config.modelCapabilities");
  assert.equal(declared.catalog.status, "declared", "Public catalog must provide the tested declaration");
  assert.ok(declared.catalog.metadata?.displayName);
  assert.ok(declared.catalog.metadata?.canonicalModelId);
  const known = await screenshot("settings-declared", "document.querySelector('[aria-label=\"主模型信息\"]')?.innerText.includes('DeepSeek') && document.body.innerText.includes('目录声明支持')");
  await waitFor(() => session.evaluate("[...document.querySelectorAll('[aria-label=\"主模型信息\"] img')].some(i=>i.complete&&i.naturalWidth>0)"), "Actual provider SVG under packaged CSP");
  await session.evaluate("for(const item of document.querySelectorAll('[aria-label=\"主模型信息\"] details'))item.open=true");
  await screenshot("settings-metadata-details", "document.querySelector('[aria-label=\"主模型信息\"]')?.innerText.includes('deepseek/deepseek')");
  await edit("TAKI_PROVIDER_MODEL", "deepseek-flash");
  const alias = await rpc("config.modelCapabilities");
  assert.equal(alias.catalog.status, "declared");
  assert.equal(alias.catalog.metadata.canonicalModelId, declared.catalog.metadata.canonicalModelId);
  await screenshot("settings-known-alias", "document.querySelector('[aria-label=\"主模型信息\"]')?.innerText.includes('deepseek-flash') && !document.body.innerText.includes('正在读取能力声明')");
  await session.call("Network.enable");
  await session.call("Network.setBlockedURLs", { urls: ["https://models.dev/*"] });
  await session.evaluate("document.querySelector('[aria-label=\"主模型信息\"] img').src+='?qa-blocked=1'");
  await screenshot("settings-logo-fallback", "document.querySelector('[aria-label=\"主模型信息\"]') && !document.querySelector('[aria-label=\"主模型信息\"] img')");
  await session.call("Network.setBlockedURLs", { urls: [] });
  // Zod's existing allowsEval probe catches its CSP rejection and uses the non-JIT parser.
  // A denied image or any other blocked resource still fails this icon integration check.
  assert.ok(known.cspViolations.every((entry) => entry.directive === "script-src" && entry.blocked === "eval"));
  record("packaged-csp", { imageViolations: 0, caughtEvalProbe: known.cspViolations.length,
    note: "Existing Zod allowsEval feature probe is blocked/caught; no CSP directive was weakened for it." });
  record("native-chat-after-config-edit", await chat());
  await edit("TAKI_PROVIDER_MODEL", "native-fixture-unknown-model");
  const unknown = await rpc("config.modelCapabilities");
  await screenshot("settings-unknown-model", "document.querySelector('[aria-label=\"主模型信息\"]')?.innerText.includes('native-fixture-unknown-model') && !document.body.innerText.includes('正在读取能力声明')");
  const reads = await session.evaluate("window.__capabilityReads");
  await session.evaluate("window.__visible(false)"); await delay(100); await session.evaluate("window.__visible(true)");
  await screenshot("settings-refresh-reentry", `window.__capabilityReads>${reads} && !document.body.innerText.includes('正在读取能力声明')`);
  await session.call("Emulation.setDeviceMetricsOverride", { width: 620, height: 780, deviceScaleFactor: 1, mobile: false });
  await screenshot("settings-narrow", "Boolean(window.__ready && document.querySelector('[aria-label=\"主模型信息\"]'))");
  await edit("TAKI_PROVIDER_MODEL", "deepseek-flash");
  await screenshot("settings-known-narrow", "document.querySelector('[aria-label=\"主模型信息\"]')?.innerText.includes('DeepSeek') && !document.body.innerText.includes('正在读取能力声明')");
  record("configured-versus-running", { declared, alias, unknown, configuredModel: unknown.configured.model, packagedCsp,
    runningProviderRequests: requests.map((request) => ({ model: request.model, imageParts: request.imageParts })),
    cacheUpdates: cacheUpdates.map((update) => update.snapshot), paidCalls: 0 });
} catch (error) {
  record("failure", { message: error instanceof Error ? error.message : String(error), coreStarted });
  process.exitCode = 1;
} finally {
  if (session) { await session.evaluate("window.__close?.()").catch(() => {}); await session.call("Browser.close").catch(() => {}); session.close(); }
  if (edge && edge.exitCode === null) { edge.kill(); await Promise.race([once(edge, "exit"), delay(2000)]); }
  socket?.close(); for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error("Verification shutdown")); } pending.clear();
  if (html) await new Promise((done) => html.close(done));
  if (coreStarted) {
    process.emit("SIGTERM");
    await waitFor(async () => { try { await fetch(`http://127.0.0.1:${corePort}`); return false; } catch { return true; } }, "Owned Core WS server stopped", 8000);
    record("cleanup", { coreWsClosed: true, edgeClosed: edge?.exitCode !== null || edge?.signalCode !== null,
      edgeExitCode: edge?.exitCode, edgeSignal: edge?.signalCode });
    const audit = openDatabase({ path: join(dataDir, "taki.db"), migrations: MIGRATIONS });
    record("durable-usage", { rows: audit.prepare("SELECT input_tokens,output_tokens,cache_read_tokens,cache_read_observed FROM run_usage").all(),
      auxiliaryRequests: audit.prepare("SELECT COUNT(*) AS n FROM auxiliary_model_calls").get()?.n });
    audit.close();
  }
  provider.closeAllConnections(); await new Promise((done) => provider.close(done));
  writeFileSync(join(evidenceDir, "evidence.json"), JSON.stringify({ reports, requests, paidCalls: 0, liveDataWrites: false,
    browserIsTauriAcceptance: false, fixture, command: "node --experimental-strip-types .trellis/tasks/11-02-native-multimodal-model-capabilities/research/verify-runtime-ui.mjs" }, null, 2));
  console.log(JSON.stringify({ passed: process.exitCode !== 1, evidenceDir, scenarios: reports.length, paidCalls: 0 }));
}

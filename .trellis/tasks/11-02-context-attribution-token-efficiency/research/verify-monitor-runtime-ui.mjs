// Actual isolated Core/SDK/WS -> production Monitor aggregate hook/components in Edge.
// Synthetic provider, pixels and test-only DB; no paid model calls or live user service.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { join, resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../packages/core/src/db/migrations/index-list.ts";
import { createConfigRepo } from "../../../../packages/core/src/db/config-repo.ts";
import { connectCdp, waitFor, delay } from "../../../../apps/desktop/test/c2-native-driver.mjs";

assert.equal(resolve(".").replaceAll("\\", "/").toLowerCase(), "h:/takiagent-worktrees/t4");
const run = new Date().toISOString().replaceAll(":", "-");
const research = resolve(".trellis/tasks/11-02-context-attribution-token-efficiency/research");
const evidenceDir = join(research, "monitor-runtime-ui-evidence", run);
const dataDir = join(evidenceDir, "core-data");
const desktop = resolve("apps/desktop");
const fixture = join(desktop, "target", `context-monitor-ui-${run}`);
mkdirSync(dataDir, { recursive: true }); mkdirSync(fixture, { recursive: true });
const reports = []; const requests = []; const updates = []; const pending = new Map();
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1kAAAAASUVORK5CYII=";
const primaryModel = "isolated-context-primary";
const responseModel = "isolated-context-response";
let rpcId = 0; let socket; let session; let edge; let html; let corePort; let coreStarted = false; let nextToolLoop = false;
const provider = createServer(async (request, response) => {
  let body = ""; for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body);
  const parts = payload.messages.flatMap((message) => Array.isArray(message.content) ? message.content : []);
  const imageParts = parts.filter((part) => part.type === "image_url");
  const tools = payload.tools?.map((entry) => entry.function.name) ?? [];
  const terminalToolResult = payload.messages.at(-1)?.role === "tool";
  const toolCall = nextToolLoop && !terminalToolResult && tools.includes("extension_discover");
  if (toolCall) nextToolLoop = false;
  const input = (requests.filter((entry) => entry.stream).length + 1) * 200;
  requests.push({ model: payload.model, stream: payload.stream, imageParts: imageParts.length, offeredTools: tools,
    nativePixelsExact: imageParts.every((part) => part.image_url.url === `data:image/png;base64,${png}`),
    roles: payload.messages.map((message) => message.role), toolCall, reportedInput: input });
  const usage = { prompt_tokens: input, completion_tokens: 4, total_tokens: input + 4, prompt_tokens_details: { cached_tokens: input * 0.4 } };
  const tool = { index: 0, id: "isolated-discovery", type: "function", function: { name: "extension_discover", arguments: '{"query":"synthetic-no-match","limit":1}' } };
  if (payload.stream) {
    response.setHeader("content-type", "text/event-stream");
    response.end(`data: ${JSON.stringify({ id: "isolated-fixture", object: "chat.completion.chunk", created: 0,
      model: responseModel, choices: [{ index: 0, delta: toolCall ? { role: "assistant", tool_calls: [tool] }
        : { role: "assistant", content: "Synthetic context verified." }, finish_reason: toolCall ? "tool_calls" : "stop" }], usage })}\n\ndata: [DONE]\n\n`);
  } else {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: "isolated-fixture", object: "chat.completion", created: 0, model: responseModel,
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
function record(name, details = {}) { reports.push({ name, ...details }); console.log(JSON.stringify({ stage: name, artifact: details.artifact, message: details.message })); }
async function screenshot(name, predicate, source = "actual Core/WS") {
  await waitFor(() => session.evaluate(predicate), name, 30_000);
  const state = await session.evaluate(`({text:document.body.innerText,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,
    phase:window.__view?.phase,snapshot:window.__view,reads:window.__reads,
    stripHeight:document.querySelector('[aria-label="latest request monitor QA"]')?.getBoundingClientRect().height})`);
  assert.equal(state.overflow, false, `Horizontal overflow in ${name}`);
  assert.equal(state.text.includes("effectId"), false); assert.equal(state.text.includes("primaryInputSeq"), false);
  const image = await session.call("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(evidenceDir, `${name}.png`), Buffer.from(image.data, "base64"));
  record(name, { state, artifact: `${name}.png`, source }); return state;
}
async function chat(toolLoop = false) {
  nextToolLoop = toolLoop;
  const start = requests.length;
  const accepted = await rpc("chat.send", { characterId: "taki", message: toolLoop ? "Use bounded discovery then respond." : "Inspect this synthetic pixel.",
    attachments: [{ mediaType: "image/png", dataBase64: png }] });
  const settled = await waitFor(async () => { const state = await rpc("run.status", { runId: accepted.runId });
    return ["completed", "failed", "cancelled"].includes(state.run.state) ? state : null; }, "Chat settlement");
  assert.equal(settled.run.state, "completed");
  const actual = requests.slice(start).filter((entry) => entry.stream);
  assert.equal(actual.length, toolLoop ? 2 : 1); assert.equal(actual.every((entry) => entry.model === primaryModel), true);
  assert.equal(actual.every((entry) => entry.imageParts > 0 && entry.nativePixelsExact), true);
  await waitFor(() => updates.some((update) => update.latestPrimaryRequest?.request?.runId === accepted.runId
    && update.latestPrimaryRequest.request.inputTokens === actual.at(-1).reportedInput), "Exact latest request update");
  const latest = updates.filter((update) => update.latestPrimaryRequest?.request?.runId === accepted.runId).at(-1);
  assert.equal(latest.snapshot.ratio, 0.4); assert.ok(latest.latestPrimaryRequest.request.composition);
  assert.equal(latest.latestPrimaryRequest.request.modelId, primaryModel);
  assert.equal(latest.latestPrimaryRequest.request.responseModelId, responseModel);
  // These fresh inputs and offered tools are constructed by known Core owners; legacy unknowns are not backfilled.
  const measured = latest.latestPrimaryRequest.request.composition;
  assert.equal(measured.coverage.unknownOriginUnits, 0, "Fresh construction must retain its known content suppliers");
  assert.equal(measured.coverage.unestimatedParts, 0, "All fixture parts must be measured");
  assert.ok(measured.categories.persona > 0, "The actual fallback persona must retain its category");
  if (toolLoop) assert.ok(measured.categories.tool_interactions > 0, "The completed discovery result belongs to tool interactions");
  assert.ok(latest.latestPrimaryRequest.request.window); assert.equal(latest.latestPrimaryRequest.request.stepNumber, toolLoop ? 1 : 0);
  return { runId: accepted.runId, requests: actual.length, latest };
}

try {
  const providerPort = await listen(provider); corePort = await unusedPort();
  const initial = openDatabase({ path: join(dataDir, "taki.db"), migrations: MIGRATIONS });
  const config = createConfigRepo(initial);
  config.upsert("TAKI_PROVIDER_BASE_URL", `http://127.0.0.1:${providerPort}/v1`);
  config.upsert("TAKI_PROVIDER_MODEL", primaryModel); config.upsert("TAKI_PROVIDER_INCLUDE_USAGE", true);
  config.upsert("TAKI_MONITOR_MODE", "FULL_LOCAL"); initial.close();
  for (const key of Object.keys(process.env)) if (key.startsWith("TAKI_") || key.startsWith("HINDSIGHT_") || key === "CREDENTIALS_DIRECTORY") delete process.env[key];
  Object.assign(process.env, { TAKI_DATA_DIR: dataDir, TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(corePort),
    TAKI_PROVIDER_API_KEY: "synthetic-fixture-key", TAKI_LOG_LEVEL: "error", TAKI_TRUST_LOOPBACK_OPERATOR: "true" });
  await import(pathToFileURL(resolve("packages/core/src/main.ts")).href); coreStarted = true;
  socket = new WebSocket(`ws://127.0.0.1:${corePort}`); await once(socket, "open");
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data); const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result); }
    if (message.method === "observability.cacheUsageChanged") updates.push(message.params);
  });
  await rpc("connect", { deviceId: randomUUID(), deviceName: "Context Monitor verification", role: "operator", capabilities: [] });
  const empty = await rpc("observability.cacheUsageSubscribe", { characterId: "taki" });
  assert.equal(empty.latestPrimaryRequest.status, "empty"); record("actual-core-empty", { node: process.version, snapshot: empty });
  const requireDesktop = createRequire(join(desktop, "package.json"));
  const { build } = await import(pathToFileURL(requireDesktop.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(requireDesktop.resolve("@vitejs/plugin-react")).href);
  const { default: tailwind } = await import(pathToFileURL(requireDesktop.resolve("@tailwindcss/vite")).href);
  writeFileSync(join(fixture, "index.html"), '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>');
  writeFileSync(join(fixture, "qa.css"), '@import "../../src/styles.css";\n@source "../../src";\nhtml,body,#root{height:100%;margin:0}#root{display:flex} .qa-title{padding:10px;font-weight:600}.qa-note{padding:12px;color:var(--color-text-secondary)}\n');
  writeFileSync(join(fixture, "main.tsx"), `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {HomeClientContext} from '../../src/windows/home/home-client-context.ts';
import {usePageVisibilityStore} from '../../src/windows/home/page-visibility-store.ts';
import {createWsClient} from '../../src/lib/ws-client.ts';import {createBrowserTransport} from '../../src/lib/ws-transport.ts';
import {useCacheUsage} from '../../src/windows/home/pages/monitor/use-cache-usage.ts';
import {CacheUsageStrip} from '../../src/windows/home/pages/monitor/cache-usage-strip.tsx';
import css from '../../src/windows/home/pages/monitor/monitor-workspace.module.css';
import {TIMING_POLICY_DEVELOPMENT_DEFAULTS} from '@taki/shared';import './qa.css';
usePageVisibilityStore.setState({activePage:'monitor',documentVisible:true});window.__reads=0;
async function open(){const candidate=createWsClient({transport:createBrowserTransport('ws://127.0.0.1:${corePort}')});
const read=candidate.subscribeCacheUsage.bind(candidate);candidate.subscribeCacheUsage=params=>{window.__reads++;return read(params);};
await candidate.connect({deviceId:crypto.randomUUID(),deviceName:'Context Monitor browser',role:'operator',capabilities:[]});return candidate;}
function Viewer(){const aggregate=useCacheUsage('FULL_LOCAL');const [mock,setMock]=useState(null);window.__view=aggregate.view;window.__inject=setMock;
return <section className={css.root} aria-label="latest request monitor QA"><div className="qa-title">运行监视 · 请求用量</div>
<CacheUsageStrip {...aggregate} view={mock??aggregate.view}/><p className="qa-note">隔离运行验证 · 本地合成提供方 · 未调用付费模型</p></section>;}
function App(){const [client,setClient]=useState(null);window.__reconnect=async()=>{client?.close();setClient(null);await new Promise(done=>setTimeout(done,300));setClient(await open());};
window.__close=()=>{client?.close();setClient(null);};window.__open=async()=>setClient(await open());
return <HomeClientContext value={{client,status:{kind:client?'connected':'reconnecting'},currentTimingPolicy:()=>TIMING_POLICY_DEVELOPMENT_DEFAULTS}}><Viewer/></HomeClientContext>;}
createRoot(document.getElementById('root')).render(<App/>);
window.__visible=value=>usePageVisibilityStore.setState({documentVisible:value});window.__ready=true;`);
  await build({ configFile: false, root: fixture, plugins: [react(), tailwind()], logLevel: "warn",
    resolve: { alias: { "@": join(desktop, "src") } }, build: { target: "esnext", outDir: join(fixture, "dist"), emptyOutDir: true } });
  html = createServer((request, response) => {
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
  await session.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 780, deviceScaleFactor: 1, mobile: false });
  await screenshot("monitor-cold-connection", "window.__ready && document.body.innerText.includes('等待连接恢复')");
  await session.evaluate("window.__open()");
  await screenshot("monitor-empty", "window.__view?.phase==='live' && document.body.innerText.includes('暂无已完成的主对话请求')");
  const first = await chat(); record("actual-native-first", first);
  await screenshot("monitor-first-request-wide", "window.__view?.latestPrimaryRequest?.request?.inputTokens===200 && document.body.innerText.includes('估算比例')");
  const second = await chat(true); record("actual-native-tool-loop", second);
  await screenshot("monitor-tool-loop-wide", "window.__view?.latestPrimaryRequest?.request?.inputTokens===600 && document.body.innerText.includes('循环第 2 步') && document.body.innerText.includes('内容已归类') && !document.body.innerText.includes('覆盖不完整')");
  await session.evaluate(`for(const node of document.querySelectorAll('details'))node.open=true`);
  await screenshot("monitor-explanations-wide", "document.body.innerText.includes('独立来源维度')");
  await session.evaluate(`for(const node of document.querySelectorAll('details'))node.open=false`);
  const before = await session.evaluate("window.__reads");
  await session.evaluate("window.__visible(false)"); await delay(150); await session.evaluate("window.__visible(true)");
  await screenshot("monitor-reentry", `window.__view?.phase==='live' && window.__reads>${before} && window.__view?.latestPrimaryRequest?.request?.inputTokens===600`);
  await session.evaluate("window.__close()");
  await screenshot("monitor-disconnected-stale", "window.__view?.phase==='stale' && document.body.innerText.includes('上次结果 · 等待恢复')");
  await session.evaluate("window.__open()");
  await screenshot("monitor-reconnected", "window.__view?.phase==='live' && window.__view?.latestPrimaryRequest?.request?.inputTokens===600");
  await session.call("Emulation.setDeviceMetricsOverride", { width: 420, height: 780, deviceScaleFactor: 1, mobile: false });
  await screenshot("monitor-narrow", "window.__view?.phase==='live' && document.body.innerText.includes('循环第 2 步')");
  await session.evaluate(`window.__inject({phase:'loading',snapshot:null,latestPrimaryRequest:null,error:null})`);
  await screenshot("monitor-fixture-loading", "document.body.innerText.includes('正在读取请求统计')", "synthetic cold-read display state");
  await session.evaluate(`(()=>{const copy=structuredClone(window.__view);copy.latestPrimaryRequest.request.inputTokens=0;window.__inject(copy);})()`);
  await screenshot("monitor-fixture-zero", "document.body.innerText.includes('0.0%')", "synthetic reported-zero display override");
  await session.evaluate(`(()=>{const copy=structuredClone(window.__view);copy.latestPrimaryRequest.request.inputTokens=null;copy.latestPrimaryRequest.reason='usage-missing';copy.latestPrimaryRequest.status='partial';window.__inject(copy);})()`);
  await screenshot("monitor-fixture-estimate-only", "document.body.innerText.includes('估算输入 / 估算窗口')", "synthetic display override of actual captured snapshot");
  await session.evaluate(`(()=>{const copy=structuredClone(window.__view);copy.latestPrimaryRequest={scope:'latest-primary-request',characterId:'taki',computedAt:new Date().toISOString(),status:'unavailable',reason:'read-failed',request:null};window.__inject(copy);})()`);
  await screenshot("monitor-fixture-unavailable", "document.body.innerText.includes('请求统计读取失败')", "synthetic display override of actual captured snapshot");
  record("synthetic-provider-summary", { requests: requests.length, primaryRequests: requests.filter((entry) => entry.stream).length,
    exactEffectsDistinct: new Set(updates.map((update) => update.latestPrimaryRequest?.request?.effectId).filter(Boolean)).size,
    paidCalls: 0, liveDataWrites: false, browserIsTauriAcceptance: false });
} catch (error) { record("failure", { message: error instanceof Error ? error.message : String(error), coreStarted }); process.exitCode = 1; }
finally {
  if (session) { await session.evaluate("window.__close?.()").catch(() => {}); await session.call("Browser.close").catch(() => {}); session.close(); }
  if (edge && edge.exitCode === null) { edge.kill(); await Promise.race([once(edge, "exit"), delay(2000)]); }
  socket?.close(); for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error("Verification shutdown")); } pending.clear();
  if (html) await new Promise((done) => html.close(done));
  if (coreStarted) {
    process.emit("SIGTERM");
    await waitFor(async () => { try { await fetch(`http://127.0.0.1:${corePort}`); return false; } catch { return true; } }, "Owned Core WS server stopped", 8000);
    const audit = openDatabase({ path: join(dataDir, "taki.db"), migrations: MIGRATIONS });
    record("durable-usage", { rows: audit.prepare("SELECT model_id,input_tokens,output_tokens,cache_read_tokens,cache_read_observed FROM run_usage").all(),
      measuredRequests: audit.prepare("SELECT COUNT(*) AS n FROM run_events WHERE kind='context.request.measured'").get()?.n }); audit.close();
    record("cleanup", { coreWsClosed: true, edgeClosed: edge?.exitCode !== null || edge?.signalCode !== null });
  }
  provider.closeAllConnections(); await new Promise((done) => provider.close(done));
  writeFileSync(join(evidenceDir, "evidence.json"), JSON.stringify({ reports, requests, updates, paidCalls: 0, liveDataWrites: false,
    browserIsTauriAcceptance: false, fixture, command: "node --experimental-strip-types .trellis/tasks/11-02-context-attribution-token-efficiency/research/verify-monitor-runtime-ui.mjs" }, null, 2));
  console.log(JSON.stringify({ passed: process.exitCode !== 1, evidenceDir, scenarios: reports.length, paidCalls: 0 }));
}

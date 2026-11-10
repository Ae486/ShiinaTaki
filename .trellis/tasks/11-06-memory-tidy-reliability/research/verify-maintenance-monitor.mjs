/** Isolated schema migration, actual Core main/WS and production MonitorPage browser acceptance. No paid model. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../packages/core/src/db/migrations/index-list.ts";
import { createConfigRepo } from "../../../../packages/core/src/db/config-repo.ts";
import { createMemoryOperationRepo } from "../../../../packages/core/src/db/memory-operation-repo.ts";
import { createCompactionOperationRepo } from "../../../../packages/core/src/db/compaction-operation-repo.ts";
import { createAuxiliaryUsageRepo } from "../../../../packages/core/src/db/auxiliary-usage-repo.ts";
import { createCacheUsageRepo } from "../../../../packages/core/src/db/cache-usage-repo.ts";
import { unknownAuxiliaryUsage } from "../../../../packages/core/src/observability/auxiliary-usage-normalization.ts";
import { connectCdp, waitFor, trustedClick } from "../../../../apps/desktop/test/c2-native-driver.mjs";

const root = resolve(`target/maintenance-monitor-${Date.now()}`);
const desktop = resolve("apps/desktop");
const fixture = join(desktop, "target", `maintenance-ui-${Date.now()}`);
mkdirSync(root, { recursive: true }); mkdirSync(fixture, { recursive: true });
const dbPath = join(root, "taki.db");
let db = openDatabase({ path: dbPath, migrations: MIGRATIONS.filter((migration) => migration.version <= 67) });
createConfigRepo(db).upsert("TAKI_MONITOR_MODE", "FULL_LOCAL");
const at = "2026-11-06T01:00:00.000Z"; const finish = "2026-11-06T01:02:00.000Z";
const operationId = randomUUID();
let operationAt = at;
const memory = createMemoryOperationRepo(db, () => operationAt);
memory.insertAdmitted({ operationId, kind: "tidy", family: "tidy", authorityEpochId: null, bootId: "fixture",
  request: { kind: "tidy", characterId: "taki" }, producer: { kind: "tidy", characterId: "taki", authorityEpochId: null,
    progress: { edits: 12, steps: 8, reviewed: 100, remaining: 34 } } });
operationAt = finish;
memory.transition({ operationId, expectedState: "admitted", patch: { state: "failed", result: { kind: "tidy", outcome: {
  status: "partial", reason: "timeout", nextAction: "retry", edits: 12, steps: 8, reviewed: 100, remaining: 34,
  defects: { missingDisclosure: 0, overBudget: 0, stale: 0, nearDuplicate: 0, misfiled: 0 },
  usage: { calls: 9999, inputTokens: 999_999, outputTokens: 999_999, usageUnknown: 0 } } } } });
const compactions = createCompactionOperationRepo(db);
const start = compactions.begin({ operationId: "compact:synthetic", characterId: "taki", reason: "pressure",
  selectedFromSeq: 1, selectedThroughSeq: 6, capturedTailSeq: 10, expectedSummaryRevision: 0, expectedSummaryThrough: 0,
  sourceDigest: "a".repeat(64), beforeTokens: 2000, provider: "fixture", modelId: "fixture-model", owner: "fixture",
  now: at, expiresAt: "2026-11-06T01:10:00.000Z" });
assert.equal(start.status, "started");
compactions.fail({ lease: start.lease, code: "SUMMARY_GENERATION_FAILED", now: finish });
const before = db.prepare("SELECT * FROM memory_operations").all(); db.close();
db = openDatabase({ path: dbPath, migrations: MIGRATIONS.filter((migration) => migration.version <= 68) });
assert.equal(db.prepare("SELECT MAX(version) AS v FROM migrations").get().v, 68);
assert.deepEqual(db.prepare("SELECT * FROM memory_operations").all(), before);
const auxiliary = createAuxiliaryUsageRepo(db);
for (const label of ["episodic", "tidy", "compact"]) {
  const callId = randomUUID();
  const operation = label === "episodic" ? undefined : { kind: label, characterId: "taki",
    operationId: label === "tidy" ? operationId : "compact:synthetic" };
  auxiliary.start({ callId, taskId: null, source: "utility", label, provider: "fixture", modelId: "fixture-model", startedAt: at,
    ...(operation ? { operation } : {}) });
  auxiliary.settle({ callId, status: label === "compact" ? "failed" : "completed", finishedAt: finish, responseId: null,
    usage: { ...unknownAuxiliaryUsage(), inputTokens: label === "episodic" ? 100 : 20_000,
      cacheReadTokens: label === "episodic" ? 50 : 18_000, outputTokens: 300 } });
}
assert.equal(createCacheUsageRepo(db).read("taki").ratio, 0.5); db.close();

const probe = createServer(); await new Promise((done) => probe.listen(0, "127.0.0.1", done));
const port = probe.address().port; await new Promise((done) => probe.close(done));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("TAKI_")));
const core = spawn(process.execPath, ["packages/core/src/main.ts"], { cwd: resolve("."), windowsHide: true,
  env: { ...env, TAKI_DATA_DIR: root, TAKI_WS_PORT: String(port), TAKI_WS_HOST: "127.0.0.1", TAKI_TRUST_LOOPBACK_OPERATOR: "true",
    TAKI_PROVIDER_BASE_URL: "http://127.0.0.1:9/v1", TAKI_PROVIDER_API_KEY: "isolated-not-a-secret", TAKI_PROVIDER_MODEL: "fixture-unused" },
  stdio: ["ignore", "pipe", "pipe"] });
let logs = ""; core.stdout.on("data", (data) => { logs += data; }); core.stderr.on("data", (data) => { logs += data; });
const require = createRequire(join(desktop, "package.json"));
const { build } = await import(pathToFileURL(require.resolve("vite")).href);
const { default: react } = await import(pathToFileURL(require.resolve("@vitejs/plugin-react")).href);
const { default: tailwind } = await import(pathToFileURL(require.resolve("@tailwindcss/vite")).href);
let page; let edge; let http;
const evidence = [];
try {
  await waitFor(() => { if (core.exitCode !== null) throw new Error(logs); return /listening/i.test(logs); }, "actual Core listening");
  writeFileSync(join(fixture, "index.html"), '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>');
  writeFileSync(join(fixture, "qa.css"), '@import "../../src/styles.css";\n@source "../../src";\n');
  writeFileSync(join(fixture, "main.tsx"), `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MonitorPage} from '../../src/windows/home/pages/monitor/monitor-page.tsx';
import {HomeClientContext} from '../../src/windows/home/home-client-context.ts';
import {usePageVisibilityStore} from '../../src/windows/home/page-visibility-store.ts';
import {createWsClient} from '../../src/lib/ws-client.ts';
import {createBrowserTransport} from '../../src/lib/ws-transport.ts';
import {TIMING_POLICY_DEVELOPMENT_DEFAULTS} from '@taki/shared';
import './qa.css';
async function connect(){ const client=createWsClient({transport:createBrowserTransport('ws://127.0.0.1:${port}')});
 await client.connect({deviceId:crypto.randomUUID(),deviceName:'Isolated maintenance QA',role:'operator',capabilities:[]});
 await client.subscribeConfig(); window.__client=client; return client; }
const first=await connect(); usePageVisibilityStore.getState().setActivePage('monitor');
function App(){ const [client,setClient]=useState(first);
 window.__reconnect=async()=>{client.close();setClient(null);setClient(await connect());};
 window.__mode=value=>client.configSet({key:'TAKI_MONITOR_MODE',value});
 return <HomeClientContext.Provider value={{client,status:{kind:'connected'},currentTimingPolicy:()=>TIMING_POLICY_DEVELOPMENT_DEFAULTS}}>
 <main style={{height:'100vh',padding:24}}><MonitorPage/></main></HomeClientContext.Provider>; }
createRoot(document.getElementById('root')).render(<App/>);`);
  await build({ configFile: false, root: fixture, plugins: [react(), tailwind()], logLevel: "warn",
    resolve: { alias: { "@": join(desktop, "src") } }, build: { target: "esnext", outDir: join(fixture, "dist"), emptyOutDir: false } });
  http = createServer((request, response) => {
    const name = request.url === "/" ? "index.html" : new URL(request.url, "http://localhost").pathname.slice(1);
    try {
      const file = resolve(fixture, "dist", name);
      if (!file.startsWith(resolve(fixture, "dist") + "/") && !file.startsWith(resolve(fixture, "dist") + "\\")) throw new Error("outside fixture");
      response.setHeader("content-type", { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[extname(file)] ?? "application/octet-stream");
      response.end(readFileSync(file));
    } catch { response.statusCode = 404; response.end(); }
  });
  await new Promise((done) => http.listen(0, "127.0.0.1", done));
  edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", "--disable-gpu", "--no-first-run",
    "--remote-debugging-port=19371", `--user-data-dir=${join(root, "edge-profile")}`, `http://127.0.0.1:${http.address().port}/`], { windowsHide: true, stdio: "ignore" });
  const pages = await waitFor(async () => { const response = await fetch("http://127.0.0.1:19371/json"); return response.ok ? response.json() : null; }, "Edge CDP");
  page = await connectCdp(pages.find((value) => value.type === "page"));
  await page.call("Emulation.setDeviceMetricsOverride", { width: 1180, height: 850, deviceScaleFactor: 1, mobile: false });
  const text = () => page.evaluate("document.body.innerText");
  const click = async (label) => {
    const point = await page.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(label)}));if(!b||b.disabled)throw Error('missing button');const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await trustedClick(page, point);
  };
  const capture = async (name) => {
    const body = await text(); const screenshot = await page.call("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(root, `${name}.png`), Buffer.from(screenshot.data, "base64")); evidence.push({ name, body });
  };
  await waitFor(async () => (await text()).includes("50.0%"), "normal cache scope");
  assert((await text()).includes("不含记忆整理与上下文压缩")); await capture("normal");
  await click("后台维护"); await waitFor(async () => (await text()).includes("记忆整理"), "maintenance list");
  await click("记忆整理"); await waitFor(async () => (await text()).includes("20,000"), "linked tidy call");
  assert(!(await text()).includes("999,999")); assert(!(await text()).includes("50.0%"));
  assert((await text()).includes("部分完成")); assert(!(await text()).includes(operationId)); await capture("tidy-partial");
  await page.call("Emulation.setDeviceMetricsOverride", { width: 680, height: 850, deviceScaleFactor: 1, mobile: false });
  assert(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")); await capture("narrow-tidy");
  await page.call("Emulation.setDeviceMetricsOverride", { width: 1180, height: 850, deviceScaleFactor: 1, mobile: false });
  await click("上下文压缩"); await waitFor(async () => (await text()).includes("摘要生成未能完成"), "compaction failure");
  await capture("compaction-failed");
  await page.evaluate("window.__reconnect()"); await waitFor(async () => (await text()).includes("摘要生成未能完成"), "reconnect durable selection");
  await capture("reconnected");
  await page.evaluate("window.__mode('DISABLED')"); await waitFor(async () => (await text()).includes("运行监视未启用"), "mode withdrawal");
  assert(!(await text()).includes("fixture-model")); await capture("disabled");
  await page.evaluate("window.__mode('FULL_LOCAL')"); await waitFor(async () => (await text()).includes("后台维护"), "mode restored");
  await click("正常链路"); await waitFor(async () => (await text()).includes("50.0%"), "normal cache unchanged"); await capture("normal-restored");
  console.log(JSON.stringify({ passed: true, artifacts: root, cases: evidence.map((entry) => entry.name) }));
} catch (error) {
  if (page) {
    writeFileSync(join(root, "failure-body.txt"), await page.evaluate("document.body.innerText"));
    const screenshot = await page.call("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(root, "failure.png"), Buffer.from(screenshot.data, "base64"));
  }
  throw error;
} finally {
  if (page) { try { await page.call("Browser.close"); } catch {} page.close(); }
  edge?.kill(); if (http) await new Promise((done) => http.close(done));
  core.kill(); writeFileSync(join(root, "core.log"), logs);
  writeFileSync(join(root, "evidence.json"), JSON.stringify({ environment: { node: process.version }, evidence }, null, 2));
}

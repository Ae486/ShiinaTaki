/** Real WS/operation-owner/controller/rendering checks with a controlled producer, no model or live data. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "../../../../packages/core/node_modules/zod/index.js";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../packages/core/src/db/migrations/index-list.ts";
import { createCanonicalMemoryAuthorityRepo } from "../../../../packages/core/src/db/canonical-memory-authority-repo.ts";
import { createStructuredMemoryBlockRepo } from "../../../../packages/core/src/db/structured-memory-block-repo.ts";
import { createMemoryAutoRepo } from "../../../../packages/core/src/db/memory-auto-repo.ts";
import { createMemoryEventsRepo } from "../../../../packages/core/src/db/memory-events-repo.ts";
import { createMemoryTidyReviewRepo } from "../../../../packages/core/src/db/memory-tidy-review-repo.ts";
import { createCanonicalLocalRuntime } from "../../../../packages/core/src/memory/canonical-local-runtime.ts";
import { createTidyPass } from "../../../../packages/core/src/memory/tidy-pass.ts";
import { createUtilitySlot } from "../../../../packages/core/src/memory/utility-slot.ts";
import { loadMemoryConfig } from "../../../../packages/core/src/config/memory-config.ts";
import { scriptedGenerateModel } from "../../../../packages/core/src/testing/mock-language-model.ts";
import { createMemoryOperationService } from "../../../../packages/core/src/memory/operations/memory-operation-service.ts";
import { readMemoryAuthorityStatus } from "../../../../packages/core/src/memory/operations/memory-authority-status.ts";
import { createMethodRegistry } from "../../../../packages/core/src/server/method-registry.ts";
import { createConnectionRegistry } from "../../../../packages/core/src/server/connection-registry.ts";
import { createMemoryOperationSubscriptions } from "../../../../packages/core/src/server/memory-operation-subscriptions.ts";
import { registerMemoryOperationMethods } from "../../../../packages/core/src/server/methods/memory-operation-methods.ts";
import { startWsServer } from "../../../../packages/core/src/server/ws-server.ts";
import { connectCdp, waitFor, trustedClick } from "../../../../apps/desktop/test/c2-native-driver.mjs";

const root = resolve(`target/memory-tidy-reliability-ui-${Date.now()}`);
const desktop = resolve("apps/desktop");
const fixture = join(desktop, "target", `tidy-ui-${Date.now()}`);
mkdirSync(root, { recursive: true });
mkdirSync(fixture, { recursive: true });
const require = createRequire(join(desktop, "package.json"));
const { build } = await import(pathToFileURL(require.resolve("vite")).href);
const { default: react } = await import(pathToFileURL(require.resolve("@vitejs/plugin-react")).href);
const { default: tailwind } = await import(pathToFileURL(require.resolve("@tailwindcss/vite")).href);
const db = openDatabase({ path: join(root, "isolated.db"), migrations: MIGRATIONS });
const at = new Date().toISOString();
const epoch = createCanonicalMemoryAuthorityRepo(db).initializeLocalAuthority(at);
db.prepare("UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,verified_snapshot_id='synthetic',activation_transaction_id='synthetic' WHERE singleton=1").run({ epoch: epoch.epochId });
const logger = { child: () => logger, info() {}, warn() {}, error() {} };
const setup = { status: () => ({ revision: 0, phase: "compatible", lastSuccessfulPhase: "compatible", configFingerprint: "a".repeat(64),
  attemptId: null, compatibility: null, banks: [], modelHealth: "not-run", latestError: null, lastAttemptAt: null, lastSuccessAt: null, updatedAt: at }) };
const subscriptions = createMemoryOperationSubscriptions();
let starts = 0;
let release;
let canonicalPass;
let canonicalSlot;
const runNow = async (_character, options) => {
  starts += 1;
  if (canonicalPass) return canonicalPass.runNow(_character, options);
  options.onProgress({ edits: 1, steps: 2, reviewed: 3, remaining: 4 });
  return new Promise((done) => { release = done; });
};
const createOwner = () => createMemoryOperationService({ db, live: () => null, tidy: () => ({ authorityEpochId: epoch.epochId, runNow }),
  setup, bootId: crypto.randomUUID(), logger, onChanged: subscriptions.publish });
let owner = createOwner();
const owners = [owner];
const service = Object.fromEntries(["submit", "status", "list", "recent", "cancel", "wait", "stop"].map((key) => [key, (...args) => owner[key](...args)]));
const connections = createConnectionRegistry();
const registry = createMethodRegistry();
registry.register({ method: "connect", paramsSchema: z.object({ deviceId: z.string(), approvalCommandDisclosureRevision: z.string().optional() }).passthrough(),
  handler: (params, context) => {
    connections.authenticate(context.connection, { deviceId: params.deviceId, role: "operator", capabilities: [] });
    return { status: "ok", ...(params.approvalCommandDisclosureRevision ? { approvalCommandDisclosureRevision: params.approvalCommandDisclosureRevision } : {}) };
  } });
registerMemoryOperationMethods(registry, { service, subscriptions, logger });
registry.register({ method: "memory.authority.status", roles: ["operator"], paramsSchema: z.object({}),
  handler: () => readMemoryAuthorityStatus({ db, live: () => null, setup, operations: service }) });
const ws = await startWsServer({ host: "127.0.0.1", port: 0, registry, connectionRegistry: connections, logger });
writeFileSync(join(fixture, "index.html"), '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>');
writeFileSync(join(fixture, "qa.css"), '@import "../../src/styles.css";\n@source "../../src";\n');
writeFileSync(join(fixture, "main.tsx"), `import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryTidyCard} from '../../src/windows/home/pages/operations/memory-tidy-card.tsx';
import {createMemoryOperationsController} from '../../src/windows/home/pages/operations/memory-operations-controller.ts';
import {createWsClient} from '../../src/lib/ws-client.ts';
import {createBrowserTransport} from '../../src/lib/ws-transport.ts';
import './qa.css';
const client=createWsClient({transport:createBrowserTransport('ws://127.0.0.1:${ws.port}')});
await client.connect({deviceId:crypto.randomUUID(),deviceName:'Isolated tidy UI',role:'operator',capabilities:[]});
function App(){
 const [state,set]=useState({operation:null,loading:true,error:null,submitting:false,active:false,feedback:null});
 const [controller]=useState(()=>createMemoryOperationsController({
  loading:()=>set(s=>({...s,loading:true})),
  loaded:value=>set(s=>({...s,active:value.operations.active.some(o=>o.kind==='tidy')})),
  loadFailed:()=>set(s=>({...s,loading:false,error:'status failed'})),
  tidyLoaded:operation=>set(s=>({...s,operation,loading:false,error:null})),
  tidyLoadFailed:()=>set(s=>({...s,loading:false,error:'tidy read failed'})),
  mutationStarted:()=>set(s=>({...s,submitting:true})),
  mutationSettled:feedback=>set(s=>({...s,submitting:false,feedback})),
 }));
 useEffect(()=>{controller.replace(client);return()=>controller.dispose()},[controller]);
 window.__qaState=state;window.__qaReady=true;
 return <main style={{maxWidth:720,margin:'40px auto',padding:24}}><MemoryTidyCard {...state} connectionReady={true} runTidy={controller.submitTidy} refresh={controller.refresh}/></main>
}
window.__documentId=crypto.randomUUID();createRoot(document.getElementById('root')).render(<App/>);`);
await build({ configFile: false, root: fixture, plugins: [react(), tailwind()], logLevel: "warn",
  resolve: { alias: { "@": join(desktop, "src") } }, build: { target: "esnext", outDir: join(fixture, "dist"), emptyOutDir: false } });
const http = createServer((request, response) => {
  const name = request.url === "/" ? "index.html" : new URL(request.url, "http://localhost").pathname.slice(1);
  try {
    const file = resolve(fixture, "dist", name);
    if (!file.startsWith(resolve(fixture, "dist") + "/") && !file.startsWith(resolve(fixture, "dist") + "\\")) throw new Error("outside fixture");
    response.setHeader("content-type", { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[extname(file)] ?? "application/octet-stream");
    response.end(readFileSync(file));
  } catch { response.statusCode = 404; response.end(); }
});
await new Promise((done) => http.listen(0, "127.0.0.1", done));
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", "--disable-gpu", "--no-first-run",
  "--remote-debugging-port=19369", `--user-data-dir=${join(root, "edge-profile")}`, `http://127.0.0.1:${http.address().port}/`], { windowsHide: true, stdio: "ignore" });
let page;
const evidence = [];
const outcome = (status) => ({ status, defects: { missingDisclosure: 0, overBudget: 0, stale: 0, nearDuplicate: 0, misfiled: 7 },
  edits: 1, steps: 3, reviewed: status === "ran" ? 7 : 3, remaining: status === "ran" ? 0 : 4,
  usage: { calls: 1, inputTokens: 10, outputTokens: 5, usageUnknown: 0 },
  ...(status === "partial" ? { reason: "tool-errors", nextAction: "retry", issueCount: 1,
    issues: [{ toolName: "memory_refile", code: "MEMORY_INVALID_REQUEST", issueId: "issue-1", stage: "reference", field: "id" }] } : { nextAction: "none" }) });
try {
  const pages = await waitFor(async () => { const response = await fetch("http://127.0.0.1:19369/json"); return response.ok ? response.json() : null; }, "Edge CDP");
  page = await connectCdp(pages.find((value) => value.type === "page"));
  await page.call("Emulation.setDeviceMetricsOverride", { width: 960, height: 900, deviceScaleFactor: 1, mobile: false });
  const ready = () => waitFor(() => page.evaluate("window.__qaReady && !window.__qaState.loading && !window.__qaState.error"), "loaded tidy card");
  const stateIs = (state) => waitFor(() => page.evaluate(`window.__qaState?.operation?.state===${JSON.stringify(state)} && !window.__qaState.loading`), `operation ${state}`);
  const capture = async (name) => {
    const state = await page.evaluate("window.__qaState");
    const screenshot = await page.call("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(root, `${name}.png`), Buffer.from(screenshot.data, "base64"));
    evidence.push({ name, state, starts });
  };
  const click = async () => {
    const point = await page.evaluate("(()=>{const b=document.querySelector('button');if(!b||b.disabled)throw Error('action unavailable');const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await trustedClick(page, point);
  };
  const reload = async () => {
    const before = await page.evaluate("window.__documentId");
    await page.call("Page.reload");
    await waitFor(() => page.evaluate(`window.__documentId && window.__documentId!==${JSON.stringify(before)}`), "new page generation");
    await ready();
  };
  await ready(); await capture("empty");
  await click(); await stateIs("running"); await capture("running");
  await reload(); await stateIs("running"); assert.equal(starts, 1); await capture("running-remounted");
  release(outcome("partial")); await stateIs("failed"); await capture("partial");
  await reload(); await stateIs("failed"); assert.equal(starts, 1); await capture("partial-remounted");
  await click(); await stateIs("running");
  const retireRelease = release;
  owner = createOwner(); owners.push(owner);
  await stateIs("outcome_unknown"); await capture("interrupted");
  retireRelease(outcome("ran"));
  await reload(); await stateIs("outcome_unknown"); assert.equal(starts, 2);
  await click(); await stateIs("running"); release(outcome("ran")); await stateIs("completed"); await capture("completed");
  assert.equal(starts, 3);
  // One complete correction travels through the actual Canonical producer, SDK, SQLite, owner, WS and DOM.
  const engine = createCanonicalLocalRuntime({ db, epochId: epoch.epochId });
  engine.banks("taki");
  const blocks = createStructuredMemoryBlockRepo(db);
  blocks.replace({ blockId: "user-model", scope: { kind: "global", characterId: null }, actor: "background",
    content: "Synthetic previous understanding. ".repeat(300) });
  const model = scriptedGenerateModel([
    { kind: "tool", toolCallId: "bad-block", toolName: "block_rethink", input: { id: "mistyped-block", content: "synthetic" } },
    { kind: "tool", toolCallId: "corrected-block", toolName: "block_rethink", input: { id: "user-model", content: "Synthetic corrected understanding." } },
    { kind: "tool", toolCallId: "finish", toolName: "memory_finish_edits",
      input: { resolutions: [{ issueId: "issue-1", status: "corrected", correctedBy: "corrected-block" }] } },
  ]);
  canonicalSlot = createUtilitySlot({ mainModel: model, logger });
  canonicalPass = createTidyPass({ view: engine.tidy, slot: canonicalSlot, config: loadMemoryConfig({}), logger,
    checkpoints: createMemoryTidyReviewRepo(db, epoch.epochId), autoState: createMemoryAutoRepo(db), events: createMemoryEventsRepo(db) });
  const priorOperation = await page.evaluate("window.__qaState.operation.operationId");
  await click();
  await waitFor(() => page.evaluate(`window.__qaState.operation?.operationId!==${JSON.stringify(priorOperation)} && window.__qaState.operation?.state==='completed' && !window.__qaState.loading`), "canonical correction completed");
  const actual = await page.evaluate("window.__qaState.operation.result.outcome");
  assert.equal(actual.edits, 1); assert.equal(actual.recoveredIssues, 1); assert.equal(actual.remaining, 0);
  assert.equal(blocks.read("user-model", { kind: "global", characterId: null }).content, "Synthetic corrected understanding.");
  assert.equal(model.doGenerateCalls.length, 3);
  await capture("canonical-corrected");
  await reload(); await stateIs("completed"); assert.equal(starts, 4);
  writeFileSync(join(root, "evidence.json"), JSON.stringify({ kind: "controlled interruption cases plus actual Canonical correction; scripted model; real owner/WS/controller/DOM", evidence }, null, 2));
  console.log(JSON.stringify({ passed: true, starts, cases: evidence.map((value) => value.name), artifacts: root }));
} finally {
  if (release) release(outcome("failed"));
  await canonicalSlot?.stop();
  await Promise.all(owners.map((value) => value.stop()));
  if (page) { try { await page.call("Browser.close"); } catch {} page.close(); }
  edge.kill();
  await ws.close(); await new Promise((done) => http.close(done));
  db.close();
}

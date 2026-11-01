/** Isolated real SQLite/Tidy/WS/client/hook/card acceptance; no paid calls or live user writes. */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join, resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from '../../../../../../packages/core/node_modules/zod/index.js';
import { openDatabase } from '../../../../../../packages/core/src/db/sqlite.ts';
import { MIGRATIONS } from '../../../../../../packages/core/src/db/migrations/index-list.ts';
import { createCanonicalLocalRuntime } from '../../../../../../packages/core/src/memory/canonical-local-runtime.ts';
import { loadMemoryConfig } from '../../../../../../packages/core/src/config/memory-config.ts';
import { createTidyPass } from '../../../../../../packages/core/src/memory/tidy-pass.ts';
import { createUtilitySlot } from '../../../../../../packages/core/src/memory/utility-slot.ts';
import { scriptedGenerateModel } from '../../../../../../packages/core/src/testing/mock-language-model.ts';
import { canonicalMemoryReference, parseCanonicalMemoryReference } from '../../../../../../packages/core/src/memory/canonical-memory-view.ts';
import { createMemoryAutoRepo } from '../../../../../../packages/core/src/db/memory-auto-repo.ts';
import { createMemoryEventsRepo } from '../../../../../../packages/core/src/db/memory-events-repo.ts';
import { memoryTidyMethod } from '../../../../../../packages/core/src/server/methods/memory-tidy.ts';
import { createMethodRegistry } from '../../../../../../packages/core/src/server/method-registry.ts';
import { createConnectionRegistry } from '../../../../../../packages/core/src/server/connection-registry.ts';
import { startWsServer } from '../../../../../../packages/core/src/server/ws-server.ts';
import { connectCdp, waitFor, trustedClick } from '../../../../../../apps/desktop/test/c2-native-driver.mjs';

const root = resolve('target/tidy-repair-20261101');
const desktop = resolve('apps/desktop');
const fixture = join(desktop, 'target', 'tidy-ui-qa');
const require = createRequire(join(desktop, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href);
const { default: tailwind } = await import(pathToFileURL(require.resolve('@tailwindcss/vite')).href);
mkdirSync(fixture, { recursive: true });
const reports = [];
let scenario = 'recovered';
const logger = { child: () => logger, info: () => {}, warn: (data, message) => reports.push({ kind: 'warning', data, message }), error: () => {} };
async function runTidy(characterId) {
  const database = join(root, `ui-${scenario}-${Date.now()}.db`);
  copyFileSync(join(root, 'before-repair.db'), database);
  const db = openDatabase({ path: database, migrations: MIGRATIONS });
  let slot;
  try {
    const epochId = db.prepare('SELECT active_epoch_id FROM memory_authority_selection').get().active_epoch_id;
    const config = loadMemoryConfig({});
    const engine = createCanonicalLocalRuntime({ db, epochId, promptDir: resolve('prompt'), config });
    const review = engine.tidy.captureReview(characterId);
    const id = review.listActive(characterId)[0].id;
    const reference = parseCanonicalMemoryReference(id);
    const nextId = canonicalMemoryReference({ ...reference, expectedRevision: reference.expectedRevision + 1 });
    const missing = canonicalMemoryReference({ ...reference, memoryId: 'unadmitted-fixture-row' });
    const steps = scenario === 'failed'
      ? [{ kind: 'tool', toolCallId: 'missing', toolName: 'memory_reinforce', input: { id: missing } }]
      : [{ kind: 'tool', toolCallId: 'update', toolName: 'memory_set_disclosure', input: { id, disclosure: 'isolated UI verification' } },
        { kind: 'tool', toolCallId: 'stale', toolName: 'memory_reinforce', input: { id } },
        ...(scenario === 'recovered' ? [{ kind: 'tool', toolCallId: 'fixed', toolName: 'memory_reinforce', input: { id: nextId } }] : [])];
    steps.push({ kind: 'tool', toolCallId: 'finish', toolName: 'memory_finish_edits', input: {} });
    slot = createUtilitySlot({ logger, mainModel: scriptedGenerateModel(steps) });
    const auto = createMemoryAutoRepo(db);
    const before = auto.get(characterId).lastTidyAt;
    const pass = createTidyPass({ view: { ...engine.tidy, captureReview: () => review }, autoState: auto,
      events: createMemoryEventsRepo(db), slot, config, logger });
    const outcome = await pass.runNow(characterId);
    reports.push({ kind: 'outcome', scenario, outcome, lastTidyBefore: before, lastTidyAfter: auto.get(characterId).lastTidyAt });
    return outcome;
  } finally { await slot?.stop(); db.close(); }
}
const connections = createConnectionRegistry();
const registry = createMethodRegistry();
registry.register({ method: 'connect', paramsSchema: z.object({ deviceId: z.string(), approvalCommandDisclosureRevision: z.string().optional() }).passthrough(),
  handler: (params, ctx) => { connections.authenticate(ctx.connection, { deviceId: params.deviceId, role: 'operator', capabilities: [] });
    return { status: 'ok', ...(params.approvalCommandDisclosureRevision ? { approvalCommandDisclosureRevision: params.approvalCommandDisclosureRevision } : {}) }; } });
registry.register(memoryTidyMethod({ runNow: runTidy }));
const ws = await startWsServer({ host: '127.0.0.1', port: 0, registry, connectionRegistry: connections, logger });
writeFileSync(join(fixture, 'index.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>');
writeFileSync(join(fixture, 'qa.css'), '@import "../../src/styles.css";\n@source "../../src";\n');
writeFileSync(join(fixture, 'main.tsx'), `import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryTidyCard} from '../../src/windows/home/pages/operations/memory-tidy-card.tsx';
import {useMemoryTidy} from '../../src/windows/home/pages/operations/use-memory-tidy.ts';
import {createWsClient} from '../../src/lib/ws-client.ts';
import {createBrowserTransport} from '../../src/lib/ws-transport.ts';
import './qa.css';
const client=createWsClient({transport:createBrowserTransport('ws://127.0.0.1:${ws.port}')});
await client.connect({deviceId:crypto.randomUUID(),deviceName:'Isolated tidy UI',role:'operator',capabilities:[]});
let refreshes=0; const settled=async()=>{refreshes++;window.__refreshes=refreshes;};
function App(){const state=useMemoryTidy(client,settled); window.__tidyState=state; return <main style={{maxWidth:720,margin:'48px auto',padding:24}}><MemoryTidyCard {...state} connectionReady={true}/></main>}
createRoot(document.getElementById('root')).render(<App/>);
window.__ready=true;`);
await build({ configFile: false, root: fixture, plugins: [react(), tailwind()], logLevel: 'warn',
  resolve: { alias: { '@': join(desktop, 'src') } }, build: { target: 'esnext', outDir: join(fixture, 'dist'), emptyOutDir: true } });
const http = createServer((request, response) => {
  const name = request.url === '/' ? 'index.html' : new URL(request.url, 'http://localhost').pathname.slice(1);
  try { const path = join(fixture, 'dist', name); response.setHeader('content-type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(path)] ?? 'application/octet-stream'); response.end(readFileSync(path)); }
  catch { response.statusCode = 404; response.end(); }
});
await new Promise((yes) => http.listen(0, '127.0.0.1', yes));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=19367', `--user-data-dir=${join(root, 'edge-profile')}`, `http://127.0.0.1:${http.address().port}/`], { windowsHide: true, stdio: 'ignore' });
let session;
try {
  const pages = await waitFor(async () => { const response = await fetch('http://127.0.0.1:19367/json'); return response.ok ? response.json() : null; }, 'Edge CDP');
  session = await connectCdp(pages.find((page) => page.type === 'page'));
  await session.call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
  await waitFor(() => session.evaluate('window.__ready && !!document.querySelector("button") && document.styleSheets.length > 0'), 'production card');
  for (const mode of ['recovered', 'partial', 'failed']) {
    scenario = mode;
    const prior = reports.filter((item) => item.kind === 'outcome').length;
    const point = await session.evaluate('(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("立即整理"));const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
    await trustedClick(session, point);
    await waitFor(() => reports.filter((item) => item.kind === 'outcome').length > prior, `${mode} server result`);
    await waitFor(() => session.evaluate('!window.__tidyState.tidying'), `${mode} UI settled`);
    const state = await session.evaluate('({tidy:window.__tidyState.tidy,failure:window.__tidyState.tidyFailure,error:window.__tidyState.error,refreshes:window.__refreshes,text:document.body.innerText,style:{font:getComputedStyle(document.body).fontFamily,buttonRadius:getComputedStyle(document.querySelector("button")).borderRadius}})');
    if (mode === 'recovered' ? state.tidy?.status !== 'ran' || state.failure !== null : state.failure?.status !== mode || state.tidy !== null) throw new Error('UI_RESULT_MISMATCH');
    const png = await session.call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(root, `ui-${mode}.png`), Buffer.from(png.data, 'base64'));
    reports.push({ kind: 'ui', scenario: mode, state });
  }
  writeFileSync(join(root, 'ui-integration.json'), JSON.stringify({ paidCalls: 0, realDataWrites: false, reports }, null, 2));
  console.log(JSON.stringify({ status: 'passed', scenarios: 3, realWsClientAndCore: true, screenshots: 3 }));
} finally {
  if (session) { await session.call('Browser.close').catch(() => {}); session.close(); }
  else edge.kill();
  await ws.close(); await new Promise((yes) => http.close(yes));
}

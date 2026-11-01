// Production SQLite/SDK meter/WS/client/hook/Monitor integration on a private copy. Zero paid calls.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from '../../../../../../packages/core/node_modules/zod/index.js';
import { openDatabase } from '../../../../../../packages/core/src/db/sqlite.ts';
import { MIGRATIONS } from '../../../../../../packages/core/src/db/migrations/index-list.ts';
import { createCacheUsageRepo } from '../../../../../../packages/core/src/db/cache-usage-repo.ts';
import { createAuxiliaryUsageRepo } from '../../../../../../packages/core/src/db/auxiliary-usage-repo.ts';
import { createCompactionOperationRepo } from '../../../../../../packages/core/src/db/compaction-operation-repo.ts';
import { createAuxiliaryUsageMeter } from '../../../../../../packages/core/src/observability/auxiliary-usage-meter.ts';
import { createCacheUsageService } from '../../../../../../packages/core/src/observability/cache-usage-service.ts';
import { registerCacheUsageMethods } from '../../../../../../packages/core/src/server/methods/cache-usage-methods.ts';
import { createMethodRegistry } from '../../../../../../packages/core/src/server/method-registry.ts';
import { createConnectionRegistry } from '../../../../../../packages/core/src/server/connection-registry.ts';
import { startWsServer } from '../../../../../../packages/core/src/server/ws-server.ts';
import { connectCdp, waitFor } from '../../../../../../apps/desktop/test/c2-native-driver.mjs';

const root = resolve('target/cache-metric-20261101');
const desktop = resolve('apps/desktop');
const fixture = join(desktop, 'target/cache-ui-qa');
mkdirSync(fixture, { recursive: true });
const requireCore = createRequire(new URL('../../../../../../packages/core/package.json', import.meta.url));
const requireDesktop = createRequire(join(desktop, 'package.json'));
const { generateText } = await import(pathToFileURL(requireCore.resolve('ai')).href);
const { MockLanguageModelV4 } = await import(pathToFileURL(requireCore.resolve('ai/test')).href);
const { build } = await import(pathToFileURL(requireDesktop.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(requireDesktop.resolve('@vitejs/plugin-react')).href);
const { default: tailwind } = await import(pathToFileURL(requireDesktop.resolve('@tailwindcss/vite')).href);
const dbPath = join(root, `ui-${Date.now()}.db`);
copyFileSync(join(root, 'before-cache-metric.db'), dbPath);
const db = openDatabase({ path: dbPath, migrations: MIGRATIONS });
const reports = [];
const logger = { child: () => logger, info: () => {}, error: () => {}, warn: (data, message) => reports.push({ kind: 'warning', data, message }) };
const repo = createCacheUsageRepo(db);
const service = createCacheUsageService({ read: repo.read, mode: () => 'FULL_LOCAL', logger });
const auxiliary = createAuxiliaryUsageRepo(db, { onSettled: service.changed });
const meter = createAuxiliaryUsageMeter({ repo: auxiliary, logger });
const compaction = createCompactionOperationRepo(db, { onSummaryCommitted: service.changed });
const connections = createConnectionRegistry();
const registry = createMethodRegistry();
registry.register({ method: 'connect', paramsSchema: z.object({ deviceId: z.string() }).passthrough(),
  handler: (params, ctx) => { connections.authenticate(ctx.connection, { deviceId: params.deviceId, role: 'operator', capabilities: [] }); return { status: 'ok' }; } });
registerCacheUsageMethods(registry, service);
const ws = await startWsServer({ host: '127.0.0.1', port: 0, registry, connectionRegistry: connections, logger });

function reset() {
  const current = db.prepare("SELECT revision,through_seq FROM conversation_summary WHERE character_id='taki'").get();
  const now = new Date().toISOString();
  const begin = compaction.begin({ operationId: randomUUID(), characterId: 'taki', reason: 'pressure',
    selectedFromSeq: current.through_seq + 1, selectedThroughSeq: current.through_seq + 1, capturedTailSeq: current.through_seq + 2,
    expectedSummaryRevision: current.revision, expectedSummaryThrough: current.through_seq, sourceDigest: 'a'.repeat(64),
    beforeTokens: 100, provider: 'scripted', modelId: 'scripted', owner: 'isolated-ui', now,
    expiresAt: new Date(Date.now() + 60000).toISOString() });
  if (begin.status !== 'started') throw new Error('COMPACTION_BEGIN_REFUSED');
  if (compaction.commitSummary({ lease: begin.lease, text: 'Isolated scripted checkpoint', sourceDigest: 'a'.repeat(64), now }) !== 'committed') {
    throw new Error('COMPACTION_COMMIT_REFUSED');
  }
  return begin;
}
async function model(cache, blocked) {
  const candidate = new MockLanguageModelV4({ doGenerate: async () => {
    blocked?.started(); if (blocked) await blocked.wait;
    return { content: [{ type: 'text', text: 'isolated verification' }], finishReason: { unified: 'stop', raw: 'stop' }, warnings: [],
      usage: { inputTokens: { total: 100, noCache: 100 - (cache ?? 0), cacheRead: cache ?? 0, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
        raw: { prompt_tokens: 100, completion_tokens: 1, total_tokens: 101,
          ...(cache === undefined ? {} : { prompt_tokens_details: { cached_tokens: cache } }) } } };
  } });
  await generateText({ model: meter.wrapModel(candidate, { source: 'utility', label: 'cache-ui-verification' }), prompt: 'fixture' });
}

writeFileSync(join(fixture, 'index.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>');
writeFileSync(join(fixture, 'qa.css'), '@import "../../src/styles.css";\n@source "../../src";\nhtml,body,#root{height:100%;margin:0}#root{display:flex}\n');
writeFileSync(join(fixture, 'main.tsx'), `import React from 'react';
import {createRoot} from 'react-dom/client';
import {CacheUsageStrip} from '../../src/windows/home/pages/monitor/cache-usage-strip.tsx';
import {useCacheUsage} from '../../src/windows/home/pages/monitor/use-cache-usage.ts';
import {MonitorWorkspace} from '../../src/windows/home/pages/monitor/monitor-page.tsx';
import {INITIAL_MONITOR_STATE} from '../../src/windows/home/pages/monitor/monitor-controller.ts';
import {HomeClientContext} from '../../src/windows/home/home-client-context.ts';
import {usePageVisibilityStore} from '../../src/windows/home/page-visibility-store.ts';
import {createWsClient} from '../../src/lib/ws-client.ts';
import {createBrowserTransport} from '../../src/lib/ws-transport.ts';
import './qa.css';
usePageVisibilityStore.setState({activePage:'monitor',documentVisible:true});
const root=createRoot(document.getElementById('root'));
const controller=new Proxy({}, {get:()=>async()=>{}});
function App(){const cache=useCacheUsage('FULL_LOCAL');window.__cacheView=cache.view;return <MonitorWorkspace view={{...INITIAL_MONITOR_STATE,mode:'FULL_LOCAL'}} controller={controller} visible={true} connectionKind="connected" cache={<CacheUsageStrip {...cache}/>}/>}
let client;
window.__connect=async()=>{client=createWsClient({transport:createBrowserTransport('ws://127.0.0.1:${ws.port}')});await client.connect({deviceId:crypto.randomUUID(),deviceName:'Cache UI acceptance',role:'operator',capabilities:[]});root.render(<HomeClientContext value={{client,status:{kind:'connected'},currentTimingPolicy:()=>({})}}><App/></HomeClientContext>);};
window.__close=()=>client.close();window.__visible=value=>usePageVisibilityStore.setState({documentVisible:value});
await window.__connect();window.__ready=true;`);
await build({ configFile: false, root: fixture, plugins: [react(), tailwind()], logLevel: 'warn',
  resolve: { alias: { '@': join(desktop, 'src') } }, build: { target: 'esnext', outDir: join(fixture, 'dist'), emptyOutDir: true } });
const http = createServer((request, response) => {
  const name = request.url === '/' ? 'index.html' : new URL(request.url, 'http://localhost').pathname.slice(1);
  try { response.setHeader('content-type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(name)] ?? 'application/octet-stream'); response.end(readFileSync(join(fixture, 'dist', name))); }
  catch { response.statusCode = 404; response.end(); }
});
await new Promise((yes) => http.listen(0, '127.0.0.1', yes));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=19368', '--remote-allow-origins=*', '--user-data-dir=' + join(root, 'edge-profile'), `http://127.0.0.1:${http.address().port}/`], { windowsHide: true, stdio: 'ignore' });
let session;
async function capture(name, predicate) {
  await waitFor(() => session.evaluate(predicate), name);
  const state = await session.evaluate('({view:window.__cacheView,text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth})');
  if (state.overflow) throw new Error('HORIZONTAL_OVERFLOW');
  const png = await session.call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(root, `ui-${name}.png`), Buffer.from(png.data, 'base64'));
  reports.push({ kind: 'ui', scenario: name, state, authoritative: repo.read('taki') });
}
try {
  const pages = await waitFor(async () => { const response = await fetch('http://127.0.0.1:19368/json'); return response.ok ? response.json() : null; }, 'Edge CDP');
  session = await connectCdp(pages.find((page) => page.type === 'page'));
  await session.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });
  await capture('initial', 'window.__ready && window.__cacheView?.phase === "live"');
  reset(); await capture('reset', 'window.__cacheView?.snapshot?.status === "empty"');
  await model(0); await capture('zero', 'window.__cacheView?.snapshot?.ratio === 0 && window.__cacheView.snapshot.pairedRequests === 1');
  await model(undefined); await capture('unknown', 'window.__cacheView?.snapshot?.observedRequests === 2 && window.__cacheView.snapshot.pairedRequests === 1');
  await model(80); await capture('weighted', 'window.__cacheView?.snapshot?.ratio === 0.4');
  await session.evaluate('window.__visible(false)'); await model(100); await session.evaluate('window.__visible(true)');
  await capture('reentry', 'window.__cacheView?.phase === "live" && window.__cacheView.snapshot.ratio === 0.6');
  let started, release; const began = new Promise((yes) => { started = yes; }); const wait = new Promise((yes) => { release = yes; });
  const pending = model(50, { started, wait }); await began; reset();
  await capture('cross-reset', 'window.__cacheView?.snapshot?.status === "empty"');
  release(); await pending; await capture('cross-complete', 'window.__cacheView?.snapshot?.ratio === 0.5 && window.__cacheView.snapshot.observedRequests === 1');
  await session.evaluate('window.__close()'); await capture('disconnected', 'window.__cacheView?.phase === "stale"');
  await session.evaluate('window.__connect()'); await capture('reconnected', 'window.__cacheView?.phase === "live" && window.__cacheView.snapshot.ratio === 0.5');
  await session.call('Emulation.setDeviceMetricsOverride', { width: 620, height: 760, deviceScaleFactor: 1, mobile: false });
  await capture('narrow', 'window.__cacheView?.phase === "live"');
  writeFileSync(join(root, 'ui-integration.json'), JSON.stringify({ paidCalls: 0, liveDataWrites: false, reports }, null, 2));
  console.log(JSON.stringify({ passed: true, scenarios: reports.filter((r) => r.kind === 'ui').length, providerCalls: 5, paidCalls: 0 }));
} finally {
  if (session) { await session.call('Browser.close').catch(() => {}); session.close(); } else edge.kill();
  service.dispose(); await ws.close(); await new Promise((yes) => http.close(yes)); db.close();
}

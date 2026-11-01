// Boot the actual Core with a private database copy and a local fake provider; no paid or live-user writes.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const root = resolve('target/cache-metric-20261101');
const dataDir = join(root, `core-${Date.now()}`);
mkdirSync(dataDir); copyFileSync(join(root, 'before-cache-metric.db'), join(dataDir, 'taki.db'));
let providerCalls = 0;
const provider = createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  const input = JSON.parse(body); providerCalls++;
  if (providerCalls > 6) { response.writeHead(429); response.end(); return; }
  const id = 'isolated-' + providerCalls;
  const usage = { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105,
    prompt_tokens_details: { cached_tokens: 50 }, completion_tokens_details: { reasoning_tokens: 0 } };
  if (input.stream) {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'isolated',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'Isolated cache verification completed.' }, finish_reason: null }] }) + '\n\n');
    response.end('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'isolated',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage }) + '\n\ndata: [DONE]\n\n');
  } else {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id, object: 'chat.completion', created: 1, model: 'isolated',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Isolated cache verification completed.' }, finish_reason: 'stop' }], usage }));
  }
});
await new Promise((yes) => provider.listen(0, '127.0.0.1', yes));
Object.assign(process.env, { TAKI_DATA_DIR: dataDir, TAKI_WS_PORT: '19266', TAKI_MONITOR_MODE: 'FULL_LOCAL',
  TAKI_PROVIDER_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, TAKI_PROVIDER_API_KEY: 'fixture', TAKI_PROVIDER_MODEL: 'isolated',
  TAKI_INITIATIVE_ENABLED: 'false', TAKI_TRUST_LOOPBACK_OPERATOR: 'true', TAKI_PROVIDER_INCLUDE_USAGE: 'true' });
await import('../../../../../../packages/core/src/main.ts');
const require = createRequire(new URL('../../../../../../packages/core/package.json', import.meta.url));
const { default: WebSocket } = await import(pathToFileURL(require.resolve('ws')).href);
const socket = new WebSocket('ws://127.0.0.1:19266');
await new Promise((yes, no) => { socket.once('open', yes); socket.once('error', no); });
let ordinal = 0; const updates = [];
socket.on('message', (raw) => { const data = JSON.parse(raw.toString()); if (data.method === 'observability.cacheUsageChanged') updates.push(data.params); });
const rpc = (method, params) => new Promise((yes, no) => {
  const id = ++ordinal;
  const timer = setTimeout(() => { socket.off('message', handler); no(new Error('RPC_TIMEOUT')); }, 20000);
  const handler = (raw) => { const response = JSON.parse(raw.toString()); if (response.id !== id) return;
    clearTimeout(timer); socket.off('message', handler); if (response.error) no(new Error(response.error.message)); else yes(response.result); };
  socket.on('message', handler); socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
});
try {
  await rpc('connect', { deviceId: randomUUID(), deviceName: 'Cache core verification', role: 'operator' });
  const initial = await rpc('observability.cacheUsageSubscribe', { characterId: 'taki' });
  if (initial.snapshot.status !== 'ready') throw new Error('INITIAL_WINDOW_NOT_READY');
  const run = await rpc('chat.send', { characterId: 'taki', message: 'Isolated automated check: answer with one short sentence, without tools.' });
  const until = Date.now() + 30000;
  while (updates.length === 0 && Date.now() < until) await new Promise((yes) => setTimeout(yes, 100));
  if (updates.length === 0) throw new Error('MISSING_LIVE_PRIMARY_UPDATE');
  const db = new DatabaseSync(join(dataDir, 'taki.db'), { readOnly: true });
  const usage = db.prepare('SELECT input_tokens,cache_read_tokens,cache_read_observed FROM run_usage WHERE run_id=?').all(run.runId);
  db.close();
  if (usage.length !== 1 || usage[0].input_tokens !== 100 || usage[0].cache_read_tokens !== 50 || usage[0].cache_read_observed !== 1) throw new Error('RAW_USAGE_NOT_PRESERVED');
  const latest = updates.at(-1).snapshot;
  if (latest.observedRequests !== initial.snapshot.observedRequests + 1 || latest.inputTokens !== initial.snapshot.inputTokens + 100 || latest.cacheReadTokens !== initial.snapshot.cacheReadTokens + 50) throw new Error('LIVE_AGGREGATE_MISMATCH');
  const report = { paidCalls: 0, liveDataWrites: false, actualMainBoot: true, providerCalls, initial, updates, usage };
  writeFileSync(join(root, 'core-integration.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ kind: 'cache-core-integration', passed: true, providerCalls, liveUpdates: updates.length }));
} finally {
  await new Promise((yes) => { socket.once('close', yes); socket.close(); });
  await new Promise((yes) => provider.close(yes));
  process.emit('SIGTERM');
}

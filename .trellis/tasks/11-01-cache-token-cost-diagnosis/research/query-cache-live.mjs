// Read-only local operator subscription; no model call or cache-window reset.
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { CacheUsageUpdateSchema } from '../../../../packages/shared/src/cache-usage-schema.ts';
const require = createRequire(new URL('../../../../packages/core/package.json', import.meta.url));
const { default: WebSocket } = await import(pathToFileURL(require.resolve('ws')).href);
const socket = new WebSocket('ws://127.0.0.1:8974');
await new Promise((yes, no) => { socket.once('open', yes); socket.once('error', no); });
let ordinal = 0;
const rpc = (method, params) => new Promise((yes, no) => {
  const id = ++ordinal;
  const timer = setTimeout(() => { socket.off('message', handler); no(new Error('RPC_TIMEOUT')); }, 10000);
  const handler = (raw) => { const response = JSON.parse(raw.toString()); if (response.id !== id) return;
    clearTimeout(timer); socket.off('message', handler); if (response.error) no(new Error(response.error.message)); else yes(response.result); };
  socket.on('message', handler); socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
});
try {
  await rpc('connect', { deviceId: randomUUID(), deviceName: 'Cache metric verification', role: 'operator' });
  const result = CacheUsageUpdateSchema.parse(await rpc('observability.cacheUsageSubscribe', { characterId: 'taki' }));
  writeFileSync('target/cache-metric-20261101/live-query.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  await rpc('observability.cacheUsageUnsubscribe', {});
} finally { await new Promise((yes) => { socket.once('close', yes); socket.close(); }); }

/** Owner-authorized local operator query; never prints the connect token or conversation content. */
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(new URL('../../../../../../packages/core/package.json', import.meta.url));
const { default: WebSocket } = await import(pathToFileURL(require.resolve('ws')).href);
const socket = new WebSocket('ws://127.0.0.1:8974');
await new Promise((yes, no) => { socket.once('open', yes); socket.once('error', no); });
let ordinal = 0;
const rpc = (method, params) => new Promise((yes, no) => {
  const id = ++ordinal;
  const timer = setTimeout(() => { socket.off('message', handler); no(new Error('RPC_TIMEOUT')); }, 10_000);
  const handler = (raw) => {
    const response = JSON.parse(raw.toString());
    if (response.id !== id) return;
    clearTimeout(timer); socket.off('message', handler);
    if (response.error) no(new Error(response.error.message)); else yes(response.result);
  };
  socket.on('message', handler);
  socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
});
try {
  await rpc('connect', { deviceId: randomUUID(), deviceName: 'Auxiliary usage acceptance', role: 'operator' });
  const mode = await rpc('observability.state', {});
  const result = await rpc('observability.auxiliaryUsage', {
    from: '2026-11-01T00:00:00.000Z', to: '2026-11-02T00:00:00.000Z', limit: 100,
  });
  const report = { at: new Date().toISOString(), endpoint: 'ws://127.0.0.1:8974', mode, ...result };
  writeFileSync('target/auxiliary-usage-20261101/core-live-query.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ at: report.at, mode, scope: result.scope, totalCalls: result.totalCalls,
    stateCounts: result.stateCounts, tokenCounts: result.tokenCounts }));
} finally {
  await new Promise((yes) => { socket.once('close', yes); socket.close(); });
}

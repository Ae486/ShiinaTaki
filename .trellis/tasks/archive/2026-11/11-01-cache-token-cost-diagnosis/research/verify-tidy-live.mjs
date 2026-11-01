// One bounded operator call; never automatically repeat a mutation after timeout.
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(new URL('../../../../../../packages/core/package.json', import.meta.url));
const { default: WebSocket } = await import(pathToFileURL(require.resolve('ws')).href);
const mode = process.argv[2];
if (!['inspect', 'tidy'].includes(mode)) throw new Error('Expected inspect or tidy');
const socket = new WebSocket('ws://127.0.0.1:8974');
await new Promise((yes, no) => { socket.once('open', yes); socket.once('error', no); });
let ordinal = 0;
const rpc = (method, params, timeout = 10000) => new Promise((yes, no) => {
  const id = ++ordinal;
  const timer = setTimeout(() => { socket.off('message', handler); no(new Error('RPC_TIMEOUT_OUTCOME_UNKNOWN')); }, timeout);
  const handler = (raw) => {
    const response = JSON.parse(raw.toString());
    if (response.id !== id) return;
    clearTimeout(timer); socket.off('message', handler);
    yes(response);
  };
  socket.on('message', handler);
  socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
});
try {
  const connected = await rpc('connect', { deviceId: randomUUID(), deviceName: 'Tidy repair verification', role: 'operator' });
  if (connected.error) throw new Error('CONNECT_REFUSED');
  const startedAt = new Date().toISOString();
  const response = mode === 'tidy'
    ? await rpc('memory.tidy', { characterId: 'taki' }, 600000)
    : await rpc('run.queue', { limit: 100 });
  const report = { startedAt, finishedAt: new Date().toISOString(), mode, response };
  writeFileSync(`target/tidy-repair-20261101/live-${mode}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await new Promise((yes) => { socket.once('close', yes); socket.close(); });
}

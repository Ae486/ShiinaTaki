/** Isolated real Core/WS boot; dummy provider credentials prevent paid calls. */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../../../packages/core/src/db/sqlite.ts';
import { MIGRATIONS } from '../../../../packages/core/src/db/migrations/index-list.ts';
import { createAuxiliaryUsageRepo } from '../../../../packages/core/src/db/auxiliary-usage-repo.ts';

const root = resolve('target/auxiliary-usage-20261101');
const dataDir = join(root, `smoke-${Date.now()}`);
mkdirSync(dataDir);
copyFileSync(join(root, 'rehearsal-065.db'), join(dataDir, 'taki.db'));
const db = openDatabase({ path: join(dataDir, 'taki.db'), migrations: MIGRATIONS });
const callId = randomUUID();
createAuxiliaryUsageRepo(db).start({ callId, taskId: null, source: 'utility', label: 'smoke-interrupted',
  provider: 'fixture', modelId: 'fixture', startedAt: '2026-11-01T12:00:00.000Z' });
db.close();
Object.assign(process.env, { TAKI_DATA_DIR: dataDir, TAKI_WS_PORT: '19265', TAKI_MONITOR_MODE: 'FULL_LOCAL',
  TAKI_PROVIDER_BASE_URL: 'http://127.0.0.1:1', TAKI_PROVIDER_API_KEY: 'fixture', TAKI_PROVIDER_MODEL: 'fixture',
  TAKI_INITIATIVE_ENABLED: 'false', TAKI_TRUST_LOOPBACK_OPERATOR: 'true' });
await import('../../../../packages/core/src/main.ts');
const require = createRequire(new URL('../../../../packages/core/package.json', import.meta.url));
const { default: WebSocket } = await import(pathToFileURL(require.resolve('ws')).href);
const socket = new WebSocket('ws://127.0.0.1:19265');
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
  await rpc('connect', { deviceId: randomUUID(), deviceName: 'Auxiliary usage smoke', role: 'operator' });
  const result = await rpc('observability.auxiliaryUsage', { from: '2026-11-01T00:00:00.000Z', to: '2026-11-02T00:00:00.000Z' });
  const interrupted = result.rows.find((row) => row.callId === callId);
  if (result.totalCalls !== 6 || interrupted?.status !== 'interrupted' || interrupted.finishedAt !== null) throw new Error('BOOT_QUERY_MISMATCH');
  writeFileSync(join(root, 'core-smoke.json'), JSON.stringify({ dataDir, scope: result.scope,
    totalCalls: result.totalCalls, stateCounts: result.stateCounts, interrupted, tokenCounts: result.tokenCounts }, null, 2) + '\n');
  console.log(JSON.stringify({ kind: 'auxiliary-core-smoke', totalCalls: result.totalCalls,
    recoveredWithoutInventedDuration: true, authenticatedWs: true }));
} finally {
  await new Promise((yes) => { socket.once('close', yes); socket.close(); });
  process.emit('SIGTERM');
}

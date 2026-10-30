import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

const repo = resolve(process.cwd());
if (repo.toLowerCase() !== 'h:\\takiagent') throw new Error('UNEXPECTED_WORKSPACE');
const checksRoot = join(repo, '.trellis/.runtime/b6-continuation-20260911/d77-quality');
const ownedRoot = mkdtempSync(join(checksRoot, 'boot-owned-'));
const { openDatabase } = await import(pathToFileURL(join(repo, 'packages/core/src/db/sqlite.ts')).href);
const { MIGRATIONS } = await import(pathToFileURL(join(repo, 'packages/core/src/db/migrations/index-list.ts')).href);
const { createCanonicalMemoryAuthorityRepo } = await import(pathToFileURL(join(repo, 'packages/core/src/db/canonical-memory-authority-repo.ts')).href);
const cases = [];
for (const mode of ['legacy-markdown', 'canonical-local']) cases.push(await runCase(mode));
const result = { pass: cases.every((value) => value.pass), ownedRoot, cases };
writeFileSync(join(checksRoot, 'boot-smoke-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.pass) process.exitCode = 1;

async function runCase(mode) {
  const dataDir = join(ownedRoot, mode);
  mkdirSync(dataDir);
  if (mode === 'canonical-local') {
    const fixtureDb = openDatabase({ path: join(dataDir, 'taki.db'), migrations: MIGRATIONS });
    try {
      const epoch = createCanonicalMemoryAuthorityRepo(fixtureDb).initializeLocalAuthority();
      fixtureDb.prepare(`UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,
        verified_snapshot_id='owned-boot-fixture',activation_transaction_id='owned-boot-fixture' WHERE singleton=1`)
        .run({ epoch: epoch.epochId });
    } finally { fixtureDb.close(); }
  }
  let requests = 0;
  const provider = createServer((_request, response) => {
    requests += 1;
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end('{"error":"offline smoke provider"}');
  });
  const probe = createTcpServer();
  const report = { mode, pass: false, providerRequests: 0, dataDir, gracefulShutdownProven: false };
  let child;
  let childExit;
  let output = '';
  try {
    await listen(provider);
    await listen(probe);
    const wsPort = probe.address().port;
    const providerPort = provider.address().port;
    await close(probe);
    const childEnv = {};
    for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC']) {
      if (process.env[key] !== undefined) childEnv[key] = process.env[key];
    }
    Object.assign(childEnv, {
      TAKI_DATA_DIR: dataDir, TAKI_WS_HOST: '127.0.0.1', TAKI_WS_PORT: String(wsPort),
      TAKI_PROVIDER_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
      TAKI_PROVIDER_API_KEY: 'offline-dummy-key', TAKI_PROVIDER_MODEL: 'offline-smoke-model',
      TAKI_HINDSIGHT_ENABLED: 'false', TAKI_AMBIENT_SCREENSHOT: 'false',
    });
    child = spawn(process.execPath, ['packages/core/src/main.ts'], {
      cwd: repo, env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    childExit = once(child, 'exit');
    await new Promise((resolveReady, rejectReady) => {
      const deadline = setTimeout(() => rejectReady(new Error('CORE_STARTUP_DEADLINE')), 30_000);
      const collect = (chunk) => {
        output += chunk.toString('utf8');
        if (output.includes('ws server listening')) { clearTimeout(deadline); resolveReady(); }
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.once('error', (error) => { clearTimeout(deadline); rejectReady(error); });
      child.once('exit', () => { clearTimeout(deadline); rejectReady(new Error('CORE_EXITED_BEFORE_READY')); });
    });
    report.ready = true;
    report.childPid = child.pid;
    child.kill('SIGTERM');
    const [code, signal] = await childExit;
    report.exit = { code, signal };
    const db = openDatabase({ path: join(dataDir, 'taki.db'), migrations: [] });
    try {
      report.versions = db.prepare('SELECT version FROM migrations ORDER BY version').all().map((row) => row.version);
      report.authority = db.prepare('SELECT mode FROM memory_authority_selection WHERE singleton=1').get().mode;
      report.pendingCount = db.prepare('SELECT count(*) AS n FROM pending_memory').get().n;
      report.activationReceipts = db.prepare('SELECT count(*) AS n FROM hindsight_authority_activation_receipts').get().n;
      if (JSON.stringify(report.versions) !== JSON.stringify(Array.from({ length: 47 }, (_, index) => index + 1))) {
        throw new Error('MIGRATION_SEQUENCE_MISMATCH');
      }
      if (report.authority !== mode || requests !== 0 || report.pendingCount !== 0 || report.activationReceipts !== 0) {
        throw new Error('ISOLATION_ASSERTION_FAILED');
      }
    } finally { db.close(); }
    report.pass = true;
  } catch (error) {
    report.failure = error instanceof Error ? error.message : 'SMOKE_FAILED';
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await childExit; }
    if (probe.listening) await close(probe);
    if (provider.listening) await close(provider);
    report.providerRequests = requests;
    report.childExited = !child || child.exitCode !== null || child.signalCode !== null;
    writeFileSync(join(checksRoot, `boot-${mode}.log`), output, 'utf8');
  }
  return report;
}

function listen(server) { return new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); }); }
function close(server) { return new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); }

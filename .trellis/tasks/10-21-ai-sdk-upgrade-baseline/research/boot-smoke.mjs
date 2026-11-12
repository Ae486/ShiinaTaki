import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer, connect } from 'node:net';
import { resolve } from 'node:path';

const phase = process.argv[2];
const evidence = resolve('.trellis/tasks/10-21-ai-sdk-upgrade-baseline/research', phase);
mkdirSync(evidence, { recursive: true });
const dataDir = resolve(evidence, 'boot-data');
mkdirSync(dataDir, { recursive: true });
let modelRequests = 0;
const trap = createServer((request, response) => { modelRequests++; response.writeHead(503); response.end('No inference permitted in boot smoke'); });
await new Promise(resolve => trap.listen(0, '127.0.0.1', resolve));
const reserve = createNetServer();
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'].includes(key.toUpperCase())));
Object.assign(env, { TAKI_DATA_DIR: dataDir, TAKI_WS_HOST: '127.0.0.1', TAKI_WS_PORT: String(port), TAKI_PROVIDER_BASE_URL: `http://127.0.0.1:${trap.address().port}/v1`, TAKI_PROVIDER_MODEL: 'boot-smoke-no-inference', TAKI_PROVIDER_API_KEY: 'invalid-placeholder-no-credential', TAKI_LOG_LEVEL: 'info' });
const child = spawn(process.execPath, ['packages/core/src/main.ts'], { cwd: process.cwd(), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });
let exited = false;
child.on('exit', () => { exited = true; });
const deadline = Date.now() + 20000;
while (!exited && !stdout.includes('ws server listening') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
const listeningLog = stdout.includes('ws server listening');
let socketConnected = false;
if (listeningLog) {
  socketConnected = await new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.on('connect', () => { socket.end(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}
// The PID comes only from this spawn; no app-wide process lookup or shared process stop.
let stop = { alreadyExited: exited };
if (!exited) {
  const stopped = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' });
  stop = { exitCode: stopped.status, output: stopped.stdout.trim() };
  await new Promise(resolve => child.once('exit', resolve));
}
await new Promise(resolve => trap.close(resolve));
writeFileSync(resolve(evidence, 'boot-stdout.log'), stdout);
writeFileSync(resolve(evidence, 'boot-stderr.log'), stderr);
const result = { node: process.version, cwd: process.cwd(), command: ['node', 'packages/core/src/main.ts'], envFileLoaded: false, inheritedEnvironment: 'OS path/runtime allowlist only; no TAKI/model/credential configuration inherited', provider: 'owned loopback HTTP trap with invalid noncredential placeholder required by startup schema', dataDir, port, pid: child.pid, listeningLog, socketConnected, modelRequests, exitCode: child.exitCode, stop };
writeFileSync(resolve(evidence, 'boot.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
process.exitCode = listeningLog && socketConnected && modelRequests === 0 ? 0 : 1;

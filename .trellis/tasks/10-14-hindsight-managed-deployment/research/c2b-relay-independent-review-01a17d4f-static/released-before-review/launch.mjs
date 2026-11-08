/** Validate the frozen packet and tool pins, then invoke its effectful fixed runner. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('./', import.meta.url));
const names = ['launch.mjs', 'run-relay.mjs', 'docker-commands.mjs', 'host-transport.mjs', 'evidence-store.mjs',
  'fixture-server.py', 'stream-relay.py', 'observe-reaping.py'];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

try {
  if (process.argv.length !== 2 || process.execArgv.length !== 0 || process.env.NODE_OPTIONS || !process.env.SystemRoot) throw new Error('LAUNCH_ENVIRONMENT');
  const manifestPath = join(here, 'release.json');
  const manifestMetadata = lstatSync(manifestPath);
  if (!manifestMetadata.isFile() || manifestMetadata.isSymbolicLink() || manifestMetadata.nlink !== 1
    || manifestMetadata.size > 16384 || realpathSync(manifestPath).toLowerCase() !== resolve(manifestPath).toLowerCase()) {
    throw new Error('RELEASE_PATH');
  }
  const manifestBytes = readFileSync(manifestPath);
  const release = JSON.parse(manifestBytes.toString('utf8'));
  if (release.schema !== 'c2b-loopback-relay-release-v1' || release.token !== '9a276b18-7fa2-4421-869c-88f0d89aec01'
    || Object.keys(release.files).sort().join(',') !== [...names].sort().join(',')) throw new Error('RELEASE_SHAPE');
  if (process.platform !== 'win32' || process.version !== 'v24.18.0'
    || resolve(process.execPath).toLowerCase() !== resolve('C:/Program Files/nodejs/node.exe').toLowerCase()
    || hash(readFileSync(process.execPath)) !== '9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de') {
    throw new Error('NODE_PIN');
  }
  const files = { 'release.json': manifestBytes };
  for (const name of names) {
    const path = join(here, name);
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || lstatSync(path).nlink !== 1
      || lstatSync(path).size > 65536
      || realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()) throw new Error('SOURCE_PATH');
    const bytes = readFileSync(path);
    if (hash(bytes) !== release.files[name]) throw new Error('SOURCE_PIN');
    files[name] = bytes;
  }
  const load = (name) => import(`data:text/javascript;base64,${files[name].toString('base64')}`);
  const commands = await load('docker-commands.mjs');
  const transport = await load('host-transport.mjs');
  const evidence = await load('evidence-store.mjs');
  const runner = await load('run-relay.mjs');
  await runner.run({ here, files, release, modules: { commands, transport, evidence } });
} catch (error) {
  console.error(JSON.stringify({ verdict: 'FAIL', scope: 'Packet launch', deploymentReady: false,
    code: error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : 'LAUNCH_ERROR' }));
  process.exitCode = 1;
}

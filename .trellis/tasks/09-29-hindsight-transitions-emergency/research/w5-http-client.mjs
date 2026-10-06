/** Isolated HTTP diagnostic: built-ins only until source and parent admission pass. */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, realpathSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = resolve(HERE, '../../../../packages/core/src/memory/hindsight');
export const NODE = 'C:/Program Files/nodejs/node.exe';
export const PREVIOUS_SHA = 'ca275f841f3f5a66620be833a692b33117b9256b735f1cf10f4c17f6522647fb';
export const DEPENDENCIES_SHA = '15540ca2b6a078fc0e0a4de91c08643900abe7f536e47732186ba60b4863810d';
export const API_KEY = 'w5-owned-healthy-fixture';
export const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
export const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
export function write(path, value) {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(`${path}.tmp`, path);
}
const identity = (path) => realpathSync(path).toLowerCase();
function index(rows) {
  const values = new Map();
  for (const row of rows) {
    const key = identity(row.path);
    assert(!values.has(key), 'DUPLICATE_SOURCE');
    assert(Number.isSafeInteger(row.bytes) && row.bytes >= 0 && /^[a-f0-9]{64}$/.test(row.sha256));
    values.set(key, row);
  }
  return values;
}
function same(a, b) { return a.bytes === b.bytes && a.sha256 === b.sha256; }
export function verifyInventory(manifestPath, expectedSha) {
  assert.equal(sha(manifestPath), expectedSha, 'SOURCE_MANIFEST_CHANGED');
  const manifest = read(manifestPath);
  const previousPath = resolve(HERE, 'w5-head-prefetch-source-manifest.json');
  assert.equal(sha(previousPath), PREVIOUS_SHA, 'PREVIOUS_MANIFEST_CHANGED');
  const previous = index(read(previousPath).files);
  assert.equal(previous.size, 404);
  const dependencyPath = resolve(HERE, 'w5-http-dependencies.json');
  assert.equal(sha(dependencyPath), DEPENDENCIES_SHA, 'DEPENDENCY_MANIFEST_CHANGED');
  const files = verifyUnion(manifest, read(previousPath), read(dependencyPath));
  for (const row of files.values()) {
    assert.equal(statSync(row.path).size, row.bytes, 'SOURCE_SIZE_CHANGED');
    assert.equal(sha(row.path), row.sha256, 'SOURCE_BYTES_CHANGED');
  }
  assert.equal(sha(manifestPath), expectedSha);
  return { sha256: expectedSha, entries: files.size, verified: true };
}

export function verifyUnion(manifest, predecessor, dependency) {
  const previous = index(predecessor.files);
  const files = index(manifest.files);
  const dependencies = index(dependency.files);
  const declared = new Set(dependency.additions.map(identity));
  assert.equal(declared.size, dependency.additions.length, 'DUPLICATE_DECLARED_ADDITION');
  const additions = new Set(manifest.additions.map(identity));
  assert.equal(additions.size, manifest.additions.length, 'DUPLICATE_ADDITION');
  assert.deepEqual(additions, declared, 'ADDITION_SET_CHANGED');
  const required = new Set([...previous.keys(), ...dependencies.keys(), ...additions]);
  assert.equal(files.size, required.size, 'SOURCE_SET_CHANGED');
  for (const key of required) assert(files.has(key), 'SOURCE_OMITTED');
  for (const [key, row] of [...previous, ...dependencies]) assert(same(row, files.get(key)), 'PIN_REPLACED');
  return files;
}

export async function coreModules() {
  return {
    ...(await import(pathToFileURL(resolve(CORE, 'hindsight-client.ts')).href)),
    ...(await import(pathToFileURL(resolve(CORE, 'hindsight-transition-proof.ts')).href)),
    ...(await import(pathToFileURL(resolve(CORE, 'hindsight-http-transport.ts')).href)),
  };
}

export async function executePublic(input, { timeoutMs = 60000 } = {}) {
  const { createHindsightClient, signHindsightTransitionDelta, hindsightHttpTransport } = await coreModules();
  const endpoint = new URL(input.endpoint);
  assert.equal(endpoint.hostname, '127.0.0.1');
  const prefix = `/ext/taki-memory/banks/${encodeURIComponent(input.bank)}/transitions`;
  const statusPath = `${prefix}/${input.transition}`;
  const allowed = new Set(['GET /health', 'GET /ext/taki-memory/version', `GET ${statusPath}`,
    `POST ${statusPath}/claim`, `POST ${prefix}/executor/delta`, `GET ${statusPath}/delta`]);
  const transports = [];
  let applyPosts = 0; let claims = 0;
  const client = createHindsightClient({ endpoint: input.endpoint, resolveApiKey: () => API_KEY,
    transport: async (url, init, maxBytes) => {
      const target = new URL(url); const method = init?.method ?? 'GET';
      assert.equal(target.origin, endpoint.origin, 'HTTP_ORIGIN_REFUSED');
      assert(allowed.has(`${method} ${target.pathname}`) && !target.search && !target.hash, 'HTTP_PATH_REFUSED');
      if (method === 'POST' && target.pathname.endsWith('/executor/delta')) assert.equal(++applyPosts, 1);
      if (method === 'POST' && target.pathname.endsWith('/claim')) assert.equal(++claims, 1);
      const event = { method, path: target.pathname, started: performance.now(), completed: false };
      transports.push(event);
      try {
        const result = await hindsightHttpTransport(url, init, {
          maxBytes, responseStatuses: [401, 403, 404, 409, 413, 422, 503],
        });
        Object.assign(event, { status: result.status, bytes: Buffer.byteLength(result.body), completed: true });
        return result;
      } finally { event.finished = performance.now(); event.milliseconds = event.finished - event.started; }
    } });
  const context = { timeoutMs };
  const result = { diagnosticSucceeded: false, completeHttpBudgetPassed: false, authorityRecoveryProven: false,
    transports, applyPosts: 0, claims: 0 };
  let publicStarted;
  try {
    const setup = performance.now();
    await client.health(context);
    await client.compatibility(context);
    const status = await client.transitionStatus({ bankId: input.bank, transitionId: input.transition, context });
    assert.equal(status.revision, input.expectedRevision);
    assert.equal(status.phase, 'fenced');
    const claimed = await client.claimTransition({ bankId: input.bank, transitionId: input.transition,
      request: { expected_revision: input.expectedRevision, attempt_id: randomUUID() }, context });
    assert.equal(claimed.executor.generation, input.originalGeneration + 1);
    const request = { ...input.request, executor: claimed.executor };
    assert.deepEqual({ ...request, executor: input.request.executor }, input.request);
    const signing = performance.now();
    assert.equal(signHindsightTransitionDelta(input.bank, request).request_hash, input.requestHash);
    result.preparationSigningMilliseconds = performance.now() - signing;
    result.setupMilliseconds = performance.now() - setup;
    const first = transports.length;
    publicStarted = performance.now();
    const applied = await client.applyTransitionDelta({ bankId: input.bank, request, context });
    const publicFinished = performance.now();
    result.publicMilliseconds = publicFinished - publicStarted;
    const active = transports.slice(first);
    assert(active.length > 0);
    result.preTransportMilliseconds = active[0].started - publicStarted;
    result.postTransportValidationMilliseconds = publicFinished - active.at(-1).finished;
    result.applyTransportCount = active.length;
    result.completeHttpBudgetPassed = result.publicMilliseconds < timeoutMs;
    result.applyReturned = true;
    assert(result.completeHttpBudgetPassed, 'HTTP_COMPLETE_PUBLIC_DEADLINE_EXCEEDED');
    const lookupStarted = performance.now();
    const lookup = await client.transitionDelta({ bankId: input.bank, transitionId: input.transition, context });
    result.lookupMilliseconds = performance.now() - lookupStarted;
    assert.deepEqual(lookup, applied);
    Object.assign(result, { applyCompleted: true, exactLookupMatches: true,
      resultHash: applied.result_hash, requestHash: applied.request_hash,
      mappings: applied.mappings.length, artifacts: applied.artifacts.length,
      diagnosticSucceeded: true, executor: claimed.executor });
  } catch (error) {
    result.errorClass = error?.constructor?.name ?? 'UnknownError';
    if (publicStarted !== undefined && result.publicMilliseconds === undefined) result.publicMilliseconds = performance.now() - publicStarted;
    // A timeout/disconnect remains failed even if the server later commits.
  } finally { result.applyPosts = applyPosts; result.claims = claims; }
  return result;
}

export function validateLaunch(job, launch) {
  assert.equal(resolve(launch.job), resolve(job), 'NODE_JOB_MISMATCH');
  assert.equal(launch.parentPid, process.ppid, 'NODE_PARENT_MISMATCH');
  assert.equal(identity(launch.nodeExecutable), identity(NODE), 'NODE_EXECUTABLE_MISMATCH');
  assert.equal(identity(process.execPath), identity(NODE), 'NODE_EXECUTABLE_MISMATCH');
  assert.equal(identity(launch.clientScript), identity(fileURLToPath(import.meta.url)), 'NODE_SCRIPT_MISMATCH');
  assert.match(process.version, /^v24\./, 'NODE_VERSION_MISMATCH');
}
async function main(job) {
  let source; let result = { diagnosticSucceeded: false, completeHttpBudgetPassed: false, authorityRecoveryProven: false };
  try {
    const launch = read(resolve(job, 'node-launch.json')); validateLaunch(job, launch);
    const manifest = resolve(HERE, 'w5-http-checked-v4-source-manifest.json');
    assert.equal(sha(resolve(HERE, 'w5-http-dependencies.json')), launch.dependencySha256);
    source = verifyInventory(manifest, launch.sourceManifestSha256);
    write(resolve(job, 'inventory-node-before.json'), source);
    write(resolve(job, 'node-self.json'), { job: resolve(job), pid: process.pid, parentPid: process.ppid,
      executable: realpathSync(process.execPath), version: process.version, nonce: launch.nonce, source });
    const started = performance.now();
    while (!existsSync(resolve(job, 'node-admission.json'))) {
      assert(performance.now() - started < 10000, 'NODE_ADMISSION_TIMEOUT'); await delay(25);
    }
    const admitted = read(resolve(job, 'node-admission.json'));
    assert.equal(admitted.pid, process.pid); assert.equal(admitted.nonce, launch.nonce);
    assert.equal(admitted.sourceManifestSha256, source.sha256);
    const ready = read(resolve(job, 'http-ready.json'));
    assert.equal(ready.job, resolve(job));
    assert.equal(sha(resolve(job, 'http-input.json')), ready.inputSha256);
    result = await executePublic(read(resolve(job, 'http-input.json')));
  } catch (error) { result.errorClass ??= error?.constructor?.name ?? 'UnknownError'; }
  finally {
    try { write(resolve(job, 'inventory-node-after.json'), verifyInventory(resolve(HERE, 'w5-http-checked-v4-source-manifest.json'), source?.sha256)); }
    catch (error) { write(resolve(job, 'inventory-node-after.json'), { verified: false, errorClass: error.constructor.name }); result.diagnosticSucceeded = false; }
    write(resolve(job, 'http-node-result.json'), result);
  }
  process.exitCode = result.diagnosticSucceeded && result.completeHttpBudgetPassed ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 4 && process.argv[2] === '--owned-job') await main(resolve(process.argv[3]));
  else if (process.argv.length === 2) console.log('Parent-only HTTP diagnostic; executed=false');
  else throw new Error('UNREVIEWED_ARGUMENTS');
}

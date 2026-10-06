/** Actual Core client/socket regressions; optional owned-PG fixture child. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { coreModules, executePublic, read, write, sha, verifyUnion, verifyInventory, validateLaunch, NODE } from './w5-http-client.mjs';

if (process.argv[2] === '--owned-fixture') {
  let result;
  try { result = await executePublic(read(process.argv[3])); }
  catch (error) { result = { diagnosticSucceeded: false, errorClass: error.constructor.name }; }
  write(process.argv[4], result);
  process.exitCode = result.diagnosticSucceeded && result.completeHttpBudgetPassed ? 0 : 1;
} else if (process.argv[2] === '--dependencies') {
  const paths = new Set();
  const hooks = registerHooks({ load(url, context, next) {
    if (url.startsWith('file:')) paths.add(fileURLToPath(url));
    return next(url, context);
  } });
  await coreModules(); hooks.deregister();
  console.log(JSON.stringify([...paths].sort()));
} else {
  const core = await coreModules();
  const shared = await import('../../../../packages/shared/src/index.ts');
  async function withSocket(handler, run) {
    const server = createServer(handler); const sockets = new Set();
    server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try { await run(`http://127.0.0.1:${server.address().port}`); }
    finally { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); }
  }
  const client = (endpoint) => core.createHindsightClient({ endpoint, resolveApiKey: () => 'owned-key' });
  function completeFixture() {
    const hash = 'a'.repeat(64); const bank = 'owned'; const lineage = randomUUID(); const generation = randomUUID();
    const acquire = core.signHindsightTransitionAcquire(bank, { transition_id: randomUUID(), attempt_id: randomUUID(),
      provider_lineage: lineage, bank_generation: generation, direction: 'reenter-hindsight',
      baseline_transition_id: randomUUID(), baseline_proof_hash: hash, request_hash: hash });
    const executor = { transition_id: acquire.transition_id, attempt_id: acquire.attempt_id, generation: 1, fence_token: randomUUID() };
    const key = { artifact_kind: 'source', artifact_id: 'source' };
    const request = core.signHindsightTransitionDelta(bank, shared.HindsightTransitionDeltaRequestSchema.parse({
      executor, operation_id: randomUUID(), request_hash: hash, baseline_transition_id: randomUUID(), baseline_proof_hash: hash,
      local_manifest_hash: hash, native: [{ source: { source_kind: 'bank', source_id: bank, source_revision: 1, source_payload_hash: hash },
        target: { object_kind: 'bank', object_id: bank, object_revision: 1, payload_hash: hash }, disposition: 'reuse', body_hash: null }],
      chunks: [], application: [{ key, expected_artifact: { key, revision: 1, record_hash: hash }, expected_body_hash: hash,
        source_record_hash: hash, disposition: 'upsert', native_source_id: 'document', body: { artifact_kind: 'source_evidence', body: {
          source_ref: { body_id: randomUUID(), body_schema: 'application-source.v1', payload_hash: hash, bytes_sha256: hash,
            total_parts: 1, total_bytes: 1, part_bytes: 262144 },
          expected_document: { object_kind: 'document', object_id: 'document', object_revision: 1, payload_hash: hash } } } }], rows: {} }));
    const support = { state: 'supported', reason: 'all_contracts_available' }; const versioned = { version: '1.0.0', support };
    const manifest = { base_api_version: '0.9.0', compatibility_version: '1.0.0',
      source_identity: { upstream_commit: 'owned-socket-fixture', compatibility_build: shared.HINDSIGHT_TRANSITION_BUILD },
      provider: { lineage, database_dialect: 'postgresql', storage_mode: 'sql_rows' }, support,
      journal: { schema_version: 1, retention_mode: 'operator_managed_cursor_floor', cursor_reset_supported: true },
      snapshot: { schema_version: 1, default_page_size: 500, max_page_size: 1000, default_ttl_seconds: 3600, max_ttl_seconds: 86400 },
      contracts: { change_journal: versioned, conditional_mutation: versioned, logical_snapshot: versioned,
        additive_observation_instructions: versioned, controlled_layer_projection: versioned, native_results: versioned,
        transitions: versioned, transition_source_evidence: versioned, application_state: { ...versioned,
          body_part_bytes: shared.HINDSIGHT_APPLICATION_PART_BYTES, max_response_bytes: shared.HINDSIGHT_APPLICATION_RESPONSE_BYTES,
          max_preparation_bytes: shared.HINDSIGHT_APPLICATION_UPLOAD_BYTES, state_cursor_reset_supported: true,
          capture_mode: 'explicit_generation_initialization' } } };
    const status = { protocol: 'taki-transition-v1', bank_id: bank, request: acquire, executor, revision: 1,
      phase: 'fenced', lease_expires_at: '2026-10-05T00:00:00+00:00', executor_live: false,
      active_writers: 0, accepted_operations: 0, proof: null, outcome: null };
    const body = { protocol: 'taki-transition-v1', operation_id: request.operation_id, transition_id: executor.transition_id,
      bank_id: bank, provider_lineage: lineage, bank_generation: generation, request_hash: request.request_hash,
      baseline_proof_hash: request.baseline_proof_hash, unused_scope_hash: null, local_manifest_hash: hash,
      native_before_cursor: 1, native_through_cursor: 1, application_through_cursor: 1, mappings: [], artifacts: [] };
    return { input: { bank, transition: executor.transition_id, request, requestHash: request.request_hash,
      expectedRevision: 1, originalGeneration: 1 }, manifest, status, result: { ...body, result_hash: core.hindsightTransitionHash(body) } };
  }
  test('actual apply public timing includes its conditional capability GET; one POST/lookup and exact claimed executor', async () => {
    for (const fault of ['success', 'timeout', 'corrupt']) {
      const fixture = completeFixture(); let capabilityGets = 0; let posts = 0; let lookups = 0;
      await withSocket(async (req, res) => {
        res.setHeader('content-type', 'application/json');
        let value;
        if (req.url === '/health') value = { status: 'healthy', database: 'connected' };
        else if (req.url === '/ext/taki-memory/version') {
          capabilityGets++;
          if (capabilityGets === 2) await delay(fault === 'success' ? 120 : 10);
          value = fixture.manifest;
        } else if (req.url.endsWith('/claim')) {
          let data = ''; for await (const chunk of req) data += chunk;
          const claim = JSON.parse(data);
          fixture.status = { ...fixture.status, revision: 2, executor_live: true,
            executor: { ...fixture.status.executor, attempt_id: claim.attempt_id, generation: 2 } };
          value = fixture.status;
        } else if (req.url.endsWith('/executor/delta')) {
          posts++; let data = ''; for await (const chunk of req) data += chunk;
          const posted = JSON.parse(data);
          assert.deepEqual(posted.executor, fixture.status.executor);
          assert.equal(posted.request_hash, fixture.input.requestHash);
          if (fault === 'timeout') { res.writeHead(200); res.write('{'); await delay(200); res.end('}'); return; }
          value = fault === 'corrupt' ? { ...fixture.result, result_hash: '0'.repeat(64) } : fixture.result;
        } else if (req.url.endsWith('/delta')) { lookups++; value = fixture.result; }
        else value = fixture.status;
        res.end(JSON.stringify(value));
      }, async (endpoint) => {
        const result = await executePublic({ ...fixture.input, endpoint }, { timeoutMs: fault === 'timeout' ? 60 : 1000 });
        assert.equal(posts, 1, JSON.stringify(result)); assert.equal(result.applyPosts, 1);
        assert.equal(capabilityGets, 2, 'setup manifest must not remove the in-call capability GET');
        assert.equal(result.diagnosticSucceeded, fault === 'success', JSON.stringify(result));
        assert.equal(lookups, fault === 'success' ? 1 : 0);
        if (fault === 'success') {
          assert(result.publicMilliseconds >= 110); assert.equal(result.applyTransportCount, 2);
          assert(result.preTransportMilliseconds >= 0 && result.postTransportValidationMilliseconds > 0);
        }
      });
    }
  });
  test('complete actual Core call includes delayed body and rejects oversized or invalid JSON', async () => {
    for (const fault of ['delay', 'oversized', 'invalid']) {
      await withSocket(async (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        if (fault === 'delay') { res.write('{"status":'); await delay(80); res.end('"healthy","database":"connected"}'); }
        else res.end(fault === 'oversized' ? ' '.repeat(600000) : '{broken');
      }, async (endpoint) => {
        const started = performance.now();
        if (fault === 'delay') { await client(endpoint).health({ timeoutMs: 1000 }); assert(performance.now() - started >= 70); }
        else await assert.rejects(client(endpoint).health({ timeoutMs: 1000 }), /HINDSIGHT_RESPONSE_INVALID/);
      });
    }
  });
  test('actual public POST timeout and typed refusal each send exactly once', async () => {
    for (const fault of ['timeout', 'refusal']) {
      let posts = 0;
      await withSocket(async (req, res) => {
        assert.equal(req.method, 'POST'); posts++;
        if (fault === 'timeout') { res.writeHead(200); res.write('{'); await delay(200); res.end('}'); }
        else { res.writeHead(409, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'taki_transition_refused', reason: 'accepted_work_unresolved' })); }
      }, async (endpoint) => {
        await assert.rejects(client(endpoint).fenceTransition({ bankId: 'owned', request: {
          transition_id: randomUUID(), attempt_id: randomUUID(), generation: 1, fence_token: randomUUID(),
        }, context: { timeoutMs: 50 } }), fault === 'timeout' ? /HINDSIGHT_TIMEOUT/ : /HINDSIGHT_TRANSITION_ACCEPTED_WORK_UNRESOLVED/);
        assert.equal(posts, 1);
      });
    }
  });
  test('real final transition proof validation rejects corrupt digest after valid JSON/schema', async () => {
    const transition = randomUUID();
    const body = { protocol: 'taki-transition-v1', operation_id: randomUUID(), transition_id: transition,
      bank_id: 'owned', provider_lineage: randomUUID(), bank_generation: randomUUID(), request_hash: 'a'.repeat(64),
      baseline_proof_hash: 'b'.repeat(64), unused_scope_hash: null, local_manifest_hash: 'c'.repeat(64),
      native_before_cursor: 1, native_through_cursor: 1, application_through_cursor: 1,
      mappings: [], artifacts: [], result_hash: '0'.repeat(64) };
    await withSocket((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); },
      async (endpoint) => assert.rejects(client(endpoint).transitionDelta({ bankId: 'owned', transitionId: transition,
        context: { timeoutMs: 1000 } }), /HINDSIGHT_RESPONSE_INVALID/));
  });
  test('launcher refuses wrong parent/job/executable before any Core network call', () => {
    const job = process.cwd();
    const base = { job, parentPid: process.ppid, nodeExecutable: NODE,
      clientScript: fileURLToPath(new URL('./w5-http-client.mjs', import.meta.url)) };
    for (const value of [{ ...base, job: `${job}/foreign` }, { ...base, parentPid: -1 },
      { ...base, nodeExecutable: process.argv[1] }]) assert.throws(() => validateLaunch(job, value));
  });
  test('fixed union refuses omission, replacement, duplicates and manifest-declared expansion', () => {
    const predecessorPath = fileURLToPath(new URL('./w5-head-prefetch-source-manifest.json', import.meta.url));
    const predecessor = read(predecessorPath);
    const added = { path: import.meta.filename, bytes: 1, sha256: 'a'.repeat(64) };
    const dependency = { files: [], additions: [added.path] };
    const manifest = { files: [...predecessor.files, added], additions: [added.path] };
    assert.equal(verifyUnion(manifest, predecessor, dependency).size, 405);
    const extra = { path: fileURLToPath(new URL('./w5-http-client.mjs', import.meta.url)), bytes: 1, sha256: 'a'.repeat(64) };
    for (const value of [
      { ...manifest, files: manifest.files.slice(1) },
      { ...manifest, files: [{ ...manifest.files[0], sha256: '0'.repeat(64) }, ...manifest.files.slice(1)] },
      { ...manifest, files: [...manifest.files, manifest.files[0]] },
      { ...manifest, additions: [...manifest.additions, added.path] },
      { files: [...manifest.files, extra], additions: [...manifest.additions, extra.path] },
    ]) assert.throws(() => verifyUnion(value, predecessor, dependency));
    assert.throws(() => verifyInventory(predecessorPath, '0'.repeat(64)), /SOURCE_MANIFEST_CHANGED/);
    assert.equal(sha(predecessorPath).length, 64);
  });
}

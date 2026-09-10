/**
 * INPUT:  an explicitly owned native HTTP endpoint, two fixture Banks and a new SQLite path
 * OUTPUT: actual D78 import/maintenance/raw-replica assertions with two lost-ACK restart boundaries
 * POS:    task validation — actual Shared/Core modules; all authority state remains Local
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import type { HindsightConnectionProjection, HindsightCurrentImportEvidence, HindsightPreparedCurrentBank } from "../../../../../packages/shared/src/index.ts";
import { openDatabase, type Database } from "../../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../../packages/core/src/db/migrations/index-list.ts";
import { createCanonicalMemoryRepo } from "../../../../../packages/core/src/db/canonical-memory-repo.ts";
import { createHindsightCutoverRunRepo } from "../../../../../packages/core/src/db/hindsight-cutover-run-repo.ts";
import { createHindsightReplicaRepo } from "../../../../../packages/core/src/db/hindsight-replica-repo.ts";
import { hindsightCheckpointSetDigest } from "../../../../../packages/core/src/db/hindsight-authority-repo.ts";
import { prepareHindsightCurrentBank } from "../../../../../packages/core/src/db/hindsight-current-preparation-repo.ts";
import { readHindsightCurrentImport } from "../../../../../packages/core/src/db/hindsight-current-import-repo.ts";
import { createHindsightClient } from "../../../../../packages/core/src/memory/hindsight/hindsight-client.ts";
import { hindsightHttpTransport } from "../../../../../packages/core/src/memory/hindsight/hindsight-http-transport.ts";
import { createHindsightCompatibilityService } from "../../../../../packages/core/src/memory/hindsight/hindsight-compatibility-service.ts";
import { fetchHindsightCurrentBaseline, importHindsightCurrentBank, verifyHindsightCurrentBank } from "../../../../../packages/core/src/memory/hindsight/hindsight-current-orchestrator.ts";
import type { HindsightCurrentStateClient } from "../../../../../packages/core/src/memory/hindsight/hindsight-current-client.ts";
import { fixtureTemplates, mappedId, saveFixtureCompatibility, seedCurrentLocal } from "./current-cutover-local.fixture.ts";

const context = { timeoutMs: 120_000 };

class CurrentCutoverFixture {
  readonly path: string;
  readonly endpoint: string;
  readonly client;
  readonly connection: HindsightConnectionProjection;
  db: Database;
  fault: "none" | "import_ack" | "verification_ack" = "none";
  transferPosts = 0;
  verificationPosts = 0;

  constructor(path: string, endpoint: string) {
    this.path = path; this.endpoint = endpoint; this.db = this.open();
    this.connection = { enabled: true, deploymentMode: "existing-instance", endpoint,
      apiKeySecretRef: "memory.hindsight.connection.api-key", requestTimeoutMs: 120_000, setupTimeoutMs: 120_000,
      desiredTemplateRevision: "taki-bank-v1", model: { defaultProvider: null, defaultModel: null, retainModel: null,
        reflectModel: null, consolidationModel: null, embeddingProvider: null, embeddingModel: null,
        rerankerProvider: null, rerankerModel: null } };
    this.client = createHindsightClient({ endpoint, resolveApiKey: () => "native-results-offline-test",
      transport: async (raw, init = {}, maxBytes) => {
        const url = new URL(raw); assert.equal(url.origin, endpoint);
        const response = await hindsightHttpTransport(url, init, { maxBytes, responseStatuses: [400, 403, 404, 409, 412, 413, 422, 503] });
        const body = response.body; const ok = response.status >= 200 && response.status < 300;
        if (init.method === "POST" && url.pathname.endsWith("/current-state-transfers")) {
          this.transferPosts++;
          if (ok && this.fault === "import_ack") {
            this.fault = "none"; throw new Error("owned interruption after native import commit");
          }
        }
        if (init.method === "POST" && url.pathname.endsWith("/verify")) {
          this.verificationPosts++;
          if (ok && this.fault === "verification_ack") {
            const status: unknown = JSON.parse(body);
            assert(status && typeof status === "object" && "state" in status && status.state === "complete",
              "lost-ACK fixture requires a genuinely complete native certificate");
            this.fault = "none"; throw new Error("owned interruption after native verification commit");
          }
        }
        return { status: response.status, body, headers: response.headers };
      } });
  }

  current(): HindsightCurrentStateClient {
    assert.equal(typeof this.client.transferCurrentState, "function");
    assert.equal(typeof this.client.prepareCurrentVerification, "function");
    return this.client as HindsightCurrentStateClient;
  }

  reopen() { this.db.close(); this.db = this.open(); }
  private open() { return openDatabase({ path: this.path, migrations: MIGRATIONS }); }
}

async function prepareBanks(f: CurrentCutoverFixture, local: ReturnType<typeof seedCurrentLocal>) {
  const prepared: HindsightPreparedCurrentBank[] = [];
  for (const bank of local.banks) {
    const baseline = await fetchHindsightCurrentBaseline({ bankId: bank.bankId, ttlSeconds: 3600, client: f.current(), context });
    const value = prepareHindsightCurrentBank(f.db, { lease: local.lease, manifestId: local.manifest.manifestId,
      expectedEpochId: local.epochId, now: new Date().toISOString(), sourceBankId: bank.sourceBankId,
      providerLineage: baseline.metadata.manifest.providerLineage, bankGeneration: baseline.metadata.manifest.bankGeneration,
      baseline });
    assert.equal(value.gaps.length, 0); assert(value.request); assert.equal(value.request.preserve.length, 2);
    prepared.push(value);
  }
  assert.equal(prepared[1]?.request?.memory_units.length, 0);
  return prepared;
}

async function importWithRestart(f: CurrentCutoverFixture, prepared: HindsightPreparedCurrentBank[]) {
  const first = prepared[0]; assert(first); f.fault = "import_ack";
  await assert.rejects(() => importHindsightCurrentBank({ db: f.db, preparationId: first.preparationId,
    client: f.current(), context }), /HINDSIGHT_UNREACHABLE/);
  assert.equal(readHindsightCurrentImport(f.db, first.preparationId), undefined);
  f.reopen(); const imports: HindsightCurrentImportEvidence[] = [];
  for (const bank of prepared) {
    const imported = await importHindsightCurrentBank({ db: f.db, preparationId: bank.preparationId,
      client: f.current(), context });
    assert.equal(imported.result.operation_id, bank.operationId);
    imports.push(imported);
  }
  assert.equal(f.transferPosts, 2, "reopening must read the original committed import instead of redispatching");
  assert.equal(imports[1]?.result.manifest.total_records, 1, "an empty source Bank still has an explicit Bank result");
  return imports;
}

async function verifyWithRestart(f: CurrentCutoverFixture, local: ReturnType<typeof seedCurrentLocal>, prepared: HindsightPreparedCurrentBank[]) {
  let certificateCount = 0; let modelCount = 0;
  for (const [index, bank] of prepared.entries()) {
    const request = { preparationId: bank.preparationId, lease: local.lease, verificationId: randomUUID(),
      replicaEpochId: randomUUID(), context, now: () => new Date().toISOString() };
    if (index === 0) {
      f.fault = "verification_ack";
      await assert.rejects(() => verifyHindsightCurrentBank({ ...request, db: f.db, client: f.current() }), /HINDSIGHT_UNREACHABLE/);
      assert.equal(createHindsightReplicaRepo(f.db).checkpoint(bank.bankId), undefined);
      f.reopen();
    }
    const result = await verifyHindsightCurrentBank({ ...request, db: f.db, client: f.current() });
    assert.equal(result.status.state, "complete", JSON.stringify(result.status.reasons));
    assert(result.evidence && result.status.certificate);
    const certificate = result.status.certificate; certificateCount++; modelCount += certificate.model_count;
    assert.equal(certificate.model_count, 1, "the preserved B3 model is required even in the empty Bank");
    const checkpoint = createHindsightReplicaRepo(f.db).checkpoint(bank.bankId); assert(checkpoint);
    assert.equal(checkpoint.snapshotId, certificate.snapshot.snapshot_id);
    assert.equal(checkpoint.endCursor, certificate.snapshot.manifest.end_cursor);
    assert.equal(checkpoint.manifestDigest, certificate.snapshot.manifest.sha256);
  }
  assert.equal(f.verificationPosts, 2, "completed verification must recover its sealed result without rerunning actions");
  return { certificateCount, modelCount };
}

function assertNativeProjection(f: CurrentCutoverFixture, local: ReturnType<typeof seedCurrentLocal>, imported: HindsightCurrentImportEvidence) {
  const read = (kind: string, sourceId: string) => {
    const row = f.db.prepare("SELECT payload_json FROM hindsight_replica_records WHERE bank_id=:bank AND object_kind=:kind AND object_id=:id")
      .get({ bank: imported.result.bank_id, kind, id: mappedId(imported, sourceId) });
    assert(row); return JSON.parse(String(row.payload_json)) as Record<string, unknown>;
  };
  const source = read("document", local.currentSourceId); assert.equal(source.contentHash, null);
  const unit = read("memory_unit", local.currentUnitId); assert.equal(unit.context, "");
  assert.deepEqual(unit.metadata, { number: 2, text: "2", tiny: 1e-7 });
  assert.equal(read("memory_unit", local.archivedUnitId).state, "invalidated");
  assert.deepEqual(unit.sourceMemoryIds, [mappedId(imported, local.record.unit.memoryId)]);
  const preparedRow = f.db.prepare("SELECT preparation_json FROM hindsight_current_preparations WHERE preparation_id=:id")
    .get({ id: imported.preparationId });
  assert(preparedRow); assert(String(preparedRow.preparation_json).includes("declared-history-hash"));
}

function checkReadyAndStale(f: CurrentCutoverFixture, local: ReturnType<typeof seedCurrentLocal>, fingerprint: string, setupRevision: number) {
  const replica = createHindsightReplicaRepo(f.db);
  const banks = local.banks.map((bank) => {
    const checkpoint = replica.checkpoint(bank.bankId); assert(checkpoint);
    const setup = f.db.prepare("SELECT template_digest FROM hindsight_bank_setup WHERE external_bank_id=:bank").get({ bank: bank.bankId });
    assert(setup); return { bankId: bank.bankId, templateDigest: String(setup.template_digest), checkpoint };
  });
  const runs = createHindsightCutoverRunRepo(f.db);
  const ready = { lease: local.lease, configFingerprint: fingerprint, checkpointSetDigest: hindsightCheckpointSetDigest(banks),
    now: new Date().toISOString() };
  runs.markReady(ready);
  assert.equal(runs.verify({ runId: local.runId, expectedRevision: setupRevision, expectedEpochId: local.epochId }).eligible, true);
  const source = createCanonicalMemoryRepo(f.db).record(local.epochId, local.bankId, local.currentUnitId); assert(source);
  createCanonicalMemoryRepo(f.db).edit({ epochId: local.epochId, bankId: local.bankId, memoryId: local.currentUnitId,
    expectedRevision: source.unit.revision, requestId: "fixture-final-local-change", requestHash: "5".repeat(64),
    now: new Date().toISOString(), searchTerms: "new Local writer", patch: { text: "A Local edit after the native certificate." } });
  assert.throws(() => runs.markReady({ ...ready, now: new Date().toISOString() }), /HINDSIGHT_LOCAL_COVERAGE_STALE/);
  assert.equal(runs.verify({ runId: local.runId, expectedRevision: setupRevision, expectedEpochId: local.epochId }).eligible, false);
  const authority = f.db.prepare("SELECT mode,active_epoch_id FROM memory_authority_selection WHERE singleton=1").get();
  assert.equal(authority?.mode, "canonical-local"); assert.equal(authority?.active_epoch_id, local.epochId);
  assert.equal(Number(f.db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n), 0);
}

async function main() {
  const [mode, endpoint, globalBank, characterBank, path] = process.argv.slice(2);
  if (mode === "templates") { console.log(JSON.stringify(fixtureTemplates())); return; }
  assert.equal(mode, "run"); assert.equal(process.env.TAKI_D78_HTTP_FIXTURE, "1");
  assert(endpoint && globalBank && characterBank && path && globalBank !== characterBank);
  const url = new URL(endpoint); assert.equal(url.protocol, "http:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.origin, endpoint); assert(url.port && !url.username && !url.password);
  assert(isAbsolute(path)); assert.equal(basename(path), "fixture.sqlite"); assert(!existsSync(path));
  const f = new CurrentCutoverFixture(path, endpoint);
  try {
    const local = seedCurrentLocal(f.db, { global: globalBank, character: characterBank });
    const historical = JSON.stringify(f.db.prepare("SELECT * FROM memory_migration_sources ORDER BY source_id").all());
    const compatibility = await createHindsightCompatibilityService().validate({ connection: f.connection, secretMarker: "owned-fixture", client: f.client });
    const setup = saveFixtureCompatibility(f.db, compatibility);
    const prepared = await prepareBanks(f, local); const imported = await importWithRestart(f, prepared);
    const counts = await verifyWithRestart(f, local, prepared); const first = imported[0]; assert(first);
    assertNativeProjection(f, local, first); checkReadyAndStale(f, local, compatibility.fingerprint, setup.revision);
    assert.equal(JSON.stringify(f.db.prepare("SELECT * FROM memory_migration_sources ORDER BY source_id").all()), historical);
    console.log(JSON.stringify({ banks: prepared.length, sourceCount: local.manifest.sourceCount,
      transferPosts: f.transferPosts, verificationPosts: f.verificationPosts, ...counts, localAuthorityPreserved: true, staleLocalRefused: true }));
  } finally { f.db.close(); }
}

await main();

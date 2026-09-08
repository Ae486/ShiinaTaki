/**
 * INPUT:  an explicitly owned loopback fixture endpoint and a new temporary SQLite path
 * OUTPUT: actual HTTP/native proof/SQLite recovery assertions, including two restart boundaries
 * POS:    task validation — isolated Node entrypoint importing the actual Core/Shared implementation
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { MemoryReplicaScheduleConfigSchema, type HindsightConnectionProjection, type PendingMemoryRecord,
  type PendingMemoryOperation, type MemoryReplicaScheduledRun } from "../../../../../packages/shared/src/index.ts";
import { createCanonicalMemoryAuthorityRepo } from "../../../../../packages/core/src/db/canonical-memory-authority-repo.ts";
import { createPendingMemoryRepo } from "../../../../../packages/core/src/db/pending-memory-repo.ts";
import { pendingMemoryRef } from "../../../../../packages/core/src/db/pending-memory-store.ts";
import { createHindsightReplicaSyncRepo } from "../../../../../packages/core/src/db/hindsight-replica-sync-repo.ts";
import { createHindsightReplicaSchedulerRepo } from "../../../../../packages/core/src/db/hindsight-replica-scheduler-repo.ts";
import { MIGRATIONS } from "../../../../../packages/core/src/db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../../../../packages/core/src/db/sqlite.ts";
import { createIntlSegmenterTokenizer } from "../../../../../packages/core/src/memory/search-tokenizer.ts";
import { createPendingMemoryWriter } from "../../../../../packages/core/src/memory/pending-memory-writer.ts";
import { createHindsightClient } from "../../../../../packages/core/src/memory/hindsight/hindsight-client.ts";
import { createHindsightPendingRecoveryRunner } from "../../../../../packages/core/src/memory/hindsight/hindsight-pending-recovery-runner.ts";
import { replicaErrorCode } from "../../../../../packages/core/src/memory/hindsight/hindsight-replica-errors.ts";
import type { HindsightReplicaProjection } from "../../../../../packages/core/src/memory/hindsight/hindsight-replica-projection.ts";

// Capture the isolated process clock once; native snapshot expiry uses the
// provider clock, so an unrelated fixed date would manufacture an expiry error.
const at = new Date().toISOString();
const initial = "Alice works at Acme and prefers clear status updates.";
const fragment = "Bob works at Beta and likes careful recovery checks.";
const policy = { layerId: "profile", importance: 5, visibility: "retrieved" as const, disclosure: null,
  origin: "self" as const, emotionalWeight: null, retention: { kind: "permanent" as const }, policyVersion: 1 };
const provenance = { actor: "user" as const, origin: "explicit-user" as const, characterId: null,
  timelineFromSeq: 1, timelineToSeq: 2, capturedAt: at, sanitized: true as const, sourceRef: "owned-native-fixture" };

class NativeHttpFixture {
  readonly path: string;
  readonly endpoint: string;
  readonly bankId: string;
  readonly lineage: string;
  db: Database;
  readonly bank;
  readonly client;
  readonly connection: HindsightConnectionProjection;
  readonly projection: HindsightReplicaProjection;
  replica: ReturnType<typeof createHindsightReplicaSyncRepo>;
  pending: ReturnType<typeof createPendingMemoryRepo>;
  authority: ReturnType<typeof createCanonicalMemoryAuthorityRepo>;
  schedule: ReturnType<typeof createHindsightReplicaSchedulerRepo>;
  sourceBody = initial;
  fault: "none" | "ack" | "second_pull" = "none";
  pulls = 0;
  writes = 0;
  derivedCalls = 0;

  constructor(path: string, endpoint: string, bankId: string, lineage: string) {
    this.path = path; this.endpoint = endpoint; this.bankId = bankId; this.lineage = lineage;
    this.bank = { bankId, scope: "global" as const, characterId: null };
    this.connection = { enabled: true, deploymentMode: "existing-instance", endpoint,
      apiKeySecretRef: "memory.hindsight.connection.api-key", requestTimeoutMs: 10_000, setupTimeoutMs: 10_000,
      desiredTemplateRevision: "taki-bank-v1", model: { defaultProvider: null, defaultModel: null, retainModel: null,
        reflectModel: null, consolidationModel: null, embeddingProvider: null, embeddingModel: null, rerankerProvider: null, rerankerModel: null } };
    // These are explicit test-owned policy/provenance/source bindings, not a B4/B6
    // producer. Reject any source that the fixture did not submit itself.
    this.projection = {
      bankScope: (id) => { assert.equal(id, bankId); return { kind: "global", characterId: null }; },
      source: (record) => {
        assert.equal(record.objectId, "shared-source"); assert.equal(record.payload.kind, "document");
        if (record.payload.kind !== "document") throw new Error("fixture source kind");
        assert.equal(record.payload.value.contentHash, createHash("sha256").update(this.sourceBody).digest("hex"));
        return { retainedText: this.sourceBody, context: "fixture context", provenance };
      },
      memory: (record) => {
        assert.equal(record.payload.kind, "memory_unit");
        if (record.payload.kind !== "memory_unit") throw new Error("fixture memory kind");
        assert.equal(record.payload.value.documentId, "shared-source");
        return { policy: { ...policy, authorityEpochId: "epoch", bankId, memoryId: record.objectId, updatedAt: at }, provenance };
      },
    };
    this.db = this.open(); this.replica = this.createReplica(); this.pending = createPendingMemoryRepo(this.db, () => at);
    this.authority = createCanonicalMemoryAuthorityRepo(this.db); this.schedule = createHindsightReplicaSchedulerRepo(this.db, () => at);
    this.client = createHindsightClient({ endpoint, resolveApiKey: () => "native-results-offline-test", transport: async (raw, init = {}) => {
      const url = new URL(raw); assert.equal(url.origin, endpoint);
      const response = await fetch(url, init);
      const body = await response.text();
      if (url.pathname.endsWith("/changes") && ++this.pulls === 2 && this.fault === "second_pull") throw new Error("owned second-pull interruption");
      if (init.method === "POST" && url.pathname.endsWith("/retains")) {
        this.writes += 1;
        if (this.fault === "ack") throw new Error("owned lost acknowledgement after native response");
      }
      return { status: response.status, body, headers: response.headers };
    } });
  }

  async seed() {
    seedFixtureAuthority(this.db, this.lineage);
    const metadata = await this.client.createLogicalSnapshot!({ bankId: this.bankId, pageSize: 1, ttlSeconds: 3600, context: { timeoutMs: 10_000 } });
    const pages = [];
    for (let pageNumber = 0; pageNumber < metadata.manifest.totalPages; pageNumber += 1) {
      pages.push(await this.client.logicalSnapshotPage!({ bankId: this.bankId, snapshotId: metadata.snapshotId, pageNumber, context: { timeoutMs: 10_000 } }));
    }
    const lease = this.replica.leases.acquire({ bankId: this.bankId, ownerId: "fixture-seed", durationMs: 61_000 });
    this.replica.seedVerifiedSnapshot({ metadata, pages, lease, expectedBank: this.bank, expectedCheckpoint: null,
      authorityEpochId: "epoch", expectedProviderLineageId: this.lineage, expectedBankGeneration: metadata.manifest.bankGeneration });
    this.replica.leases.release(lease);
    this.schedule.ensureBank({ bank: this.bank, config: MemoryReplicaScheduleConfigSchema.parse({ automatic: false }) });
  }

  enqueue(content: string, updateMode: "replace" | "append") {
    const operation: PendingMemoryOperation = { kind: "retain", zeroResultAllowed: false,
      request: { bankId: this.bankId, content, context: "fixture context", timestamp: null, tags: ["fixture", "taki-layer:profile"],
        entities: ["Alice"], metadata: { "10": "十", "2": "二", object: { key: "value" } }, observationScopes: "shared",
        documentId: "shared-source", strategy: null, updateMode, provenance, policy } };
    return createPendingMemoryWriter({ authority: this.authority, replica: this.replica, pending: this.pending, now: () => at })
      .enqueue(operation, { requestId: randomUUID(), authorityEpochId: "epoch", actor: "foreground-agent" }, this.bank);
  }

  enqueueMutation(memoryId: string, expectedRevision: number) {
    return createPendingMemoryWriter({ authority: this.authority, replica: this.replica, pending: this.pending, now: () => at })
      .enqueue({ kind: "mutation", request: { kind: "edit", bankId: this.bankId, memoryId, expectedRevision,
        patch: { text: "Updated native fixture memory", context: null } } },
      { requestId: randomUUID(), authorityEpochId: "epoch", actor: "foreground-agent" }, this.bank);
  }

  row(record: PendingMemoryRecord) { return this.pending.get(pendingMemoryRef(record))!; }
  reopen() {
    this.db.close(); this.db = this.open(); this.replica = this.createReplica(); this.pending = createPendingMemoryRepo(this.db, () => at);
    this.authority = createCanonicalMemoryAuthorityRepo(this.db); this.schedule = createHindsightReplicaSchedulerRepo(this.db, () => at);
  }
  async run() {
    this.pulls = 0;
    this.schedule.requestManual({ bankId: this.bankId, kind: "incremental" });
    const run = this.schedule.claim({ bankId: this.bankId, ownerId: "fixture-recovery", leaseDurationMs: 61_000 })!;
    const runner = createHindsightPendingRecoveryRunner({ client: this.client, replica: this.replica, pending: this.pending,
      authority: this.authority, projection: this.projection, connection: this.connection, secretMarker: "fixture-only", now: () => at,
      derivedCompletion: { check: async () => { this.derivedCalls += 1; throw new Error("routine G1 must not query derived completion"); } } });
    try {
      const result = await runner.run({ bank: this.bank, run, signal: new AbortController().signal });
      this.schedule.succeed({ run, result });
      return result;
    } catch (error) { this.fail(run, error); throw error; }
  }
  private fail(run: MemoryReplicaScheduledRun, error: unknown) { this.schedule.fail({ run, errorCode: replicaErrorCode(error) }); }
  private open() { return openDatabase({ path: this.path, migrations: MIGRATIONS }); }
  private createReplica() { return createHindsightReplicaSyncRepo({ db: this.db, projection: this.projection,
    tokenizer: createIntlSegmenterTokenizer({ stoplist: true }), now: () => at }); }
}

function seedFixtureAuthority(db: Database, lineage: string) {
  // This disposable database uses explicit fixture SQL; no production activation
  // API or real authority state is invoked to establish the test precondition.
  db.prepare(`INSERT INTO canonical_memory_authority_epochs
    (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
    VALUES ('local-epoch','local','local-lineage','closed',NULL,:at,:at, 'initial-local'),
      ('epoch','hindsight',:lineage,'active','local-epoch',:at,NULL,'planned-switch')`).run({ at, lineage });
  db.prepare("INSERT INTO canonical_memory_authority_state (singleton,active_epoch_id,updated_at) VALUES (1,'epoch',:at)").run({ at });
  db.prepare(`INSERT INTO memory_migration_runs (run_id,snapshot_id,phase,status,requested_at,updated_at,lease_fence)
    VALUES ('fixture-run','fixture-snapshot','verified','ready',:at,:at,1)`).run({ at });
  db.prepare(`UPDATE memory_authority_selection SET mode='hindsight',active_epoch_id='epoch',provider_lineage_id=:lineage,
    verified_snapshot_id=NULL,activation_transaction_id='fixture-activation',replica_checkpoint_digest=:digest,updated_at=:at WHERE singleton=1`)
    .run({ lineage, digest: "a".repeat(64), at });
  db.prepare(`INSERT INTO hindsight_authority_activation_receipts
    (transaction_id,run_id,predecessor_epoch_id,hindsight_epoch_id,provider_lineage,config_fingerprint,checkpoint_set_digest,bank_count,lease_fence,committed_at)
    VALUES ('fixture-activation','fixture-run','local-epoch','epoch',:lineage,:fingerprint,:digest,1,1,:at)`)
    .run({ lineage, fingerprint: "b".repeat(64), digest: "c".repeat(64), at });
}

async function main() {
  const [endpoint, bankId, lineage, path] = process.argv.slice(2);
  assert.equal(process.env.TAKI_G1_HTTP_FIXTURE, "1"); assert(endpoint && bankId && lineage && path);
  const url = new URL(endpoint);
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.protocol, "http:"); assert.equal(url.origin, endpoint);
  assert(url.port && !url.username && !url.password); assert(isAbsolute(path)); assert.equal(basename(path), "fixture.sqlite"); assert(!existsSync(path));
  const fixture = new NativeHttpFixture(path, endpoint, bankId, lineage);
  try {
    await fixture.seed();
    const first = fixture.enqueue(initial, "replace"); await fixture.run();
    assert.equal(fixture.row(first).phase, "completed"); assert.equal(fixture.row(first).derivedEvidence, null);
    const checkpoint = fixture.replica.checkpoint(bankId)!;
    const append = fixture.enqueue(fragment, "append"); fixture.sourceBody = `${initial}\n${fragment}`; fixture.fault = "ack";
    await assert.rejects(() => fixture.run(), /HINDSIGHT_UNREACHABLE/);
    const uncertain = fixture.row(append);
    assert.equal(uncertain.phase, "submitted"); assert.equal(uncertain.nativeResultReceipt, undefined);
    assert.deepEqual(fixture.replica.checkpoint(bankId), checkpoint);
    const dispatch = uncertain.dispatch;
    fixture.reopen(); fixture.fault = "second_pull";
    await assert.rejects(() => fixture.run(), /HINDSIGHT_UNREACHABLE/);
    const proof = fixture.row(append).nativeResultReceipt;
    assert(proof); assert.equal(fixture.row(append).phase, "awaiting_pull"); assert.deepEqual(fixture.row(append).dispatch, dispatch);
    fixture.reopen(); fixture.fault = "none"; await fixture.run();
    const completed = fixture.row(append); assert.equal(completed.phase, "completed"); assert.deepEqual(completed.nativeResultReceipt, proof);
    assert.equal(completed.derivedEvidence, null); assert.equal(fixture.derivedCalls, 0); assert.equal(fixture.writes, 2);
    assert(fixture.replica.checkpoint(bankId)!.endCursor >= proof.result.native_through_cursor);
    const source = fixture.replica.logicalRecord({ bankId, objectKind: "document", objectId: "shared-source" });
    assert.equal(source?.payload?.kind, "document");
    if (source?.payload?.kind === "document") assert.equal(source.payload.value.retainedText, fixture.sourceBody);
    const page = await fixture.client.nativeResultPage!({ bankId, kind: "retain", identity: proof.result,
      resultHash: proof.result.result_hash, pageNumber: 0, context: { timeoutMs: 1000 } });
    const reference = page.references.find((value) => value.state === "valid"); assert(reference);
    const current = fixture.replica.record({ bankId, memoryId: reference.memory_id })!;
    const mutation = fixture.enqueueMutation(current.unit.memoryId, current.unit.revision); await fixture.run();
    const mutated = fixture.row(mutation); assert.equal(mutated.phase, "completed");
    assert.equal(mutated.nativeResultReceipt?.result.mutation?.revision, current.unit.revision + 1);
    assert.equal(fixture.replica.record({ bankId, memoryId: current.unit.memoryId })?.unit.text, "Updated native fixture memory");
    assert.equal(fixture.derivedCalls, 0);
    assert.equal(fixture.pending.summary({ authorityEpochId: "epoch", bankId }).completedCount, 3);
    console.log(JSON.stringify({ completed: 3, writes: fixture.writes, derivedCalls: fixture.derivedCalls,
      nativeThroughCursor: proof.result.native_through_cursor, resultHash: proof.result.result_hash,
      operationIds: [first.remoteOperationId, append.remoteOperationId, mutation.remoteOperationId] }));
  } finally { fixture.db.close(); }
}

await main();

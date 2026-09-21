/**
 * INPUT:  synchronous Database wrapper plus operator-run, source, attempt, result, and exclusion commands
 * OUTPUT: durable resumable ledger mutations guarded by owner and monotonically increasing lease fence
 * POS:    core/memory/legacy-migration — migration-only SQLite state; raw bytes remain in snapshots
 */
import type { Database, SqlRow } from "../../db/sqlite.ts";
import type { LegacyDiagnosticCode } from "./legacy-diagnostics.ts";

export interface MigrationRunInput { runId: string; snapshotId: string; epochId: string | null; now: string }
export interface Lease { runId: string; owner: string; fence: number; expiresAt: string }
export interface LedgerSourceInput {
  runId: string; sourceId: string; kind: "entry" | "block"; relativePath: string; rawSha256: string;
  byteLength: number; now: string;
}
export interface LedgerResultInput { memoryId: string; revision: number; payloadHash: string }

export interface LeaseRequest { runId: string; owner: string; now: string; expiresAt: string; recoverFailed?: boolean }

export interface LegacyMigrationLedgerRepo {
  createRun(input: MigrationRunInput): void;
  /**
   * `recoverFailed` moves an interrupted failed run back to running in the same claim statement. Callers reject a
   * superseded run through `requireMigrationRun` first; the ledger stays usable against pre-049 lineage fixtures.
   */
  acquireLease(input: LeaseRequest): Lease;
  renewLease(input: { lease: Lease; now: string; expiresAt: string }): void;
  releaseLease(input: { lease: Lease; now: string }): void;
  addSource(input: LedgerSourceInput): void;
  beginAttempt(input: { lease: Lease; sourceId: string; phase: string; now: string }): number;
  finishAttempt(input: { lease: Lease; sourceId: string; attemptNo: number; now: string; diagnostic?: { code: LegacyDiagnosticCode; detail: string | null } }): void;
  setResults(input: { lease: Lease; sourceId: string; results: LedgerResultInput[]; now: string }): void;
  exclude(input: { lease: Lease; sourceId: string; reason: string; actor: string; now: string }): void;
  source(runId: string, sourceId: string): SqlRow | undefined;
}

export function createLegacyMigrationLedgerRepo(db: Database): LegacyMigrationLedgerRepo {
  return {
    createRun: (input) => createRun(db, input),
    acquireLease: (input) => acquireLease(db, input),
    renewLease: (input) => renewLease(db, input),
    releaseLease: (input) => releaseLease(db, input),
    addSource: (input) => addSource(db, input),
    beginAttempt: (input) => beginAttempt(db, input),
    finishAttempt: (input) => finishAttempt(db, input),
    setResults: (input) => setResults(db, input),
    exclude: (input) => exclude(db, input),
    source: (runId, sourceId) => db.prepare("SELECT * FROM memory_migration_sources WHERE run_id=:run AND source_id=:source").get({ run: runId, source: sourceId }),
  };
}

function createRun(db: Database, input: MigrationRunInput): void {
  db.prepare(`INSERT INTO memory_migration_runs
    (run_id,snapshot_id,epoch_id,phase,status,requested_at,updated_at,lease_fence)
    VALUES (:run,:snapshot,:epoch,'snapshotted','running',:now,:now,0)`)
    .run({ run: input.runId, snapshot: input.snapshotId, epoch: input.epochId, now: input.now });
}

function acquireLease(db: Database, input: LeaseRequest): Lease {
  let fence = 0;
  const statuses = input.recoverFailed ? "('running','ready','failed')" : "('running','ready')";
  db.transaction(() => {
    let result: { changes: number };
    try {
      result = db.prepare(`UPDATE memory_migration_runs SET lease_owner=:owner,lease_fence=lease_fence+1,
        lease_expires_at=:expires,updated_at=:now,
        status=CASE WHEN status='failed' THEN 'running' ELSE status END,
        phase=CASE WHEN status='failed' THEN 'staged' ELSE phase END
        WHERE run_id=:run AND status IN ${statuses}
        AND (lease_owner IS NULL OR lease_expires_at<=:now OR lease_owner=:owner)`)
        .run({ owner: input.owner, expires: input.expiresAt, now: input.now, run: input.runId });
    } catch (error) {
      // The one-live-run index refuses reviving a failed run while another run is live.
      if (error instanceof Error && /idx_memory_migration_one_live_run/.test(error.message)) throw new Error("MIGRATION_BUSY", { cause: error });
      throw error;
    }
    if (result.changes !== 1) throw new Error("LEASE_LOST");
    fence = Number(db.prepare("SELECT lease_fence FROM memory_migration_runs WHERE run_id=:run").get({ run: input.runId })?.lease_fence ?? 0);
  });
  return { runId: input.runId, owner: input.owner, fence, expiresAt: input.expiresAt };
}

function renewLease(db: Database, input: { lease: Lease; now: string; expiresAt: string }): void {
  const result = db.prepare(`UPDATE memory_migration_runs SET lease_expires_at=:expires,updated_at=:now
    WHERE run_id=:run AND lease_owner=:owner AND lease_fence=:fence AND lease_expires_at>:now`)
    .run({ expires: input.expiresAt, now: input.now, run: input.lease.runId, owner: input.lease.owner, fence: input.lease.fence });
  if (result.changes !== 1) throw new Error("LEASE_LOST");
}
function releaseLease(db: Database, input: { lease: Lease; now: string }): void {
  const result = db.prepare("UPDATE memory_migration_runs SET lease_owner=NULL,lease_expires_at=NULL,updated_at=:now WHERE run_id=:run AND lease_owner=:owner AND lease_fence=:fence")
    .run({ now: input.now, run: input.lease.runId, owner: input.lease.owner, fence: input.lease.fence });
  if (result.changes !== 1) throw new Error("LEASE_LOST");
}

function addSource(db: Database, input: LedgerSourceInput): void {
  db.prepare(`INSERT INTO memory_migration_sources
    (run_id,source_id,kind,relative_path,raw_sha256,byte_length,phase,disposition,result_count,updated_at)
    VALUES (:run,:source,:kind,:path,:hash,:bytes,'snapshotted','pending',0,:now)`)
    .run({ run: input.runId, source: input.sourceId, kind: input.kind, path: input.relativePath, hash: input.rawSha256, bytes: input.byteLength, now: input.now });
}

function beginAttempt(db: Database, input: { lease: Lease; sourceId: string; phase: string; now: string }): number {
  assertLease(db, input.lease, input.now);
  const row = db.prepare("SELECT coalesce(max(attempt_no),0)+1 AS next FROM memory_migration_attempts WHERE run_id=:run AND source_id=:source")
    .get({ run: input.lease.runId, source: input.sourceId });
  const attemptNo = Number(row?.next ?? 1);
  db.prepare(`INSERT INTO memory_migration_attempts
    (run_id,source_id,attempt_no,phase,lease_fence,started_at) VALUES (:run,:source,:attempt,:phase,:fence,:now)`)
    .run({ run: input.lease.runId, source: input.sourceId, attempt: attemptNo, phase: input.phase, fence: input.lease.fence, now: input.now });
  return attemptNo;
}

function finishAttempt(db: Database, input: { lease: Lease; sourceId: string; attemptNo: number; now: string; diagnostic?: { code: LegacyDiagnosticCode; detail: string | null } }): void {
  assertLease(db, input.lease, input.now);
  const detail = input.diagnostic?.detail?.slice(0, 512) ?? null;
  const result = db.prepare(`UPDATE memory_migration_attempts SET finished_at=:now,diagnostic_code=:code,diagnostic_detail=:detail
    WHERE run_id=:run AND source_id=:source AND attempt_no=:attempt AND lease_fence=:fence AND finished_at IS NULL`)
    .run({ now: input.now, code: input.diagnostic?.code ?? null, detail, run: input.lease.runId, source: input.sourceId, attempt: input.attemptNo, fence: input.lease.fence });
  if (result.changes !== 1) throw new Error("LEASE_LOST");
}

function setResults(db: Database, input: { lease: Lease; sourceId: string; results: LedgerResultInput[]; now: string }): void {
  db.transaction(() => {
    assertLease(db, input.lease, input.now);
    db.prepare("DELETE FROM memory_migration_results WHERE run_id=:run AND source_id=:source")
      .run({ run: input.lease.runId, source: input.sourceId });
    const insert = db.prepare(`INSERT INTO memory_migration_results
      (run_id,source_id,result_ordinal,memory_id,revision,result_payload_hash) VALUES (:run,:source,:ordinal,:memory,:revision,:hash)`);
    input.results.forEach((item, ordinal) => insert.run({ run: input.lease.runId, source: input.sourceId, ordinal, memory: item.memoryId, revision: item.revision, hash: item.payloadHash }));
    const disposition = input.results.length === 0 ? "converted-zero" : input.results.length === 1 ? "converted-one" : "converted-many";
    const changed = db.prepare(`UPDATE memory_migration_sources SET disposition=:disposition,result_count=:count,
      phase='staged',updated_at=:now WHERE run_id=:run AND source_id=:source AND EXISTS
      (SELECT 1 FROM memory_migration_runs WHERE run_id=:run AND lease_owner=:owner AND lease_fence=:fence AND lease_expires_at>:now)`)
      .run({ disposition, count: input.results.length, now: input.now, run: input.lease.runId, source: input.sourceId, owner: input.lease.owner, fence: input.lease.fence });
    if (changed.changes !== 1) throw new Error("LEASE_LOST");
  });
}

function exclude(db: Database, input: { lease: Lease; sourceId: string; reason: string; actor: string; now: string }): void {
  assertLease(db, input.lease, input.now);
  const source = db.prepare("SELECT relative_path,raw_sha256 FROM memory_migration_sources WHERE run_id=:run AND source_id=:source")
    .get({ run: input.lease.runId, source: input.sourceId });
  const run = db.prepare("SELECT snapshot_id FROM memory_migration_runs WHERE run_id=:run").get({ run: input.lease.runId });
  if (!source || !run || input.reason.length < 1 || input.reason.length > 512) throw new Error("INTEGRITY_MISMATCH");
  db.transaction(() => {
    db.prepare(`INSERT INTO memory_migration_exclusions
      (run_id,source_id,snapshot_id,raw_sha256,relative_path,reason,operator_actor,created_at)
      VALUES (:run,:source,:snapshot,:hash,:path,:reason,:actor,:now)`)
      .run({ run: input.lease.runId, source: input.sourceId, snapshot: String(run.snapshot_id), hash: String(source.raw_sha256), path: String(source.relative_path), reason: input.reason, actor: input.actor, now: input.now });
    const changed = db.prepare(`UPDATE memory_migration_sources SET disposition='excluded',updated_at=:now
      WHERE run_id=:run AND source_id=:source AND EXISTS (SELECT 1 FROM memory_migration_runs
      WHERE run_id=:run AND lease_owner=:owner AND lease_fence=:fence AND lease_expires_at>:now)`)
      .run({ now: input.now, run: input.lease.runId, source: input.sourceId, owner: input.lease.owner, fence: input.lease.fence });
    if (changed.changes !== 1) throw new Error("LEASE_LOST");
  });
}

function assertLease(db: Database, lease: Lease, now: string): void {
  const row = db.prepare(`SELECT 1 AS valid FROM memory_migration_runs WHERE run_id=:run AND lease_owner=:owner
    AND lease_fence=:fence AND lease_expires_at>:now AND status IN ('running','ready')`)
    .get({ run: lease.runId, owner: lease.owner, fence: lease.fence, now });
  if (!row) throw new Error("LEASE_LOST");
}

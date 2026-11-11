import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryReplicaScheduleConfigSchema } from "@taki/shared";
import { readPendingRecoveryState } from "./hindsight-pending-recovery-state.ts";
import { createHindsightReplicaSchedulerRepo } from "./hindsight-replica-scheduler-repo.ts";
import { createHindsightReplicaLeaseRepo } from "./hindsight-replica-lease-repo.ts";
import { publishReplicaCheckpoint } from "./hindsight-replica-checkpoint-store.ts";
import { replicaNextWake } from "./hindsight-replica-schedule-state.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";

const at = "2026-11-11T00:00:00.000Z";
const later = "2026-11-11T00:05:00.000Z";
const bank = { bankId: "global", scope: "global" as const, characterId: null };
const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); vi.restoreAllMocks(); });

function fixture(automatic = true) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  db.prepare(`INSERT INTO canonical_memory_authority_epochs(epoch_id,provider_id,provider_lineage_id,status,started_at,ended_at,reason)
    VALUES ('epoch','hindsight','lineage','active',:at,NULL,'planned-switch'),('old','hindsight','lineage','closed',:at,:at,'planned-switch')`).run({ at });
  db.prepare("INSERT INTO canonical_memory_authority_state VALUES (1,'epoch',:at)").run({ at });
  const repo = createHindsightReplicaSchedulerRepo(db, () => at);
  repo.ensureBank({ bank, config: MemoryReplicaScheduleConfigSchema.parse({ automatic }) });
  return { db, repo, claim: () => repo.claim({ bankId: "global", ownerId: "fixture", leaseDurationMs: 60_000 })! };
}

// The aggregate consumes only persisted recovery metadata. Full producer-shape/Native evidence is covered by recovery tests.
function store(db: Database, patch: Record<string, unknown> = {}, scope = { bank: "global", epoch: "epoch" }) {
  const state = { phase: "submitted", acceptedAt: at, nextRetryAt: later, diagnosticCode: "HINDSIGHT_PENDING_REMAINS",
    dispatch: { protocol: "tracked_native_v1" }, nativeStatus: { status: "processing" }, ...patch };
  db.prepare(`INSERT INTO pending_memory(authority_epoch_id,bank_id,operation_id,operation_kind,intent_hash,phase,version,state_json)
    VALUES (:epoch,:bank,:id,'retain',:hash,:phase,1,:json)`)
    .run({ ...scope, id: randomUUID(), hash: "a".repeat(64), phase: String(state.phase), json: JSON.stringify(state) });
}

describe("one Bank-wide Pending recovery aggregate", () => {
  it.each(["pending", "processing", "partial"])("accepts a saved tracked %s without loading write payloads", (status) => {
    const f = fixture(); store(f.db, { nativeStatus: { status } });
    expect(readPendingRecoveryState(f.db, "global")).toEqual({ unresolvedCount: 1, waitingCount: 1, nextRetryAt: later, blockingErrorCode: null });
  });

  it.each([
    { phase: "submitted", dispatch: undefined, nativeStatus: undefined },
    { phase: "submitted", dispatch: { protocol: "legacy_native_v1" }, nativeStatus: undefined },
    { phase: "awaiting_derived", nativeReceipt: {}, nativeStatus: undefined },
    { phase: "awaiting_pull", nativeResultReceipt: {}, nativeStatus: null },
  ])("preserves accepted legacy/receipt waits: %j", (patch) => {
    const f = fixture(); store(f.db, patch);
    expect(readPendingRecoveryState(f.db, "global")).toMatchObject({ unresolvedCount: 1, waitingCount: 1, blockingErrorCode: null });
  });

  it.each([
    { patch: { nativeStatus: { status: "unavailable" } }, code: "HINDSIGHT_NATIVE_RESULT_UNAVAILABLE" },
    { patch: { nativeStatus: null }, code: "HINDSIGHT_NATIVE_RESULT_UNAVAILABLE" },
    { patch: { diagnosticCode: "HINDSIGHT_UNREACHABLE" }, code: "HINDSIGHT_UNREACHABLE" },
    { patch: { phase: "failed", diagnosticCode: "HINDSIGHT_PENDING_OPERATION_FAILED", nextRetryAt: null }, code: "HINDSIGHT_PENDING_OPERATION_FAILED" },
    { patch: { phase: "outcome_unknown", diagnosticCode: "HINDSIGHT_PENDING_OUTCOME_UNKNOWN", nextRetryAt: null }, code: "HINDSIGHT_PENDING_OUTCOME_UNKNOWN" },
    { patch: { phase: "queued", acceptedAt: null }, code: "HINDSIGHT_PENDING_REMAINS" },
    { patch: { acceptedAt: null }, code: "HINDSIGHT_PENDING_REMAINS" },
    { patch: { phase: "awaiting_derived", nativeReceipt: {}, diagnosticCode: "HINDSIGHT_DERIVED_FENCE_UNAVAILABLE" }, code: "HINDSIGHT_DERIVED_FENCE_UNAVAILABLE" },
  ])("keeps the actual blocker in a mixed Bank: $code / $patch", ({ patch, code }) => {
    const f = fixture(); store(f.db); store(f.db, patch);
    expect(readPendingRecoveryState(f.db, "global")).toMatchObject({ unresolvedCount: 2, waitingCount: 1, blockingErrorCode: code });
    const outcome = f.repo.fail({ run: f.claim(), errorCode: "HINDSIGHT_PENDING_REMAINS" });
    expect(outcome).toMatchObject({ mode: "failed", errorCode: code, consecutiveFailures: 1 });
  });

  it("excludes other Banks, retired epochs and completed history from the one scoped query", () => {
    const f = fixture(); store(f.db); store(f.db, { phase: "failed" }, { bank: "other", epoch: "epoch" });
    store(f.db, { phase: "failed" }, { bank: "global", epoch: "old" }); store(f.db, { phase: "completed" });
    expect(readPendingRecoveryState(f.db, "global")).toMatchObject({ unresolvedCount: 1, waitingCount: 1 });
  });

  it("settles waiting with one aggregate/write, preserving failure history until actual success", () => {
    const f = fixture(); f.repo.fail({ run: f.claim(), errorCode: "HINDSIGHT_UNREACHABLE" }); store(f.db);
    f.repo.requestManual({ bankId: "global", kind: "full", requestId: randomUUID() }); const run = f.claim();
    const prepare = vi.spyOn(f.db, "prepare");
    const waiting = f.repo.fail({ run, errorCode: "HINDSIGHT_PENDING_REMAINS" });
    expect(prepare.mock.calls.filter(([sql]) => sql.includes("FROM pending_memory"))).toHaveLength(1);
    expect(prepare.mock.calls.filter(([sql]) => sql.startsWith("UPDATE hindsight_replica_sync_schedule"))).toHaveLength(1);
    expect(waiting).toMatchObject({ mode: "waiting", fullReconciliationState: "waiting", run: null, retryAttempt: 1,
      consecutiveFailures: 1, errorCode: null, lastSuccessAt: null, lastFullReconciliationAt: null, retryDueAt: later });
    expect(() => createHindsightReplicaLeaseRepo(f.db, () => at).assert(run.lease)).toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    expect(f.repo.request(run.manualRequestId!)).toMatchObject({ state: "waiting", claim: run.lease, settledAt: at, lastSuccessAt: null });
    expect(f.claim()).toBeUndefined(); expect(replicaNextWake(waiting, at)).toBe(later);
    f.repo.requestManual({ bankId: "global", kind: "full" }); const next = f.claim(); const uuid = randomUUID();
    const checkpoint = { bankId: "global", authorityEpochId: "epoch", providerLineageId: uuid, bankGeneration: uuid,
      replicaEpochId: uuid, endCursor: 1, snapshotId: uuid, snapshotCursor: 1, snapshotManifestDigest: "a".repeat(64), manifestDigest: "b".repeat(64), verifiedAt: at };
    publishReplicaCheckpoint(f.db, { previous: null, next: checkpoint });
    expect(f.repo.succeed({ run: next, result: { checkpoint, observedCursor: 1 } })).toMatchObject({ mode: "idle", retryAttempt: 0,
      consecutiveFailures: 0, lastSuccessAt: at, lastFullReconciliationAt: at });
    expect(f.repo.request(run.manualRequestId!)?.state).toBe("waiting");
  });

  it("keeps manual-only waiting inert and reuses the full check when automatic mode resumes", () => {
    const f = fixture(false); store(f.db); f.repo.requestManual({ bankId: "global", kind: "full" });
    const waiting = f.repo.fail({ run: f.claim(), errorCode: "HINDSIGHT_PENDING_REMAINS" });
    expect(waiting).toMatchObject({ mode: "waiting", retryDueAt: null, retryAttempt: 0, nextAction: "explicit_retry_required" });
    expect(replicaNextWake(waiting, at)).toBeNull(); expect(f.claim()).toBeUndefined();
    expect(f.repo.ensureBank({ bank, config: MemoryReplicaScheduleConfigSchema.parse({ automatic: true }) }))
      .toMatchObject({ mode: "waiting", retryDueAt: at, retryKind: "full", nextAction: "automatic_retry_scheduled" });
  });

  it.each([null, at])("bounds an accepted row with non-future retry %s without increasing failure counters", (nextRetryAt) => {
    const f = fixture(); store(f.db, { nextRetryAt });
    expect(f.repo.fail({ run: f.claim(), errorCode: "HINDSIGHT_PENDING_REMAINS" })).toMatchObject({ mode: "waiting",
      retryAttempt: 0, consecutiveFailures: 0, retryDueAt: "2026-11-11T00:01:00.000Z" });
    expect(f.claim()).toBeUndefined();
  });

  it("does not scan Pending for unrelated run failures", () => {
    const f = fixture(); const run = f.claim(); const prepare = vi.spyOn(f.db, "prepare");
    f.repo.fail({ run, errorCode: "HINDSIGHT_TIMEOUT" });
    expect(prepare.mock.calls.filter(([sql]) => sql.includes("FROM pending_memory"))).toEqual([]);
  });
});

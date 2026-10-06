import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createLogger } from "../logging/logger.ts";
import { createMemoryOperationService } from "../memory/operations/memory-operation-service.ts";
import { fakeSetup, seedHindsightAuthority } from "../memory/operations/memory-operation-fixtures.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { createMemoryOperationRepo } from "./memory-operation-repo.ts";
import { createHindsightReplicaSchedulerRepo } from "./hindsight-replica-scheduler-repo.ts";
import { admitTransition, changeTransitionAdmission, claimTransition, readTransitionAttempt, readTransitionByRequest, readTransitionIntent,
  requireTransitionLease, updateTransitionAttempt } from "./memory-transition-repo.ts";
import { readTransitionProof, recordTransitionProof, settleTransition } from "./memory-transition-evidence-repo.ts";
import { currentLease, seedTransition, startTransition, TRANSITION_AT as AT, transitionIdentity, transitionIntent, transitionProof, transitionRequest } from "./memory-transition-fixtures.ts";

const opened: Database[] = []; const dirs: string[] = [];
function open(path = ":memory:", migrations = MIGRATIONS) { const db = openDatabase({ path, migrations }); opened.push(db); return db; }
afterEach(() => { for (const db of opened.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmTempDir(dir); });

describe("transition durable ownership", () => {
  it.each(["admitted", "draining"] as const)("keeps claimed %s isolation after factual failure and lease expiry until explicit release proof", (phase) => {
    const db = open(); const intent = seedTransition(db); let lease = startTransition(db, intent);
    if (phase === "draining") lease = updateTransitionAttempt(db, { lease, now: AT, patch: { phase } });
    const result = { kind: "transition" as const, transitionId: intent.transitionId, receiptId: null, authorityCommitted: false,
      runtime: "source" as const, queue: "settled" as const, outcome: "failed" as const, errorCode: "MEMORY_TRANSITION_PROOF_INVALID" as const };
    expect(() => settleTransition(db, { lease, now: AT, result: { ...result, outcome: "cancelled", errorCode: null } })).toThrow("PROOF_INVALID");
    settleTransition(db, { lease, now: AT, result });
    const ops = createMemoryOperationRepo(db, () => "2026-09-29T00:02:00.000Z");
    ops.transition({ operationId: intent.operationId, expectedState: "running", patch: { state: "failed", result } });
    expect(readTransitionAttempt(db, intent.transitionId)?.phase).toBe(phase);
    expect(() => ops.insertAdmitted({ operationId: randomUUID(), kind: "setup.validate", family: "setup", authorityEpochId: "epoch",
      request: { kind: "setup.validate", expectedRevision: 3 }, producer: { kind: "setup", attemptId: null, revisionBefore: 3, revisionAfter: null }, bootId: "other" })).toThrow("BUSY");
    const scheduler = createHindsightReplicaSchedulerRepo(db, () => "2026-09-29T00:02:00.000Z");
    scheduler.ensureBank({ bank: { bankId: "global", scope: "global", characterId: null } });
    expect(() => scheduler.requestManual({ bankId: "global", kind: "full", requestId: randomUUID() })).toThrow("BUSY");
  });

  it("rejects proof identity/cutoff/Bank mismatch and false cancellation/completion before durable writes", () => {
    const db = open(); const intent = seedTransition(db); let lease = startTransition(db, intent);
    lease = changeTransitionAdmission(db, { lease, now: AT, action: "close" });
    lease = updateTransitionAttempt(db, { lease, now: AT, patch: { phase: "draining" } });
    lease = updateTransitionAttempt(db, { lease, now: AT, patch: { phase: "fenced" } });
    const proof = transitionProof(intent, lease);
    for (const patch of [{ transitionId: randomUUID() }, { attemptId: randomUUID() }, { generation: 99 }, { cutoffSequence: 1 },
      { identity: { ...proof.identity, configRevision: 99 } }, { banks: [] }]) {
      expect(() => recordTransitionProof(db, { lease, now: AT, proof: { ...proof, ...patch } })).toThrow();
    }
    expect(db.prepare("SELECT count(*) AS n FROM memory_transition_evidence").get()?.n).toBe(0);
    expect(() => settleTransition(db, { lease, now: AT, result: { kind: "transition", transitionId: intent.transitionId, receiptId: null,
      authorityCommitted: false, runtime: "source", queue: "settled", outcome: "completed", errorCode: null } })).toThrow();
    expect(db.prepare("SELECT count(*) AS n FROM memory_transition_results").get()?.n).toBe(0);
  });

  it.each(["setup", "local-onboarding", "hindsight-activation", "hindsight-lifecycle", "hindsight-backup", "replica:global"])("guards %s and transition admission in both directions at SQLite", (family) => {
    const db = open(); const intent = seedTransition(db); const ops = createMemoryOperationRepo(db, () => AT);
    const control = () => ops.insertAdmitted({ operationId: randomUUID(), kind: family.startsWith("replica:") ? "replica.sync" : "setup.validate", family,
      authorityEpochId: "epoch", request: family.startsWith("replica:") ? { kind: "replica.sync", bankId: "global", syncKind: "full" } : { kind: "setup.validate", expectedRevision: 3 },
      producer: family.startsWith("replica:") ? { kind: "replica", bankId: "global", admittedAt: AT } : { kind: "setup", attemptId: null, revisionBefore: 3, revisionAfter: null }, bootId: "test" });
    expect(control).toThrow("MEMORY_OPERATION_BUSY");
    ops.transition({ operationId: intent.operationId, expectedState: "running", patch: { state: "failed", reason: "producer_refused" } });
    control();
    expect(() => ops.insertAdmitted({ operationId: randomUUID(), kind: intent.request.kind, family: "memory-transition", authorityEpochId: "epoch",
      request: intent.request, producer: { kind: "transition", transitionId: randomUUID(), requestId: intent.request.requestId }, bootId: "test" })).toThrow("MEMORY_OPERATION_BUSY");
  });

  it("excludes exact direct manual requests in both directions, independent of operation projections", () => {
    const db = open(); const intent = seedTransition(db); const scheduler = createHindsightReplicaSchedulerRepo(db, () => AT);
    scheduler.ensureBank({ bank: { bankId: "global", scope: "global", characterId: null } });
    expect(() => scheduler.requestManual({ bankId: "global", kind: "full", requestId: randomUUID() })).toThrow("MEMORY_OPERATION_BUSY");
    const ops = createMemoryOperationRepo(db, () => AT);
    ops.transition({ operationId: intent.operationId, expectedState: "running", patch: { state: "failed", reason: "producer_refused" } });
    const requestId = randomUUID(); scheduler.requestManual({ bankId: "global", kind: "full", requestId });
    expect(() => ops.insertAdmitted({ operationId: randomUUID(), kind: intent.request.kind, family: "memory-transition", authorityEpochId: "epoch",
      request: intent.request, producer: { kind: "transition", transitionId: randomUUID(), requestId: intent.request.requestId }, bootId: "test" })).toThrow("MEMORY_OPERATION_BUSY");
    expect(scheduler.request(requestId)?.state).toBe("queued");
  });
  it("upgrades 051, preserves receipts and reopens intent/lease/proof with two connections and exact CAS", () => {
    const dir = mkdtempSync(join(tmpdir(), "taki-transition-")); dirs.push(dir); const path = join(dir, "db.sqlite");
    const old = open(path, MIGRATIONS.slice(0, 51)); const history = old.prepare("SELECT * FROM migrations").all(); old.close();
    const db = open(path); const intent = seedTransition(db); let lease = startTransition(db, intent);
    const other = open(path);
    expect(readTransitionIntent(other, intent.transitionId)).toEqual(intent);
    expect(() => claimTransition(other, { transitionId: intent.transitionId, ownerId: "other", now: AT, leaseMs: 1000 })).toThrow("LEASE_LOST");
    lease = changeTransitionAdmission(db, { lease, now: AT, action: "close" });
    expect(() => updateTransitionAttempt(other, { lease: { ...lease, revision: lease.revision - 1 }, now: AT, patch: { phase: "draining" } })).toThrow("LEASE_LOST");
    lease = updateTransitionAttempt(db, { lease, now: AT, patch: { phase: "draining" } });
    lease = updateTransitionAttempt(db, { lease, now: AT, patch: { phase: "fenced" } });
    const proof = transitionProof(intent, lease); const id = recordTransitionProof(db, { lease, now: AT, proof });
    const stale = currentLease(db, intent);
    const takeover = claimTransition(other, { transitionId: intent.transitionId, ownerId: "replacement", now: "2026-09-29T00:01:01.000Z", leaseMs: 60_000 });
    expect(takeover).toMatchObject({ generation: 2, phase: "fenced", lastEvidenceId: id, cutoffSequence: 0 });
    expect(() => requireTransitionLease(db, { lease: stale, now: "2026-09-29T00:01:02.000Z" })).toThrow("LEASE_LOST");
    expect(() => recordTransitionProof(other, { lease: takeover, now: "2026-09-29T00:01:02.000Z", proof })).toThrow("PROOF_INVALID");
    db.close(); other.close(); const reopened = open(path);
    expect(readTransitionProof(reopened, id)).toEqual(proof);
    expect(readTransitionAttempt(reopened, intent.transitionId)).toEqual(takeover);
    expect(reopened.prepare("SELECT * FROM migrations WHERE version<=51").all()).toEqual(history);
    expect(() => reopened.prepare("UPDATE memory_transition_intents SET intent_json='{}'").run()).toThrow("IMMUTABLE");
    expect(() => reopened.prepare("DELETE FROM memory_transition_evidence").run()).toThrow("IMMUTABLE");
  });

  it("rolls operation admission back on stale config, inventory, preview, lineage and failed intent persistence", async () => {
    const db = open(); seedHindsightAuthority(db); const request = transitionRequest();
    let current = transitionIdentity(); let dispatched = 0; const events: unknown[] = [];
    const service = createMemoryOperationService({ db, setup: fakeSetup(), live: () => null, bootId: "owner", now: () => AT,
      logger: createLogger("fatal"), onChanged: (event) => events.push(event), transition: {
        plan: () => ({ current, actorId: "operator-1" }), execute: async () => { dispatched++; return null; },
      } });
    for (const patch of [{ configRevision: 4 }, { inventoryRevision: 2 }, { sourceLineageId: "wrong" }]) {
      current = { ...transitionIdentity(), ...patch };
      expect(() => service.submit(request)).toThrow("STALE");
      expect(service.list({ includeTerminal: true, limit: 50 })).toEqual([]);
    }
    current = transitionIdentity();
    expect(() => service.submit({ ...request, previewHash: "b".repeat(64) })).toThrow("STALE");
    db.exec("CREATE TRIGGER fail_intent BEFORE INSERT ON memory_transition_intents BEGIN SELECT RAISE(ABORT,'fixture-intent-failure'); END;");
    expect(() => service.submit(request)).toThrow("fixture-intent-failure");
    expect(readTransitionByRequest(db, request.requestId)).toBeUndefined();
    expect(events).toHaveLength(0); expect(dispatched).toBe(0);
    db.exec("DROP TRIGGER fail_intent");
    const operation = service.submit(request);
    expect(service.submit(request).operationId).toBe(operation.operationId);
    expect(() => service.submit({ ...request, previewId: randomUUID() })).toThrow("CONFLICT");
    expect(readTransitionByRequest(db, request.requestId)?.operationId).toBe(operation.operationId);
    service.cancel(operation.operationId); await service.stop();
    expect(dispatched).toBe(0);
    expect(service.submit(request).state).toBe("cancelled");
    expect(() => claimTransition(db, { transitionId: readTransitionByRequest(db, request.requestId)!.transitionId, ownerId: "late", now: AT, leaseMs: 1000 })).toThrow("LEASE_LOST");
  });

  it("rolls intent and operation back when the outer SQLite COMMIT fails", () => {
    const db = open(); seedHindsightAuthority(db); const intent = transitionIntent(); const ops = createMemoryOperationRepo(db, () => AT);
    db.exec("CREATE TABLE fixture_parent(id INTEGER PRIMARY KEY); CREATE TABLE fixture_child(id INTEGER REFERENCES fixture_parent(id) DEFERRABLE INITIALLY DEFERRED);");
    expect(() => db.transaction(() => {
      ops.insertAdmitted({ operationId: intent.operationId, kind: intent.request.kind, family: "memory-transition", authorityEpochId: "epoch",
        request: intent.request, producer: { kind: "transition", transitionId: intent.transitionId, requestId: intent.request.requestId }, bootId: "test" });
      admitTransition(db, { intent, current: intent.request.expected }); db.exec("INSERT INTO fixture_child VALUES (99)");
    })).toThrow("FOREIGN KEY");
    expect(ops.get(intent.operationId)).toBeUndefined(); expect(readTransitionIntent(db, intent.transitionId)).toBeUndefined();
    expect(db.prepare("SELECT count(*) AS n FROM fixture_child").get()?.n).toBe(0);
  });

  it("refuses every missing producer without creating an operation or advertising runnable actions", async () => {
    const db = open(); const service = createMemoryOperationService({ db, setup: fakeSetup(), live: () => null, bootId: "test",
      logger: createLogger("fatal"), onChanged: () => {} });
    expect(() => service.submit(transitionRequest())).toThrow("MEMORY_OPERATION_UNSUPPORTED");
    const request = transitionRequest();
    expect(() => service.submit({ ...request, kind: "transition.emergency-local", confirmation: "emergency-takeover" })).toThrow("UNSUPPORTED");
    expect(() => service.submit({ ...request, kind: "transition.reenter-hindsight" })).toThrow("UNSUPPORTED");
    expect(service.list({ includeTerminal: true, limit: 50 })).toEqual([]); await service.stop();
  });

  it("keeps unknown fenced ownership after boot and terminal projection; does not redispatch", async () => {
    const db = open(); const intent = seedTransition(db); let lease = startTransition(db, intent);
    lease = changeTransitionAdmission(db, { lease, now: AT, action: "close" });
    lease = updateTransitionAttempt(db, { lease, now: AT, patch: { phase: "draining" } });
    lease = updateTransitionAttempt(db, { lease, now: AT, patch: { phase: "fenced" } });
    settleTransition(db, { lease, now: AT, result: { kind: "transition", transitionId: intent.transitionId, receiptId: null,
      authorityCommitted: false, runtime: "unavailable", queue: "settled", outcome: "outcome_unknown", errorCode: "MEMORY_TRANSITION_OUTCOME_UNKNOWN" } });
    let dispatched = 0; const service = createMemoryOperationService({ db, setup: fakeSetup(), live: () => null, bootId: "new", now: () => AT,
      logger: createLogger("fatal"), onChanged: () => {}, transition: { plan: () => ({ current: transitionIdentity(), actorId: "operator" }), execute: async () => { dispatched++; return null; } } });
    expect(service.status(intent.operationId)).toMatchObject({ state: "outcome_unknown", reason: "commitment_unknown" });
    expect(() => service.submit({ kind: "setup.validate", expectedRevision: 3 })).toThrow("MEMORY_OPERATION_BUSY");
    expect(readTransitionAttempt(db, intent.transitionId)?.phase).toBe("fenced");
    expect(() => db.prepare("UPDATE memory_transition_results SET result_json='{}'").run()).toThrow("IMMUTABLE");
    expect(dispatched).toBe(0); await service.stop();
  });
});

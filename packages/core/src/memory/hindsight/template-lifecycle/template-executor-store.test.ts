import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { MemoryOperation } from "@taki/shared";
import { createMemoryOperationRepo } from "../../../db/memory-operation-repo.ts";
import { quarantineEmergencyProducers } from "../../../db/memory-transition-emergency-quarantine.ts";
import type { Database } from "../../../db/sqlite.ts";
import { canonicalPayloadHash } from "../../legacy-migration/legacy-identities.ts";
import { readEmergencyTransitionIdentity } from "../../transitions/transition-current-identity.ts";
import { activeTemplateHold, readTemplateHold, readTemplatePublication } from "./template-execution-reads.ts";
import { assertTemplateExecutor, checkpointTemplateExecutor, claimTemplateExecutor, readTemplateExecutor,
  TEMPLATE_EXECUTOR_HEARTBEAT_MS, TEMPLATE_EXECUTOR_LEASE_MS, type TemplateExecutorLease } from "./template-executor-store.ts";
import { templateLifecycleFixture, type TemplateLifecycleFixture } from "./template-lifecycle-fixtures.ts";
import { recordTemplateBankReceipt, recordTemplateDispatch, recordTemplateObservation } from "./template-native-evidence-store.ts";
import { assertTemplateLocalPlan } from "./template-plan-guard.ts";
import type { TemplateObservation, TemplatePlan } from "./template-plan-schema.ts";
import { publishTemplatePlan } from "./template-publication.ts";
import { templateIdentityKey } from "./template-store-documents.ts";

const fixtures: TemplateLifecycleFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

async function admitted() {
  const f = templateLifecycleFixture(); fixtures.push(f);
  const operation = f.admit(await f.request());
  return { f, operation, plan: f.plan(operation) };
}
const operations = (f: TemplateLifecycleFixture) => createMemoryOperationRepo(f.db, () => f.state.now);
function claim(f: TemplateLifecycleFixture, operation: MemoryOperation) {
  return claimTemplateExecutor(f.db, { planId: f.plan(operation).planId, operationId: operation.operationId,
    bootId: f.state.bootId, now: f.state.now });
}
function start(f: TemplateLifecycleFixture, operation: MemoryOperation) {
  operations(f).transition({ operationId: operation.operationId, expectedState: "admitted", patch: { state: "running" } });
  return claim(f, operation);
}

/** Compare persisted state, including publication's readiness/default writes, without reconstructing store logic. */
function databaseImage(db: Database) {
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return Object.fromEntries(tables.map(({ name }) => {
    if (typeof name !== "string") throw new Error("fixture table name missing");
    return [name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()];
  }));
}

/** Native-shaped fixture evidence is prepared outside SQLite; the tests call actual Core writes separately. */
async function observations(f: TemplateLifecycleFixture, plan: TemplatePlan): Promise<TemplateObservation[]> {
  const client = f.native.client;
  if (!client.templateApply || !client.templateSnapshot) throw new Error("fixture template client missing");
  const result: TemplateObservation[] = [];
  for (const bank of plan.banks) {
    const receipt = await client.templateApply({ request: bank.preview.request, context: { timeoutMs: 1000 } });
    await f.deps.runtime.synchronize({ plan, bank, signal: new AbortController().signal,
      assertCurrent: () => assertTemplateLocalPlan(f.deps, { plan }) });
    const snapshot = await client.templateSnapshot({ request: { contract_version: "1.0.0", target: receipt.target,
      selectors: bank.preview.request.expected_snapshot.selectors }, context: { timeoutMs: 1000 } });
    result.push({ observationId: randomUUID(), planId: plan.planId, bankKey: templateIdentityKey(bank.identity),
      receipt, snapshot, children: [], verifiedAt: f.state.now });
  }
  return result;
}

function publish(f: TemplateLifecycleFixture, input: { plan: TemplatePlan; lease: TemplateExecutorLease; evidence: TemplateObservation[] }) {
  return publishTemplatePlan(f.db, { plan: input.plan, observations: input.evidence, manifest: f.native.manifest, committedAt: f.state.now,
    assertExecutor: () => assertTemplateExecutor(f.db, { lease: input.lease, now: f.state.now }),
    assertCurrent: (publication) => assertTemplateLocalPlan(f.deps, { plan: input.plan, publication: publication ?? undefined }) });
}

type Fault = "statement" | "commit";
function installFailure(db: Database, input: { fault: Fault; phase: "quiescing" | "settled" }): void {
  db.exec(`CREATE TABLE executor_test_parent(id TEXT PRIMARY KEY);
    CREATE TABLE executor_test_child(id TEXT REFERENCES executor_test_parent(id) DEFERRABLE INITIALLY DEFERRED)`);
  // The settled checkpoint is deliberately last, after nested receipt/publication writes have returned.
  db.exec(`CREATE TRIGGER executor_test_failure AFTER UPDATE ON hindsight_template_executors
    WHEN NEW.phase='${input.phase}' BEGIN ${input.fault === "commit"
      ? "INSERT INTO executor_test_child VALUES('missing')"
      : "SELECT RAISE(ABORT,'owned executor statement failure')"}; END`);
}

describe("durable template executor ownership and restart", () => {
  it("claims only an actual running admission with the same operation and boot", async () => {
    const { f, operation, plan } = await admitted();
    const initial = readTemplateExecutor(f.db, plan.planId);
    expect(initial).toMatchObject({ generation: 0, revision: 0, token: null, phase: "admitted" });
    expect(() => claim(f, operation)).toThrow("MEMORY_TEMPLATE_LEASE_LOST");
    expect(readTemplateExecutor(f.db, plan.planId)).toEqual(initial);
    operations(f).transition({ operationId: operation.operationId, expectedState: "admitted", patch: { state: "running" } });
    for (const identity of [{ operationId: randomUUID(), bootId: f.state.bootId },
      { operationId: operation.operationId, bootId: "unadmitted-boot" }]) {
      expect(() => claimTemplateExecutor(f.db, { planId: plan.planId, ...identity, now: f.state.now })).toThrow("MEMORY_TEMPLATE_LEASE_LOST");
      expect(readTemplateExecutor(f.db, plan.planId)).toEqual(initial);
    }
    const lease = claim(f, operation);
    expect(lease).toMatchObject({ generation: 1, revision: 1, operationId: operation.operationId, bootId: f.state.bootId,
      phase: "quiescing", deadlineMs: Date.parse(f.state.now) + TEMPLATE_EXECUTOR_LEASE_MS });
    expect(lease.token).toEqual(expect.any(String));
    expect(() => assertTemplateExecutor(f.db, { lease, now: f.state.now })).not.toThrow();
    expect(f.native.calls.some((call) => call.method === "apply")).toBe(false);
  });

  it("rejects another live same-boot claim and renews only the current checkpoint", async () => {
    const { f, operation, plan } = await admitted(); const lease = start(f, operation);
    const before = databaseImage(f.db);
    expect(() => claim(f, operation)).toThrow("MEMORY_TEMPLATE_LEASE_LOST");
    expect(databaseImage(f.db)).toEqual(before);
    f.state.now = new Date(Date.parse(f.state.now) + TEMPLATE_EXECUTOR_HEARTBEAT_MS).toISOString();
    const renewed = checkpointTemplateExecutor(f.db, { lease, now: f.state.now, phase: "applying" });
    expect(renewed).toMatchObject({ generation: lease.generation, revision: lease.revision + 1, token: lease.token,
      phase: "applying", deadlineMs: Date.parse(f.state.now) + TEMPLATE_EXECUTOR_LEASE_MS });
    expect(readTemplateExecutor(f.db, plan.planId)).toEqual(renewed);
    expect(() => checkpointTemplateExecutor(f.db, { lease, now: f.state.now })).toThrow("MEMORY_TEMPLATE_LEASE_LOST");
    expect(() => claim(f, operation)).toThrow("MEMORY_TEMPLATE_LEASE_LOST");
    expect(readTemplateExecutor(f.db, plan.planId)).toEqual(renewed);
  });

  it.each([0, 1])("cannot renew an owner at its deadline plus %i milliseconds", async (offset) => {
    const { f, operation, plan } = await admitted(); const lease = start(f, operation);
    f.state.now = new Date(lease.deadlineMs + offset).toISOString(); const before = databaseImage(f.db);
    expect(() => assertTemplateExecutor(f.db, { lease, now: f.state.now })).toThrow("MEMORY_TEMPLATE_LEASE_LOST");
    expect(() => checkpointTemplateExecutor(f.db, { lease, now: f.state.now, phase: "applying" })).toThrow("MEMORY_TEMPLATE_LEASE_LOST");
    expect(databaseImage(f.db)).toEqual(before);
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("active");
  });

  it.each(["failed", "outcome_unknown"] as const)("takes over an expired plan while retaining its generic %s outcome", async (state) => {
    const { f, operation, plan } = await admitted(); const oldLease = start(f, operation);
    recordTemplateDispatch(f.db, { lease: oldLease, bank: plan.banks[0]!, now: f.state.now });
    f.state.now = new Date(oldLease.deadlineMs).toISOString();
    const terminal = operations(f).transition({ operationId: operation.operationId, expectedState: "running", patch: {
      state, reason: state === "failed" ? "producer_failed" : "commitment_unknown", errorCode: "MEMORY_TEMPLATE_OUTCOME_UNKNOWN" } });
    const recovery = f.admit({ kind: "template.recover", requestId: randomUUID(), planId: plan.planId });
    const lease = start(f, recovery);
    expect(lease).toMatchObject({ generation: oldLease.generation + 1, revision: oldLease.revision + 1,
      operationId: recovery.operationId, bootId: f.state.bootId });
    expect(lease.token).not.toBe(oldLease.token);
    expect(f.plan(recovery)).toEqual(plan);
    expect(f.plan(recovery).banks.map((bank) => bank.preview.request)).toEqual(plan.banks.map((bank) => bank.preview.request));
    expect(operations(f).get(operation.operationId)).toEqual(terminal);
    expect(readTemplateHold(f.db, plan.planId)).toMatchObject({ state: "active", originalOperationId: operation.operationId });
    expect(() => checkpointTemplateExecutor(f.db, { lease: oldLease, now: f.state.now })).toThrow("MEMORY_TEMPLATE_LEASE_LOST");
    expect(f.native.calls.some((call) => call.method === "apply")).toBe(false);
  });

  it("retains a possible-effect hold on physical reopen and claims only explicit same-plan recovery on the new boot", async () => {
    const { f, operation, plan } = await admitted(); const oldLease = start(f, operation); const oldDb = f.db;
    recordTemplateDispatch(f.db, { lease: oldLease, bank: plan.banks[0]!, now: f.state.now });
    const calls = structuredClone(f.native.calls); const hold = readTemplateHold(f.db, plan.planId);
    await f.reopen();
    expect(f.db).not.toBe(oldDb); expect(f.state.bootId).not.toBe(oldLease.bootId);
    expect(Date.parse(f.state.now)).toBeLessThan(oldLease.deadlineMs);
    const unknown = operations(f).get(operation.operationId)!;
    expect(unknown).toMatchObject({ state: "outcome_unknown", reason: "commitment_unknown", result: { outcome: "outcome_unknown" } });
    expect(readTemplateHold(f.db, plan.planId)).toEqual(hold);
    expect(activeTemplateHold(f.db, plan.guard.epochId)).toEqual(hold);
    expect(f.plan(operation)).toEqual(plan); expect(f.native.calls).toEqual(calls);
    expect(readTemplateExecutor(f.db, plan.planId)).toEqual(oldLease);
    expect(() => claim(f, operation)).toThrow("MEMORY_TEMPLATE_LEASE_LOST");
    const recovery = f.admit({ kind: "template.recover", requestId: randomUUID(), planId: plan.planId });
    expect(() => claim(f, recovery)).toThrow("MEMORY_TEMPLATE_LEASE_LOST");
    const lease = start(f, recovery);
    expect(lease).toMatchObject({ generation: oldLease.generation + 1, revision: oldLease.revision + 1,
      bootId: f.state.bootId, operationId: recovery.operationId, phase: "quiescing" });
    expect(lease.token).not.toBe(oldLease.token); expect(f.plan(recovery)).toEqual(plan);
    expect(operations(f).get(operation.operationId)).toEqual(unknown);
    expect(f.native.calls).toEqual(calls); expect(readTemplateHold(f.db, plan.planId)).toEqual(hold);
    expect(() => checkpointTemplateExecutor(f.db, { lease: oldLease, now: f.state.now })).toThrow("MEMORY_TEMPLATE_LEASE_LOST");
  });

  it("cannot claim a plan cancelled through the real operation owner", async () => {
    const { f, operation, plan } = await admitted();
    const cancelled = f.owner.cancel(operation.operationId);
    expect(cancelled.state).toBe("cancelled"); expect(readTemplateHold(f.db, plan.planId)?.state).toBe("cancelled");
    const before = databaseImage(f.db);
    expect(() => claim(f, operation)).toThrow("MEMORY_TEMPLATE_LEASE_LOST");
    expect(() => f.admit({ kind: "template.recover", requestId: randomUUID(), planId: plan.planId })).toThrow("MEMORY_TEMPLATE_CONFLICT");
    expect(databaseImage(f.db)).toEqual(before);
  });

  it("cannot reclaim or checkpoint a plan quarantined by the actual W6 store", async () => {
    const { f, operation, plan } = await admitted(); const lease = start(f, operation);
    recordTemplateDispatch(f.db, { lease, bank: plan.banks[0]!, now: f.state.now });
    const expected = readEmergencyTransitionIdentity(f.db);
    const emergencyId = randomUUID(); const requestId = randomUUID(); const kind = "transition.emergency-local";
    const repo = operations(f);
    // This is the real quarantine/operation transaction boundary. Full emergency preview and takeover
    // execution are exercised by the lifecycle owner's tests, not by this executor storage case.
    f.db.transaction(() => {
      quarantineEmergencyProducers(f.db, { repo, emergencyOperationId: emergencyId, epochId: plan.guard.epochId,
        bankIds: plan.banks.map((bank) => bank.identity.target.bank_id), now: f.state.now });
      repo.insertAdmitted({ operationId: emergencyId, kind, family: "memory-transition", authorityEpochId: plan.guard.epochId,
        bootId: f.state.bootId, request: { kind, requestId, previewId: randomUUID(), expected,
          previewHash: canonicalPayloadHash(["taki-transition-preview.v1", kind, expected]), confirmation: "emergency-takeover" },
        producer: { kind: "transition", transitionId: randomUUID(), requestId } });
    });
    expect(repo.get(emergencyId)).toMatchObject({ kind, state: "admitted" });
    expect(repo.get(operation.operationId)).toMatchObject({ state: "outcome_unknown", reason: "commitment_unknown" });
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("quarantined");
    expect(readTemplateExecutor(f.db, plan.planId)).toEqual(lease);
    const before = databaseImage(f.db);
    expect(() => claim(f, operation)).toThrow("MEMORY_TEMPLATE_QUARANTINED");
    expect(() => checkpointTemplateExecutor(f.db, { lease, now: f.state.now })).toThrow("MEMORY_TEMPLATE_QUARANTINED");
    expect(() => f.admit({ kind: "template.recover", requestId: randomUUID(), planId: plan.planId })).toThrow("MEMORY_TEMPLATE_QUARANTINED");
    expect(databaseImage(f.db)).toEqual(before); expect(f.plan(operation)).toEqual(plan);
    expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it.each(["token", "revision"] as const)("a stale %s cannot checkpoint, write evidence or release the hold", async (field) => {
    const { f, operation, plan } = await admitted(); const original = start(f, operation);
    const evidence = await observations(f, plan);
    const current = field === "revision" ? checkpointTemplateExecutor(f.db, { lease: original, now: f.state.now }) : original;
    const stale = field === "token" ? { ...original, token: randomUUID() } : original;
    const bank = plan.banks[0]!; const first = evidence[0]!; const before = databaseImage(f.db);
    const attempts = [
      () => checkpointTemplateExecutor(f.db, { lease: stale, now: f.state.now }),
      () => recordTemplateDispatch(f.db, { lease: stale, bank, now: f.state.now }),
      () => recordTemplateBankReceipt(f.db, { lease: stale, bank, receipt: first.receipt, now: f.state.now }),
      () => recordTemplateObservation(f.db, { lease: stale, bank, observation: first, now: f.state.now }),
      () => publish(f, { plan, lease: stale, evidence }),
    ];
    for (const attempt of attempts) {
      expect(attempt).toThrow("MEMORY_TEMPLATE_LEASE_LOST"); expect(databaseImage(f.db)).toEqual(before);
    }
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("active"); expect(readTemplatePublication(f.db, plan.planId)).toBeNull();
    // Valid evidence and the current lease succeed, so refusal above cannot be attributed to a broken fixture.
    recordTemplateBankReceipt(f.db, { lease: current, bank, receipt: first.receipt, now: f.state.now });
    expect(publish(f, { plan, lease: current, evidence }).planId).toBe(plan.planId);
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("published");
  });

  it.each(["statement", "commit"] as const)("rolls back operation claim and executor acquisition on real SQLite %s failure", async (fault) => {
    const { f, operation, plan } = await admitted(); installFailure(f.db, { fault, phase: "quiescing" });
    const before = databaseImage(f.db); let callbackFinished = false;
    expect(() => f.db.transaction(() => { start(f, operation); callbackFinished = true; })).toThrow(fault === "commit"
      ? "FOREIGN KEY constraint failed" : "owned executor statement failure");
    expect(callbackFinished).toBe(fault === "commit"); expect(databaseImage(f.db)).toEqual(before);
    expect(operations(f).get(operation.operationId)?.state).toBe("admitted");
    expect(readTemplateExecutor(f.db, plan.planId)).toMatchObject({ generation: 0, revision: 0, token: null });
    f.db.exec("DROP TRIGGER executor_test_failure");
    expect(start(f, operation).generation).toBe(1); expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it.each(["statement", "commit"] as const)("rolls back all executor evidence and hold publication on real SQLite %s failure", async (fault) => {
    const { f, operation, plan } = await admitted(); const lease = start(f, operation);
    const evidence = await observations(f, plan); installFailure(f.db, { fault, phase: "settled" });
    const before = databaseImage(f.db); let callbackFinished = false;
    const mutate = () => {
      const next = checkpointTemplateExecutor(f.db, { lease, now: f.state.now, phase: "publishing" });
      for (const [index, bank] of plan.banks.entries()) {
        recordTemplateDispatch(f.db, { lease: next, bank, now: f.state.now });
        recordTemplateBankReceipt(f.db, { lease: next, bank, receipt: evidence[index]!.receipt, now: f.state.now });
        recordTemplateObservation(f.db, { lease: next, bank, observation: evidence[index]!, now: f.state.now });
      }
      publish(f, { plan, lease: next, evidence });
      checkpointTemplateExecutor(f.db, { lease: next, now: f.state.now, phase: "settled", finish: true });
      callbackFinished = true;
    };
    expect(() => f.db.transaction(mutate)).toThrow(fault === "commit" ? "FOREIGN KEY constraint failed" : "owned executor statement failure");
    expect(callbackFinished).toBe(fault === "commit"); expect(databaseImage(f.db)).toEqual(before);
    expect(readTemplateExecutor(f.db, plan.planId)).toEqual(lease);
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("active"); expect(readTemplatePublication(f.db, plan.planId)).toBeNull();
    f.db.exec("DROP TRIGGER executor_test_failure");
    expect(() => f.db.transaction(mutate)).not.toThrow();
    expect(readTemplateExecutor(f.db, plan.planId)).toMatchObject({ generation: lease.generation,
      revision: lease.revision + 2, phase: "settled", deadlineMs: 0 });
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("published");
    expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

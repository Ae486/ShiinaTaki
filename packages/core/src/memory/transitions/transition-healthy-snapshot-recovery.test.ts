import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TakiApplicationReadBundleManifest, TakiApplicationSnapshotRequest } from "@taki/shared";
import { createHealthyTransitionHarness, composeHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { addHealthyUnusedBank } from "../../testing/memory-transition-healthy-journey-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createTimelineRepo } from "../../db/timeline-repo.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { HindsightApplicationRefusal } from "../hindsight/hindsight-application-client.ts";
import { HindsightTransitionRefusal } from "../hindsight/hindsight-transition-client.ts";
import { hindsightApplicationHash } from "../hindsight/hindsight-application-integrity.ts";
import { hindsightTransitionHash } from "../hindsight/hindsight-transition-proof.ts";
import { prepareTransitionNativeCommand } from "../../db/memory-transition-driver-repo.ts";
import * as candidateModule from "./transition-healthy-candidate.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

type Harness = Awaited<ReturnType<typeof createHealthyTransitionHarness>>;
type Composed = ReturnType<typeof composeHealthyTransitionHarness>;

/** Native snapshot.py's same-request and page TTL contract, with real typed refusals and hashed bundles. */
function inventorySnapshots(h: Harness, bankId: string) {
  const create = h.remote.client.createApplicationSnapshot!;
  const page = h.remote.client.applicationSnapshotPage!;
  const history = new Map<string, { request: TakiApplicationSnapshotRequest; manifest: TakiApplicationReadBundleManifest; originalId: string }>();
  const calls: string[] = []; const expired: string[] = []; const pageCalls: string[] = [];
  let clockOffset = 0;
  const fault: { loseReply: boolean; expirePages: number; refusal?: Error; onExpiry?: () => void;
    beforeCreate?: (request: TakiApplicationSnapshotRequest) => void } = { loseReply: false, expirePages: 0 };
  const now = () => Date.now() + clockOffset;
  const check = (manifest: TakiApplicationReadBundleManifest) => {
    if (Date.parse(manifest.expires_at) > now()) return;
    expired.push(manifest.request_id);
    fault.onExpiry?.();
    throw new HindsightApplicationRefusal({ error: "application_state_error", code: "snapshot_expired", detail: "snapshot_expired" });
  };
  vi.spyOn(h.remote.client, "createApplicationSnapshot").mockImplementation(async (input) => {
    if (input.bankId !== bankId) return create(input);
    const request = input.request; calls.push(request.request_id);
    expect(request.ttl_seconds).toBe(600);
    fault.beforeCreate?.(request);
    if (fault.refusal) throw fault.refusal;
    let saved = history.get(request.request_id);
    if (saved) { expect(saved.request).toEqual(request); check(saved.manifest); }
    else {
      const original = await create(input);
      expect(request.namespace).toEqual(original.namespace);
      const manifest = { ...original, request_id: request.request_id, snapshot_id: randomUUID(),
        created_at: new Date(now()).toISOString(), expires_at: new Date(now() + request.ttl_seconds * 1000).toISOString() };
      manifest.manifest_hash = hindsightApplicationHash({ bankId, namespace: request.namespace, domain: "snapshot",
        value: Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "manifest_hash")) });
      saved = { request: structuredClone(request), manifest, originalId: original.snapshot_id! };
      history.set(request.request_id, saved);
    }
    if (fault.loseReply) { fault.loseReply = false; throw new Error("owned snapshot response loss after materialization"); }
    return structuredClone(saved.manifest);
  });
  vi.spyOn(h.remote.client, "applicationSnapshotPage").mockImplementation(async (input) => {
    const saved = [...history.values()].find((value) => value.manifest.snapshot_id === input.snapshotId);
    if (!saved) return page(input);
    pageCalls.push(saved.manifest.request_id);
    if (fault.expirePages > 0) { fault.expirePages--; clockOffset += 601_000; }
    check(saved.manifest);
    return page({ ...input, snapshotId: saved.originalId });
  });
  return { history, calls, expired, pageCalls, fault };
}

function commands(db: Database, transitionId: string) {
  return db.prepare("SELECT * FROM memory_transition_native_commands WHERE transition_id=:id AND kind='application-snapshot' ORDER BY slot")
    .all({ id: transitionId });
}
function preparations(db: Database, transitionId: string) {
  return db.prepare("SELECT * FROM memory_transition_preparations WHERE transition_id=:id ORDER BY slot").all({ id: transitionId });
}
async function returnedHarness() {
  const h = await createHealthyTransitionHarness();
  const returned = h.owner.submit(await h.request()); await h.owner.stop();
  expect(h.owner.status(returned.operationId).state).toBe("completed");
  // Native Bank IDs determine iteration order; the first new Bank must finish preparation before the fault.
  addHealthyUnusedBank(h, "aa-unused");
  addHealthyUnusedBank(h, "zz-unused");
  return h;
}
async function reopen(h: Harness, current: { db: Database; composed: Composed }) {
  await current.composed.stop(); await h.utility.stop(); current.db.close();
  current.db = openDatabase({ path: join(h.dataDir, "memory.sqlite"), migrations: MIGRATIONS });
  h.remote.reconnectDatabase(current.db);
  current.composed = composeHealthyTransitionHarness({ db: current.db, dataDir: h.dataDir,
    timeline: createTimelineRepo(current.db), remote: h.remote, clock: h.clock });
}
function elapse(h: Harness, seconds: number, expireProven = false) {
  h.clock.value = new Date(Date.parse(h.clock.value) + seconds * 1000).toISOString(); vi.setSystemTime(h.clock.value);
  for (const status of h.remote.status.values()) if (!status.outcome && (!status.proof || expireProven)) status.executor_live = false;
}

describe("unused inventory snapshot recovery through the complete healthy driver", () => {
  it("dispatches with the renewed Native executor after expiry claims a new fence during inventory loading", async () => {
    const h = await returnedHarness(); const snapshots = inventorySnapshots(h, "native-zz-unused"); snapshots.fault.expirePages = 1;
    snapshots.fault.onExpiry = () => {
      const status = [...h.remote.status.values()].find((value) => value.bank_id === "native-zz-unused" && !value.outcome)!;
      status.executor_live = false;
    };
    const apply = h.remote.client.applyTransitionDelta!; const refused: string[] = [];
    vi.spyOn(h.remote.client, "applyTransitionDelta").mockImplementation(async (input) => {
      // Native transfer/transition_delta.py::_admit requires the exact live executor before a first apply.
      const status = [...h.remote.status.values()].find((value) => value.bank_id === input.bankId
        && value.request.transition_id === input.request.executor.transition_id)!;
      if (!status.executor_live || hindsightTransitionHash(status.executor) !== hindsightTransitionHash(input.request.executor)) {
        refused.push(input.bankId);
        throw new HindsightTransitionRefusal({ error: "taki_transition_refused", reason: "executor_lost" });
      }
      return apply(input);
    });
    try {
      const original = h.owner.submit(await h.request(undefined, "transition.reenter-hindsight")); await h.owner.stop();
      expect(h.owner.status(original.operationId).state, refused.join(",")).toBe("completed");
      expect(refused).toEqual([]); expect(snapshots.history.size).toBe(2); expect(h.remote.calls.claim).toBe(1);
      expect(h.remote.calls.delta).toBe(4);
    } finally { await h.close(); }
  }, 30_000);

  it("reopens after losing a renewed reply, reuses that durable request and never repeats an earlier delta", async () => {
    const h = await returnedHarness(); const current = { db: h.db, composed: h as Composed };
    const snapshots = inventorySnapshots(h, "native-zz-unused"); snapshots.fault.loseReply = true;
    const delta = vi.spyOn(h.remote.client, "applyTransitionDelta");
    snapshots.fault.beforeCreate = (request) => {
      const command = current.db.prepare(`SELECT c.id FROM memory_transition_native_commands c
        JOIN memory_transition_native_dispatches d ON d.command_id=c.id WHERE json_extract(c.body_json,'$.request.request_id')=:id`)
        .get({ id: request.request_id });
      expect(command).toBeDefined();
    };
    try {
      const original = h.owner.submit(await h.request(undefined, "transition.reenter-hindsight")); await h.owner.stop();
      const transitionId = original.producer?.kind === "transition" ? original.producer.transitionId : "";
      expect(h.owner.status(original.operationId).state).toBe("outcome_unknown");
      const savedPreparations = preparations(h.db, transitionId); const savedCommands = commands(h.db, transitionId);
      const savedEvidence = h.db.prepare("SELECT * FROM memory_transition_native_evidence WHERE transition_id=:id").all({ id: transitionId });
      elapse(h, 601, true); await reopen(h, current); snapshots.fault.loseReply = true;
      const lostRenewal = current.composed.owner.submit(await current.composed.request(transitionId, "transition.reenter-hindsight"));
      await current.composed.owner.stop();
      expect(current.composed.owner.status(lostRenewal.operationId).state).toBe("outcome_unknown");
      expect(snapshots.history.size).toBe(2); expect(snapshots.expired).toHaveLength(1);
      const renewedCommands = commands(current.db, transitionId); expect(renewedCommands).toHaveLength(savedCommands.length + 1);
      expect(renewedCommands).toEqual(expect.arrayContaining(savedCommands));
      const newRequestId = snapshots.calls.at(-1)!;
      elapse(h, 301, true); await reopen(h, current);
      const recovery = current.composed.owner.submit(await current.composed.request(transitionId, "transition.reenter-hindsight"));
      await current.composed.owner.stop();
      expect(current.composed.owner.status(recovery.operationId).state).toBe("completed");
      expect(snapshots.calls).toEqual([snapshots.calls[0], snapshots.calls[0], newRequestId, newRequestId]);
      expect(snapshots.history.size).toBe(2);
      expect(commands(current.db, transitionId)).toEqual(renewedCommands);
      expect(preparations(current.db, transitionId)).toEqual(expect.arrayContaining(savedPreparations));
      expect(current.db.prepare("SELECT * FROM memory_transition_native_evidence WHERE transition_id=:id").all({ id: transitionId }))
        .toEqual(expect.arrayContaining(savedEvidence));
      expect(delta.mock.calls.filter(([input]) => input.bankId === "native-aa-unused")).toHaveLength(1);
      expect(delta.mock.calls).toHaveLength(4);
      expect(current.composed.owner.status(original.operationId).state).toBe("outcome_unknown");
      expect(current.composed.owner.status(lostRenewal.operationId).state).toBe("outcome_unknown");
    } finally { await current.composed.stop(); await h.utility.stop(); current.db.close(); rmTempDir(h.dataDir); }
  }, 40_000);

  it.each([1, 2])("renews an expired page with at most one successor per invocation (%s consecutive expiries)", async (expiries) => {
    const h = await returnedHarness(); const current = { db: h.db, composed: h as Composed };
    const snapshots = inventorySnapshots(h, "native-zz-unused"); snapshots.fault.expirePages = expiries;
    try {
      const original = h.owner.submit(await h.request(undefined, "transition.reenter-hindsight")); await h.owner.stop();
      const transitionId = original.producer?.kind === "transition" ? original.producer.transitionId : "";
      expect(snapshots.calls).toHaveLength(2); expect(snapshots.history.size).toBe(2);
      expect(snapshots.expired).toHaveLength(expiries);
      expect(snapshots.pageCalls).toEqual(snapshots.calls);
      if (expiries === 1) expect(h.owner.status(original.operationId).state).toBe("completed");
      else {
        expect(h.owner.status(original.operationId).state).toBe("outcome_unknown");
        expect(commands(h.db, transitionId)).toHaveLength(3);
        const previous = preparations(h.db, transitionId);
        elapse(h, 301, true); await reopen(h, current);
        const recovery = current.composed.owner.submit(await current.composed.request(transitionId, "transition.reenter-hindsight"));
        await current.composed.owner.stop();
        expect(current.composed.owner.status(recovery.operationId).state).toBe("completed");
        expect(snapshots.calls).toHaveLength(4); expect(snapshots.history.size).toBe(3);
        expect(snapshots.calls[2]).toBe(snapshots.calls[1]);
        expect(preparations(current.db, transitionId)).toEqual(expect.arrayContaining(previous));
      }
    } finally { await current.composed.stop(); await h.utility.stop(); current.db.close(); rmTempDir(h.dataDir); }
  }, 40_000);

  it.each(["snapshot_not_found", "request_id_conflict", "namespace_mismatch", "untyped_expiry"] as const)(
    "does not renew on %s", async (code) => {
      const h = await returnedHarness(); const snapshots = inventorySnapshots(h, "native-zz-unused");
      snapshots.fault.refusal = code === "untyped_expiry" ? new Error("HINDSIGHT_APPLICATION_SNAPSHOT_EXPIRED")
        : new HindsightApplicationRefusal({ error: "application_state_error", code, detail: code });
      try {
        const original = h.owner.submit(await h.request(undefined, "transition.reenter-hindsight")); await h.owner.stop();
        const transitionId = original.producer?.kind === "transition" ? original.producer.transitionId : "";
        expect(h.owner.status(original.operationId).state).toBe("outcome_unknown");
        expect(snapshots.calls).toHaveLength(1); expect(snapshots.history.size).toBe(0);
        expect(commands(h.db, transitionId).filter((row) => row.bank_id === "native-zz-unused")).toHaveLength(1);
        expect(h.db.prepare("SELECT count(*) n FROM memory_transition_receipts WHERE transition_id=:id").get({ id: transitionId })?.n).toBe(0);
      } finally { await h.close(); }
    }, 30_000);

  it("refuses a saved snapshot command for another namespace before dispatch", async () => {
    const h = await returnedHarness(); const snapshots = inventorySnapshots(h, "native-zz-unused");
    const prepare = candidateModule.prepareHealthyTransitionCandidate;
    vi.spyOn(candidateModule, "prepareHealthyTransitionCandidate").mockImplementationOnce(async (input) => {
      const status = await input.native.fence("native-zz-unused");
      prepareTransitionNativeCommand(input.db, { ...input.work(), command: { kind: "application-snapshot", bankId: status.bank_id,
        slot: "unused-inventory", request: { namespace: { application_id: "taki", provider_lineage: randomUUID(),
          bank_generation: status.request.bank_generation }, request_id: randomUUID(), ttl_seconds: 600 } } });
      return prepare(input);
    });
    try {
      const original = h.owner.submit(await h.request(undefined, "transition.reenter-hindsight")); await h.owner.stop();
      expect(h.owner.status(original.operationId).state).toBe("outcome_unknown");
      expect(snapshots.calls).toEqual([]);
    } finally { await h.close(); }
  }, 30_000);

  it.each(["active-writer", "lost-claim", "core-configuration"] as const)("refuses renewal after %s invalidates ownership", async (guard) => {
    const h = await returnedHarness(); const snapshots = inventorySnapshots(h, "native-zz-unused"); snapshots.fault.expirePages = 1;
    snapshots.fault.onExpiry = () => {
      const status = [...h.remote.status.values()].find((value) => value.bank_id === "native-zz-unused" && !value.outcome)!;
      if (guard === "active-writer") status.active_writers = 1;
      else if (guard === "lost-claim") {
        status.executor_live = false;
        vi.spyOn(h.remote.client, "claimTransition").mockRejectedValueOnce(new HindsightTransitionRefusal({
          error: "taki_transition_refused", reason: "executor_lost" }));
      } else h.db.prepare("UPDATE hindsight_connection_state SET config_fingerprint=:value WHERE singleton=1").run({ value: "f".repeat(64) });
    };
    try {
      const original = h.owner.submit(await h.request(undefined, "transition.reenter-hindsight")); await h.owner.stop();
      const transitionId = original.producer?.kind === "transition" ? original.producer.transitionId : "";
      expect(h.owner.status(original.operationId).state).toBe("outcome_unknown");
      expect(snapshots.calls).toHaveLength(1); expect(snapshots.expired).toHaveLength(1);
      expect(commands(h.db, transitionId).filter((row) => row.bank_id === "native-zz-unused")).toHaveLength(1);
    } finally { await h.close(); }
  }, 30_000);

  it("refuses changed sealed proof after reopening instead of reusing incompatible historical evidence", async () => {
    const h = await returnedHarness(); const current = { db: h.db, composed: h as Composed };
    const snapshots = inventorySnapshots(h, "native-zz-unused"); snapshots.fault.loseReply = true;
    try {
      const original = h.owner.submit(await h.request(undefined, "transition.reenter-hindsight")); await h.owner.stop();
      const transitionId = original.producer?.kind === "transition" ? original.producer.transitionId : "";
      const evidence = h.db.prepare("SELECT * FROM memory_transition_native_evidence WHERE transition_id=:id").all({ id: transitionId });
      expect(evidence).toHaveLength(1);
      const status = [...h.remote.status.values()].find((value) => value.bank_id === "native-aa-unused" && !value.outcome)!;
      status.proof!.native_snapshot.expires_at = "2026-10-02T00:00:00.000Z";
      status.proof!.proof_hash = hindsightTransitionHash({ domain: "transition-proof.v1",
        proof: Object.fromEntries(Object.entries(status.proof!).filter(([field]) => field !== "proof_hash")) });
      elapse(h, 301, true); await reopen(h, current);
      const recovery = current.composed.owner.submit(await current.composed.request(transitionId, "transition.reenter-hindsight"));
      await current.composed.owner.stop();
      expect(current.composed.owner.status(recovery.operationId).state).toBe("outcome_unknown");
      expect(snapshots.calls).toHaveLength(1);
      expect(current.db.prepare("SELECT * FROM memory_transition_native_evidence WHERE transition_id=:id").all({ id: transitionId })).toEqual(evidence);
    } finally { await current.composed.stop(); await h.utility.stop(); current.db.close(); rmTempDir(h.dataDir); }
  }, 30_000);

  it("reuses sealed evidence after a proven Bank executor expires and is claimed by the reopened Core", async () => {
    const h = await returnedHarness(); const current = { db: h.db, composed: h as Composed };
    const snapshots = inventorySnapshots(h, "native-zz-unused"); snapshots.fault.loseReply = true;
    const errors: string[] = []; const prepare = candidateModule.prepareHealthyTransitionCandidate;
    vi.spyOn(candidateModule, "prepareHealthyTransitionCandidate").mockImplementation(async (input) => {
      try { return await prepare(input); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); throw error; }
    });
    try {
      const original = h.owner.submit(await h.request(undefined, "transition.reenter-hindsight")); await h.owner.stop();
      const transitionId = original.producer?.kind === "transition" ? original.producer.transitionId : "";
      expect(h.owner.status(original.operationId).state).toBe("outcome_unknown");
      const evidence = h.db.prepare("SELECT * FROM memory_transition_native_evidence WHERE transition_id=:id").all({ id: transitionId });
      expect(evidence).toHaveLength(1);
      elapse(h, 301, true); await reopen(h, current);
      const recovery = current.composed.owner.submit(await current.composed.request(transitionId, "transition.reenter-hindsight"));
      await current.composed.owner.stop();
      expect(current.composed.owner.status(recovery.operationId).state, errors.join("\n")).toBe("completed");
      expect(snapshots.expired).toEqual([]); expect(snapshots.history.size).toBe(1);
      expect(current.db.prepare("SELECT * FROM memory_transition_native_evidence WHERE transition_id=:id").all({ id: transitionId }))
        .toEqual(expect.arrayContaining(evidence));
      expect(h.remote.calls.claim).toBe(4);
    } finally { await current.composed.stop(); await h.utility.stop(); current.db.close(); rmTempDir(h.dataDir); }
  }, 30_000);

  it("renews a positively expired snapshot after earlier delta preparation and physical Core reconstruction", async () => {
    const h = await returnedHarness(); const current = { db: h.db, composed: h as Composed };
    const snapshots = inventorySnapshots(h, "native-zz-unused"); snapshots.fault.loseReply = true;
    const candidateErrors: string[] = []; const prepare = candidateModule.prepareHealthyTransitionCandidate;
    vi.spyOn(candidateModule, "prepareHealthyTransitionCandidate").mockImplementation(async (input) => {
      try { return await prepare(input); } catch (error) { candidateErrors.push(error instanceof Error ? error.stack! : String(error)); throw error; }
    });
    try {
      const original = h.owner.submit(await h.request(undefined, "transition.reenter-hindsight")); await h.owner.stop();
      const transitionId = original.producer?.kind === "transition" ? original.producer.transitionId : "";
      expect(h.owner.status(original.operationId).state, JSON.stringify({ records: h.records, calls: snapshots.calls, preparations: preparations(h.db, transitionId) })).toBe("outcome_unknown");
      const previous = preparations(h.db, transitionId); const originalCommands = commands(h.db, transitionId);
      expect(previous.length).toBeGreaterThan(0);
      expect(previous.some((row) => row.slot === "local-zz-unused")).toBe(false);
      expect(originalCommands).toHaveLength(2); expect(snapshots.history.size).toBe(1);
      expect(h.db.prepare("SELECT count(*) n FROM memory_transition_native_commands WHERE transition_id=:id AND kind='decision'").get({ id: transitionId })?.n).toBe(0);
      const deltaCalls = h.remote.calls.delta;
      elapse(h, 601); await reopen(h, current);
      const recovery = current.composed.owner.submit(await current.composed.request(transitionId, "transition.reenter-hindsight"));
      await current.composed.owner.stop();
      expect(snapshots.expired, JSON.stringify({ candidateErrors, calls: snapshots.calls, records: current.composed.records,
        operation: current.composed.owner.status(recovery.operationId) })).toHaveLength(1);
      expect(current.composed.owner.status(recovery.operationId).state).toBe("completed");
      expect(snapshots.history.size).toBe(2);
      expect(commands(current.db, transitionId)).toEqual(expect.arrayContaining(originalCommands));
      expect(preparations(current.db, transitionId)).toEqual(expect.arrayContaining(previous));
      expect(h.remote.calls.delta).toBe(deltaCalls + 3);
      expect(current.composed.owner.status(original.operationId).state).toBe("outcome_unknown");
      expect(current.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { await current.composed.stop(); await h.utility.stop(); current.db.close(); rmTempDir(h.dataDir); }
  }, 30_000);
});

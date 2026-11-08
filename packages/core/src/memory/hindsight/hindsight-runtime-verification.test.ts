import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfigSource } from "../../config/config-source.ts";
import { createConfigRepo } from "../../db/config-repo.ts";
import { loadMemoryConfig } from "../../config/memory-config.ts";
import { readVerifiedTransitionPublication } from "../../db/memory-transition-publication-reader.ts";
import { publishMemoryTransition } from "../../db/memory-transition-publication-repo.ts";
import { readTransitionAttempt } from "../../db/memory-transition-repo.ts";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { hindsightFixtureSecrets } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { applicationTestEvent } from "../../testing/hindsight-application-fixtures.ts";
import { applicationCheckpointHash, readApplicationCheckpoint } from "../../db/hindsight-application-replica-checkpoint.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import * as native from "../transitions/transition-native-evidence.ts";
import { createHindsightRuntimeConnection } from "./hindsight-runtime-connection.ts";
import { createHindsightRuntimeState } from "./hindsight-runtime-state.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function fixture(reenter = true) {
  const h = await createHealthyTransitionHarness();
  try {
    if (reenter) for (const kind of ["transition.return-local", "transition.reenter-hindsight"] as const) {
      const operation = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
      expect(h.owner.status(operation.operationId).state).toBe("completed");
    }
    await h.runtime.stop();
    const epochId = readMemoryAuthoritySelection(h.db).epochId!;
    const config = createConfigRepo(h.db);
    config.upsert("TAKI_HINDSIGHT_ENABLED", true);
    config.upsert("TAKI_HINDSIGHT_ENDPOINT", "http://127.0.0.1:18481");
    const source = createConfigSource({ repo: config, env: {} });
    const secrets = hindsightFixtureSecrets();
    const connect = (templateExecution?: Parameters<typeof createHindsightRuntimeConnection>[0]["templateExecution"]) =>
      createHindsightRuntimeConnection({ db: h.db, epochId, config: source,
        secrets: secrets.catalog, client: h.remote.client, templateExecution });
    return { ...h, epochId, config, connect };
  } catch (error) { await h.close(); throw error; }
}

describe("runtime current authority and full binding verification", () => {
  it("fully verifies actual REENTRY at construction and keeps cold and warm ordinary guards free of history", async () => {
    const f = await fixture();
    const verify = vi.spyOn(native, "verifyTransitionNativeEvidence");
    const runtime = f.connect();
    try {
      const cold = verify.mock.calls.length; expect(cold).toBeGreaterThan(0);
      const marker = f.db.prepare("SELECT * FROM memory_authority_selection").get()!;
      const publication = readVerifiedTransitionPublication(f.db, String(marker.transition_receipt_id));
      verify.mockClear();
      const reads = vi.spyOn(f.db, "prepare");
      runtime.assertConnection(); runtime.banks(); runtime.driftReason();
      expect(verify).not.toHaveBeenCalled();
      expect(reads.mock.calls.map(([sql]) => sql).filter((sql) => /memory_transition_(candidates|native_evidence|captures)/.test(sql))).toEqual([]);
      reads.mockRestore();
      for (const read of [() => readMemoryAuthoritySelection(f.db),
        () => readVerifiedTransitionPublication(f.db, String(marker.transition_receipt_id)),
        () => publishMemoryTransition(f.db, { lease: readTransitionAttempt(f.db, publication.transitionId)!,
          candidateId: publication.candidateId, now: W3_AT, currentTime: () => W3_AT, assertConfiguration: () => undefined })]) {
        verify.mockClear(); read(); expect(verify).toHaveBeenCalled();
      }
      runtime.stop(); expect(() => runtime.assertConnection()).toThrow("MEMORY_OPERATION_CANCELLED");
      verify.mockClear(); const replacement = f.connect();
      try {
        expect(verify).toHaveBeenCalledTimes(cold); verify.mockClear();
        replacement.assertConnection(); expect(verify).not.toHaveBeenCalled();
      }
      finally { replacement.stop(); }
    } finally { runtime.stop(); await f.close(); }
  }, 30_000);

  it("accepts a real application event advancing the paired checkpoint without recomputing unchanged evidence", async () => {
    const f = await fixture(); const runtime = f.connect();
    const state = createHindsightRuntimeState({ db: f.db, runtime, config: loadMemoryConfig({}), now: () => W3_AT });
    const bank = runtime.banks()[0]!; const prior = state.replica.checkpoint(bank.bankId)!;
    const lease = state.replica.leases.acquire({ bankId: bank.bankId, ownerId: "runtime-event", durationMs: 60_000 });
    try {
      const event = applicationTestEvent({ scope: { bankId: bank.bankId, namespace: prior.namespace }, from: prior.checkpoint });
      const verify = vi.spyOn(native, "verifyTransitionNativeEvidence");
      const next = state.replica.applyEvent({ bankId: bank.bankId, namespace: prior.namespace, event,
        authorityEpochId: f.epochId, expectedBank: bank, expectedCheckpoint: prior, expectedNativeCheckpoint: prior.native,
        lease, deadlineAt: lease.expiresAt });
      expect(next.checkpoint.state_cursor).toBe(prior.checkpoint.state_cursor + 1);
      runtime.assertConnection(); expect(verify).not.toHaveBeenCalled();
      expect(readMemoryAuthoritySelection(f.db).epochId).toBe(f.epochId);
    } finally {
      state.replica.leases.release(lease); runtime.stop(); state.sync.stop();
      await Promise.allSettled([state.service.stop(), state.writer.stop(), state.writes.stop(), state.provider.stop(), state.sync.settle()]);
      await f.close();
    }
  }, 30_000);

  it("refuses current marker, checkpoint and connection drift without reconstructing history", async () => {
    const f = await fixture(); const runtime = f.connect();
    try {
      runtime.assertConnection();
      for (const damage of ["marker", "checkpoint", "config", "disabled"] as const) {
        const rollback = new Error("restore runtime fixture");
        expect(() => f.db.transaction(() => {
          if (damage === "marker") f.db.prepare("UPDATE memory_authority_selection SET replica_checkpoint_digest=:hash").run({ hash: "0".repeat(64) });
          if (damage === "checkpoint") f.db.prepare("UPDATE hindsight_application_replica_checkpoints SET checkpoint_hash=:hash").run({ hash: "0".repeat(64) });
          if (damage === "config") f.config.upsert("TAKI_HINDSIGHT_ENDPOINT", "http://127.0.0.1:18482");
          if (damage === "disabled") f.config.upsert("TAKI_HINDSIGHT_ENABLED", false);
          const code = damage === "checkpoint" ? "HINDSIGHT_APPLICATION_CHECKPOINT_INVALID"
            : "MEMORY_AUTHORITY_MISMATCH";
          expect(() => runtime.assertConnection()).toThrow(code);
          throw rollback;
        })).toThrow(rollback);
        const verify = vi.spyOn(native, "verifyTransitionNativeEvidence"); verify.mockClear();
        runtime.assertConnection(); expect(verify).not.toHaveBeenCalled(); verify.mockClear();
        runtime.assertConnection(); expect(verify).not.toHaveBeenCalled(); verify.mockRestore();
      }
    } finally { runtime.stop(); await f.close(); }
  }, 30_000);

  it.each(["marker", "checkpoint", "config", "cancel", "stop"] as const)("refuses a paused warm sync reply after %s changes without late admission or publication", async (damage) => {
    const f = await fixture(); const runtime = f.connect();
    const state = createHindsightRuntimeState({ db: f.db, runtime, config: loadMemoryConfig({}), now: () => W3_AT });
    const bank = runtime.banks()[0]!;
    await state.provider.capabilities();
    const evidence = f.db.prepare("SELECT * FROM hindsight_application_runtime_admission").all();
    expect(evidence).not.toHaveLength(0);
    const save = vi.spyOn(state.admission, "save");
    const health = vi.spyOn(f.remote.client, "health"); const version = vi.spyOn(f.remote.client, "version");
    const controller = new AbortController();
    let release!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const received = new Promise<void>((resolve) => { entered = resolve; });
    const original = f.remote.client.compatibility;
    vi.spyOn(f.remote.client, "compatibility").mockImplementation(async (...args) => {
      const response = await original(...args); entered(); await paused; return response;
    });
    const changes = vi.spyOn(f.remote.client, "applicationChanges");
    try {
      const before = f.db.prepare("SELECT * FROM hindsight_application_replica_checkpoints").all();
      const work = state.service.synchronize({ bankId: bank.bankId, context: { timeoutMs: 10_000, signal: controller.signal } });
      const result = work.then(() => null, (error: unknown) => error);
      await received;
      if (damage === "marker") f.db.prepare("UPDATE memory_authority_selection SET replica_checkpoint_digest=:hash").run({ hash: "0".repeat(64) });
      if (damage === "checkpoint") f.db.prepare("UPDATE hindsight_application_replica_checkpoints SET checkpoint_hash=:hash").run({ hash: "0".repeat(64) });
      if (damage === "config") f.config.upsert("TAKI_HINDSIGHT_ENDPOINT", "http://127.0.0.1:18482");
      if (damage === "cancel") controller.abort();
      if (damage === "stop") runtime.stop();
      release();
      expect(await result).toMatchObject({ message: damage === "stop" ? "MEMORY_OPERATION_CANCELLED"
        : damage === "cancel" ? "HINDSIGHT_CANCELLED"
        : damage === "checkpoint" ? "HINDSIGHT_APPLICATION_CHECKPOINT_INVALID" : "MEMORY_AUTHORITY_MISMATCH" });
      expect(changes).not.toHaveBeenCalled();
      expect(health).not.toHaveBeenCalled(); expect(version).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(f.db.prepare("SELECT * FROM hindsight_application_runtime_admission").all()).toEqual(evidence);
      expect(f.db.prepare("SELECT * FROM hindsight_application_replica_checkpoints").all()).toEqual(damage === "checkpoint"
        ? before.map((row) => ({ ...row, checkpoint_hash: "0".repeat(64) })) : before);
    } finally {
      release(); runtime.stop(); state.sync.stop();
      await Promise.allSettled([state.service.stop(), state.writer.stop(), state.writes.stop(), state.provider.stop(), state.sync.settle()]);
      await f.close();
    }
  }, 30_000);

  it("retains actual initial B4 selection validation when no transition marker exists", async () => {
    const f = await fixture(false); const runtime = f.connect();
    try {
      expect(f.db.prepare("SELECT transition_receipt_id FROM memory_authority_selection").get()?.transition_receipt_id).toBeNull();
      runtime.assertConnection(); runtime.assertConnection();
      f.db.prepare("UPDATE memory_authority_selection SET replica_checkpoint_digest=:hash").run({ hash: "0".repeat(64) });
      expect(() => runtime.assertConnection()).toThrow();
      expect(() => readMemoryAuthoritySelection(f.db)).toThrow();
    } finally { runtime.stop(); await f.close(); }
  });

  it.each(["native", "candidate"] as const)("detects historical %s damage at a full binding boundary", async (damage) => {
    const f = await fixture(); const runtime = f.connect();
    try {
      const table = damage === "native" ? "memory_transition_native_evidence" : "memory_transition_candidates";
      f.db.exec(`DROP TRIGGER ${table}_immutable_update`);
      const row = f.db.prepare(damage === "native" ? `SELECT id,body FROM ${table} LIMIT 1`
        : `SELECT id,body FROM ${table} WHERE id=(SELECT candidate_id FROM memory_transition_publications
          WHERE receipt_id=(SELECT transition_receipt_id FROM memory_authority_selection))`).get()!;
      const value = JSON.parse(Buffer.from(row.body as Uint8Array).toString("utf8"));
      value[damage === "native" ? "evidenceId" : "candidateId"] = "0".repeat(64);
      f.db.prepare(`UPDATE ${table} SET body=:body WHERE id=:id`).run({ id: String(row.id), body: Buffer.from(JSON.stringify(value)) });
      expect(() => runtime.assertConnection()).not.toThrow();
      expect(() => f.connect()).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      const assertCurrent = vi.fn();
      expect(() => f.connect({ planId: "private-plan", provisionBankId: null, assertCurrent, labelGroup: () => null }))
        .toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      expect(assertCurrent).not.toHaveBeenCalled();
      expect(() => readMemoryAuthoritySelection(f.db)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
    } finally { runtime.stop(); await f.close(); }
  }, 30_000);

  it("rejects a coherent checkpoint rollback below the verified publication floor", async () => {
    const f = await fixture(); const runtime = f.connect();
    try {
      const bank = runtime.banks()[0]!; const prior = readApplicationCheckpoint(f.db, bank.bankId)!;
      expect(prior.checkpoint.native_cursor).toBeGreaterThan(0);
      const nativeCursor = prior.checkpoint.native_cursor - 1;
      const next = { ...prior, checkpoint: { ...prior.checkpoint, native_cursor: nativeCursor },
        snapshot: { ...prior.snapshot, checkpoint: { ...prior.snapshot.checkpoint, native_cursor: Math.min(prior.snapshot.checkpoint.native_cursor, nativeCursor) } },
        native: { ...prior.native, endCursor: nativeCursor, snapshotCursor: Math.min(prior.native.snapshotCursor, nativeCursor) } };
      f.db.transaction(() => {
        f.db.prepare(`UPDATE hindsight_replica_sync_checkpoints SET end_cursor=:cursor,snapshot_cursor=:snapshot WHERE bank_id=:bank`)
          .run({ bank: bank.bankId, cursor: nativeCursor, snapshot: next.native.snapshotCursor });
        f.db.prepare(`UPDATE hindsight_application_replica_checkpoints SET native_cursor=:cursor,checkpoint_json=:json,checkpoint_hash=:hash WHERE bank_id=:bank`)
          .run({ bank: bank.bankId, cursor: nativeCursor, json: JSON.stringify(next), hash: applicationCheckpointHash(next) });
      });
      expect(readApplicationCheckpoint(f.db, bank.bankId)).toEqual(next);
      expect(() => runtime.assertConnection()).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
    } finally { runtime.stop(); await f.close(); }
  }, 30_000);

  it("refuses every stable transition marker and active authority drift while ignoring update timestamps", async () => {
    const f = await fixture(); const runtime = f.connect();
    const mutations = [
      ["UPDATE memory_authority_selection SET mode='canonical-local'", "MEMORY_AUTHORITY_MISMATCH"],
      ["UPDATE memory_authority_selection SET active_epoch_id='another-epoch'", "MEMORY_AUTHORITY_MISMATCH"],
      ["UPDATE memory_authority_selection SET provider_lineage_id='another-lineage'", "MEMORY_AUTHORITY_MISMATCH"],
      [`UPDATE memory_authority_selection SET replica_checkpoint_digest='${"0".repeat(64)}'`, "MEMORY_AUTHORITY_MISMATCH"],
      [`UPDATE memory_authority_selection SET transition_receipt_id='${"0".repeat(64)}'`, "MEMORY_AUTHORITY_MISMATCH"],
      ["UPDATE canonical_memory_authority_state SET active_epoch_id=(SELECT epoch_id FROM canonical_memory_authority_epochs WHERE status='closed' LIMIT 1)", "MEMORY_INTEGRITY_ERROR: authority epoch is closed"],
      ["UPDATE canonical_memory_authority_epochs SET provider_id='local' WHERE status='active'", "MEMORY_AUTHORITY_MISMATCH"],
      ["UPDATE canonical_memory_authority_epochs SET provider_lineage_id='another-lineage' WHERE status='active'", "MEMORY_AUTHORITY_MISMATCH"],
      [`UPDATE canonical_memory_authority_epochs SET status='closed',ended_at='${W3_AT}' WHERE status='active'`, "MEMORY_INTEGRITY_ERROR: authority epoch is closed"],
    ] as const;
    try {
      for (const [sql, error] of mutations) {
        const rollback = new Error(`restore ${sql}`);
        expect(() => f.db.transaction(() => {
          f.db.exec(sql); expect(() => runtime.assertConnection()).toThrow(new Error(error)); throw rollback;
        })).toThrow(rollback);
        runtime.assertConnection();
      }
      f.db.exec("UPDATE memory_authority_selection SET updated_at='2030-01-01T00:00:00.000Z'");
      expect(() => runtime.assertConnection()).not.toThrow();
    } finally { runtime.stop(); await f.close(); }
  }, 30_000);
});

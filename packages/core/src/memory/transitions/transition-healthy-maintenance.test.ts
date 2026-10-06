import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness, composeHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { openDatabase } from "../../db/sqlite.ts";
import { createTimelineRepo } from "../../db/timeline-repo.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { runMigrations } from "../../db/migration-runner.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { claimTransition, readTransitionIntent, changeTransitionAdmission, updateTransitionAttempt } from "../../db/memory-transition-repo.ts";
import { initializeTransitionDriverBanks } from "../../db/memory-transition-driver-repo.ts";
import { settleTransition } from "../../db/memory-transition-evidence-repo.ts";
import { createTransitionNativeSession } from "./transition-native-session.ts";
import type { MemoryTransitionDriver } from "../operations/memory-operation-transition-storage.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => vi.useRealTimers());
type Harness = Awaited<ReturnType<typeof createHealthyTransitionHarness>>;
const decisions = (h: Harness) => h.db.prepare("SELECT id,body_json FROM memory_transition_native_commands WHERE kind='decision' ORDER BY rowid").all();
const verificationRows = (h: Harness) => h.db.prepare("SELECT * FROM memory_transition_native_verifications ORDER BY rowid").all();

describe("healthy driver partial finite maintenance recovery", () => {
  it("retains nine completed steps, refuses early abort and resumes only after an explicit recovery", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      h.remote.fault.partialMaintenance = true;
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
      expect(h.owner.status(admitted.operationId).state).toBe("outcome_unknown");
      expect(h.remote.calls.verify).toBe(1);
      expect([...h.remote.maintenance.values()].map((steps) => steps.size)).toEqual([9]);
      expect(h.db.prepare("SELECT count(*) n FROM memory_transition_receipts").get()?.n).toBe(0);
      expect(verificationRows(h)).toHaveLength(1); const original = decisions(h);
      h.remote.fault.partialMaintenance = false; h.clock.value = "2026-10-01T00:06:00.000Z";
      const recovered = h.owner.submit(await h.request(transitionId)); await h.owner.stop();
      expect(h.owner.status(recovered.operationId)).toMatchObject({ state: "failed", result: { runtime: "source", authorityCommitted: false } });
      expect(h.owner.status(admitted.operationId).state).toBe("outcome_unknown");
      expect(h.remote.calls.verify).toBe(2); expect([...h.remote.maintenance.values()][0]!.size).toBe(11);
      expect(Array.from([...h.remote.maintenance.values()][0]!.values()).every((count) => count === 1)).toBe(true);
      expect(decisions(h).slice(0, original.length)).toEqual(original);
      expect(decisions(h)).toHaveLength(original.length + 1);
      expect(h.runtime.hindsightBindingSnapshot().binding.kind).toBe("published");
    } finally { await h.close(); }
  });

  it("keeps a lost continuation proof recoverable without repeating completed steps", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      h.remote.fault.partialMaintenance = true;
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
      h.clock.value = "2026-10-01T00:06:00.000Z"; h.remote.fault.partialMaintenance = false; h.remote.fault.verifyReply = true;
      const lost = h.owner.submit(await h.request(transitionId)); await h.owner.stop();
      expect(h.owner.status(lost.operationId).state).toBe("outcome_unknown");
      const counts = [...h.remote.maintenance.values()].map((steps) => [...steps]);
      h.clock.value = "2026-10-01T00:12:00.000Z"; h.remote.fault.unavailable = false;
      const recovered = h.owner.submit(await h.request(transitionId)); await h.owner.stop();
      expect(h.owner.status(recovered.operationId)).toMatchObject({ state: "failed", result: { runtime: "source" } });
      expect(h.owner.status(lost.operationId).state).toBe("outcome_unknown");
      expect(h.remote.calls.verify).toBe(2);
      expect([...h.remote.maintenance.values()].map((steps) => [...steps])).toEqual(counts);
    } finally { await h.close(); }
  });

  it("upgrades actual055 history and journals only the new partial-plan continuation", async () => {
    const h = await createHealthyTransitionHarness({ migrationVersion: 55 });
    try {
      // Build the pre056 sequence using the original public producer seams. That historical driver did not
      // journal verify: call the transport directly after durable acquisition/fence, without inventing a row.
      const oldDriver = vi.spyOn(h.service, "execute").mockImplementation((input) => execute055PartialReturn(h, input));
      h.remote.fault.partialMaintenance = true;
      const admitted = h.owner.submit(await h.request()); await h.owner.stop(); oldDriver.mockRestore();
      const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
      expect(h.owner.status(admitted.operationId).state).toBe("outcome_unknown");
      expect(h.db.prepare("SELECT name FROM sqlite_schema WHERE name='memory_transition_native_verifications'").get()).toBeUndefined();
      const original = decisions(h); const receipts = h.db.prepare("SELECT * FROM migrations ORDER BY version").all();
      expect([...h.remote.maintenance.values()].map((steps) => steps.size)).toEqual([9]);
      runMigrations(h.db, MIGRATIONS);
      expect(verificationRows(h)).toEqual([]); expect(decisions(h)).toEqual(original);
      expect(h.db.prepare("SELECT * FROM migrations WHERE version<=55 ORDER BY version").all()).toEqual(receipts);
      h.clock.value = "2026-10-01T00:06:00.000Z"; h.remote.fault.partialMaintenance = false;
      const recovered = h.owner.submit(await h.request(transitionId)); await h.owner.stop();
      expect(h.owner.status(recovered.operationId)).toMatchObject({ state: "failed", result: { runtime: "source", authorityCommitted: false } });
      const verification = verificationRows(h); expect(verification).toHaveLength(1);
      expect(verification[0]?.dispatched_at).toBe(h.clock.value);
      expect(decisions(h).slice(0, original.length)).toEqual(original);
      expect([...h.remote.maintenance.values()][0]!.size).toBe(11);
      expect(Array.from([...h.remote.maintenance.values()][0]!.values()).every((count) => count === 1)).toBe(true);
      expect(h.remote.calls.verify).toBe(2);
      expect(h.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { await h.close(); }
  });

  it("reopens an interrupted055 return without an abort intent and completes the same transition after056", async () => {
    const h = await createHealthyTransitionHarness({ migrationVersion: 55 });
    // The preserved real interruption has no abort command. A refusal-driven abort fixture does not cover
    // that recovery branch: rebuilding Core must continue the original return with no source runtime present.
    const oldDriver = vi.spyOn(h.service, "execute").mockImplementation((input) => execute055PartialReturn(h, input, false));
    h.remote.fault.partialMaintenance = true;
    const admitted = h.owner.submit(await h.request()); await h.owner.stop(); oldDriver.mockRestore();
    const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
    const originalOperation = h.owner.status(admitted.operationId);
    const originalCommands = h.db.prepare("SELECT * FROM memory_transition_native_commands ORDER BY rowid").all();
    const oldMigrations = h.db.prepare("SELECT * FROM migrations ORDER BY version").all();
    const completed = [...h.remote.maintenance.values()].map((steps) => [...steps]);
    expect(originalOperation.state).toBe("outcome_unknown");
    expect(decisions(h)).toEqual([]); expect(completed[0]).toHaveLength(9);
    await h.stop(); await h.utility.stop(); h.db.close();
    const db = openDatabase({ path: join(h.dataDir, "memory.sqlite"), migrations: MIGRATIONS });
    h.remote.reconnectDatabase(db); h.remote.fault.partialMaintenance = false; h.clock.value = "2026-10-01T00:06:00.000Z";
    const calls = { ...h.remote.calls };
    const resumed = composeHealthyTransitionHarness({ db, dataDir: h.dataDir, timeline: createTimelineRepo(db), remote: h.remote, clock: h.clock });
    try {
      expect(db.prepare("SELECT * FROM migrations WHERE version<=55 ORDER BY version").all()).toEqual(oldMigrations);
      expect(db.prepare("SELECT * FROM memory_transition_native_commands ORDER BY rowid").all()).toEqual(originalCommands);
      expect(db.prepare("SELECT * FROM memory_transition_native_verifications").all()).toEqual([]);
      expect(resumed.runtime.hindsightBindingSnapshot().binding.kind).toBe("unavailable");
      expect(resumed.service.status(transitionId).progress.runtime).toBe("unavailable");
      expect(h.remote.calls).toEqual(calls);
      const recovery = resumed.owner.submit(await resumed.request(transitionId)); await resumed.owner.stop();
      expect(resumed.owner.status(recovery.operationId)).toMatchObject({ state: "completed", result: { authorityCommitted: true, runtime: "ready" } });
      expect(resumed.owner.status(admitted.operationId)).toEqual(originalOperation);
      const rows = db.prepare("SELECT * FROM memory_transition_native_verifications").all();
      expect(rows).toHaveLength(2); expect(rows.every((row) => row.dispatched_at === h.clock.value)).toBe(true);
      const preserved = [...h.remote.maintenance.values()][0]!;
      expect(completed[0]!.every(([id, count]) => preserved.get(id) === count)).toBe(true);
      expect([...preserved.values()].every((count) => count === 1)).toBe(true);
      expect(h.remote.calls).toMatchObject({ acquire: 2, verify: 3, resolve: 2 });
      expect(db.prepare("SELECT count(*) n FROM memory_transition_receipts").get()?.n).toBe(1);
      expect(db.prepare("SELECT count(*) n FROM memory_transition_native_commands WHERE slot LIKE 'abort:%'").get()?.n).toBe(0);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { await resumed.stop(); db.close(); rmTempDir(h.dataDir); }
  }, 20_000);
});

async function execute055PartialReturn(h: Harness, input: Parameters<MemoryTransitionDriver["execute"]>[0], requestAbort = true) {
  if (input.producer.kind !== "transition") throw new Error("fixture requires transition");
  const intent = readTransitionIntent(h.db, input.producer.transitionId)!;
  let lease = claimTransition(h.db, { transitionId: intent.transitionId, operationId: input.operationId,
    ownerId: "old055-owner", now: h.clock.value, leaseMs: 300_000 });
  const work = () => ({ lease, now: h.clock.value, assertConfiguration: () => undefined });
  initializeTransitionDriverBanks(h.db, work());
  lease = changeTransitionAdmission(h.db, { ...work(), action: "open" });
  lease = updateTransitionAttempt(h.db, { ...work(), patch: { phase: "draining" } });
  await h.runtime.transitions.quiesce({ ...work(), timeoutMs: 1000 });
  lease = changeTransitionAdmission(h.db, { ...work(), action: "close" });
  lease = updateTransitionAttempt(h.db, { ...work(), patch: { phase: "fenced" } });
  const native = createTransitionNativeSession({ db: h.db, intent, client: h.remote.client, work,
    request: () => ({ timeoutMs: 1000 }), changed: () => undefined });
  for (const bank of intent.request.expected.banks) await native.fence(bank.nativeBankId!);
  const bankId = intent.request.expected.banks[0]!.nativeBankId!;
  const status = await native.owned(bankId);
  await expect(h.remote.client.verifyTransition!({ bankId, request: status.executor, context: { timeoutMs: 1000 } })).rejects.toThrow("NATIVE_MAINTENANCE_INCOMPLETE");
  if (requestAbort) await expect(native.resolve(bankId, { disposition: "abort", receiptId: null })).rejects.toThrow("NATIVE_MAINTENANCE_INCOMPLETE");
  settleTransition(h.db, { ...work(), result: { kind: "transition", transitionId: intent.transitionId, receiptId: null,
    authorityCommitted: false, runtime: "unavailable", queue: "settled", outcome: "outcome_unknown", errorCode: "MEMORY_TRANSITION_OUTCOME_UNKNOWN" } });
  return null;
}

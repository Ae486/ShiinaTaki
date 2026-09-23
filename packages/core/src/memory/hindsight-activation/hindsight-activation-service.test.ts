import { afterEach, describe, expect, it } from "vitest";
import { retainNewLocalSource } from "../../db/hindsight-local-coverage-fixtures.ts";
import { createHindsightIngestionSourceRepo } from "../../db/hindsight-ingestion-source-repo.ts";
import { scriptedGenerateModel } from "../../testing/mock-language-model.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { createHindsightActivationHarness, type HindsightActivationHarness } from "./hindsight-activation-fixture.ts";

const harnesses: HindsightActivationHarness[] = [];
afterEach(async () => { for (const harness of harnesses.splice(0)) await harness.close(); });
function harness(...args: Parameters<typeof createHindsightActivationHarness>) {
  const value = createHindsightActivationHarness(...args); harnesses.push(value); return value;
}
const skipGate = () => scriptedGenerateModel([{ kind: "text", deltas: [JSON.stringify({ decision: "skip" })] }]);

function expectLocalIntact(h: HindsightActivationHarness): void {
  expect(readMemoryAuthoritySelection(h.db)).toMatchObject({ mode: "canonical-local", epochId: h.local.epochId });
  expect(h.subsystem.fence.writable()).toBe(true);
  expect(h.db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n).toBe(0);
  expect(h.db.prepare("SELECT lease_owner FROM hindsight_cutover_runs WHERE run_id='run'").get()?.lease_owner ?? null).toBeNull();
}
async function expectFailure(h: HindsightActivationHarness, work: Promise<unknown>, code: string): Promise<void> {
  await expect(work).rejects.toThrow(code);
  expectLocalIntact(h);
}

describe("Hindsight activation service", () => {
  it("drives drain, capture, prepare, import, verify, readiness and promotion to a committed receipt with one POST per Bank step", async () => {
    const h = harness();
    const receipt = await h.service.start(h.identity(), h.control());
    expect(receipt).toMatchObject({ runId: "run", transactionId: "hindsight-tx", hindsightEpochId: "hindsight-epoch", carriedWitnessCount: 0 });
    expect(readMemoryAuthoritySelection(h.db)).toMatchObject({ mode: "hindsight", epochId: "hindsight-epoch", transactionId: "hindsight-tx" });
    expect(h.db.prepare("SELECT count(*) AS n FROM hindsight_authority_bank_receipts WHERE transaction_id='hindsight-tx'").get()?.n).toBe(2);
    expect(h.transport.calls("transfer-post")).toBe(2); expect(h.transport.calls("verification-verify")).toBe(2);
    expect(h.checkpoints.map((checkpoint) => checkpoint.progress.phase)).toEqual([
      "draining", "capturing", "capturing", "preparing", "preparing", "importing", "verifying", "verifying",
      "preparing", "preparing", "importing", "verifying", "verifying", "ready", "committing", "binding", "completed"]);
    expect(h.checkpoints.at(-1)?.progress).toMatchObject({ bankCount: 2, preparedBankCount: 2, importedBankCount: 2, verifiedBankCount: 2 });
    expect(h.checkpoints.at(-1)?.banks.every((bank) => bank.preparationId !== null)).toBe(true);
    expect(h.settle.calls).toBe(1);
    expect(h.binding.binds).toEqual(["hindsight-epoch"]);
    expect(h.service.runtime()).toEqual({ available: true, unavailableReason: null });
    expect(h.subsystem.fence.writable()).toBe(false);
    expect(() => h.subsystem.engine.writeEntry({ characterId: "taki", type: "episodes", content: "late", importance: 3 })).toThrow("MEMORY_AUTHORITY_FENCED");
    expect(h.service.status({ runId: "run", predecessorEpochId: h.local.epochId })).toMatchObject({
      leaseOwner: null, run: { phase: "activated", status: "completed", receipt: { transactionId: "hindsight-tx", epochId: "hindsight-epoch" } } });
    expect(h.service.plan()).toMatchObject({ authority: { mode: "hindsight", epochId: "hindsight-epoch" }, runId: "run", predecessorEpochId: h.local.epochId, banks: [] });
  });

  it("plans from the Local receipt and reports missing or extra B3 rows before anything native happens", () => {
    const h = harness();
    expect(h.service.plan()).toMatchObject({ runId: "run", predecessorEpochId: h.local.epochId, configured: true, blocking: [],
      banks: [{ sourceBankId: "bank", scope: "global", verified: true }, { sourceBankId: "bank-taki", scope: "character", characterId: "taki", verified: true }] });
    h.db.prepare("UPDATE hindsight_bank_setup SET status='pending' WHERE canonical_identity='character:taki'").run();
    h.db.prepare(`INSERT INTO hindsight_bank_setup (scope_kind,canonical_identity,external_bank_id,template_revision,template_digest,status,operation_ids_json,updated_at)
      VALUES ('character','character:other','taki-hs-v1-c-other','taki-bank-v1',:digest,'verified','[]',:now)`).run({ digest: "c".repeat(64), now: "2026-09-23T00:00:00.000Z" });
    expect(h.service.plan().blocking).toEqual([
      { scope: "character", characterId: "taki", localBankId: "bank-taki", code: "HINDSIGHT_TEMPLATE_NOT_VERIFIED" },
      { scope: "character", characterId: "other", localBankId: null, code: "HINDSIGHT_BANKS_INCOMPLETE" }]);
    expect(h.transport.calls("snapshot-create")).toBe(0);
  });

  it("refuses a stale predecessor and a Bank set that does not match the coverage without native writes", async () => {
    const h = harness();
    await expectFailure(h, h.service.start({ ...h.identity(), predecessorEpochId: "other-epoch" }, h.control()), "HINDSIGHT_PREDECESSOR_STALE");
    await expectFailure(h, h.service.start({ ...h.identity(), banks: h.identity().banks.slice(0, 1) }, h.control()), "HINDSIGHT_BANKS_INCOMPLETE");
    expect(h.transport.calls("snapshot-create")).toBe(0);
  });

  it("drains a pending Local span through the fence before capture and fails MEMORY_INGESTION_INCOMPLETE when it cannot", async () => {
    const stuck = harness(); stuck.primary();
    await expectFailure(stuck, stuck.service.start(stuck.identity(), stuck.control()), "MEMORY_INGESTION_INCOMPLETE");
    expect(stuck.db.prepare("SELECT count(*) AS n FROM hindsight_cutover_runs").get()?.n).toBe(0);
    expect(stuck.checkpoints.map((checkpoint) => checkpoint.progress.phase)).toEqual(["draining"]);
    const drained = harness({ model: skipGate() }); drained.primary();
    const receipt = await drained.service.start(drained.identity(), drained.control());
    expect(receipt.carriedWitnessCount).toBe(0);
    expect(drained.db.prepare("SELECT count(*) AS n FROM canonical_memory_ingestion_spans WHERE state='complete'").get()?.n).toBe(1);
  });

  it("carries a primary commit witnessed during the interval into the Hindsight epoch exactly once", async () => {
    const h = harness(); let entries: ReturnType<typeof h.primary> = [];
    h.transport.before(({ route }) => { if (route === "verification-verify" && entries.length === 0) entries = h.primary(); });
    const receipt = await h.service.start(h.identity(), h.control());
    expect(receipt.carriedWitnessCount).toBe(2);
    const witnesses = createHindsightIngestionSourceRepo(h.db); const scope = { epochId: "hindsight-epoch", characterId: "taki" };
    expect(witnesses.unprocessedCount(scope)).toBe(2);
    expect(witnesses.eligibilityStartSeq(scope)).toBe(entries[1]!.seq + 1);
    expect(witnesses.pendingEntries({ ...scope, throughSeq: entries[1]!.seq }).map((proof) => proof.entry.seq)).toEqual(entries.map((entry) => entry.seq));
    witnesses.recordPrimaryCommitted({ characterId: "taki", entries, epochId: "hindsight-epoch", now: "2026-09-23T00:01:00.000Z" });
    expect(witnesses.unprocessedCount(scope)).toBe(2);
    expect(h.db.prepare("SELECT count(*) AS n FROM hindsight_ingestion_cursors WHERE authority_epoch_id='hindsight-epoch'").get()?.n).toBe(1);
  });

  it("fails MEMORY_QUIESCENCE_TIMEOUT when an admitted Local write does not drain and leaves Local writable", async () => {
    const h = harness(); let finish!: () => void;
    const stuck = h.subsystem.fence.admit(() => new Promise<void>((resolve) => { finish = resolve; }));
    await expectFailure(h, h.service.start(h.identity(), h.control()), "MEMORY_QUIESCENCE_TIMEOUT");
    expect(h.db.prepare("SELECT count(*) AS n FROM hindsight_cutover_runs").get()?.n).toBe(0);
    finish(); await stuck;
  });

  it("carries a chat commit witnessed during the forced drain instead of failing the drain as incomplete", async () => {
    const h = harness({ model: skipGate() }); h.primary();
    const ingestion = h.subsystem.ingestion; let raced: ReturnType<typeof h.primary> = [];
    h.subsystem.ingestion = { ...ingestion, run: async (input) => {
      const result = await ingestion.run(input);
      if (raced.length === 0) raced = h.primary("演讲前一晚还是很紧张", "我记得你在准备演讲");
      return result;
    } };
    const receipt = await h.service.start(h.identity(), h.control());
    expect(receipt.carriedWitnessCount).toBe(2);
    expect(createHindsightIngestionSourceRepo(h.db).unprocessedCount({ epochId: "hindsight-epoch", characterId: "taki" })).toBe(2);
    expect(h.db.prepare("SELECT count(*) AS n FROM canonical_memory_ingestion_spans WHERE state<>'complete'").get()?.n).toBe(0);
  });

  it("refuses stale coverage, then resume recaptures explicitly and finishes without re-importing an already imported Bank", async () => {
    const h = harness(); let written = false;
    h.transport.before(({ route }) => { if (route === "snapshot-create" && !written) { written = true; retainNewLocalSource(h.db, h.local); } });
    await expectFailure(h, h.service.start(h.identity(), h.control()), "HINDSIGHT_LOCAL_COVERAGE_STALE");
    expect(h.transport.calls("transfer-post")).toBe(0);
    await h.service.resumeActivation(h.identity("op-2"), h.control());
    expect(h.db.prepare("SELECT count(*) AS n FROM hindsight_local_coverage_manifests").get()?.n).toBe(2);
    expect(h.transport.calls("transfer-post")).toBe(2);
    expect(readMemoryAuthoritySelection(h.db).mode).toBe("hindsight");
  });

  it("refuses an unowned target object and representation gaps before any transfer is submitted", async () => {
    const conflict = harness(); const model = conflict.banks[0]!.baseline[1]!;
    conflict.banks[0]!.baseline.push({ ...model, object_id: "foreign-model", payload: { ...model.payload, mental_model_id: "foreign-model", name: "Foreign" } });
    await expectFailure(conflict, conflict.service.start(conflict.identity(), conflict.control()), "HINDSIGHT_CURRENT_TARGET_CONFLICT");
    expect(conflict.transport.calls("transfer-post")).toBe(0);
    const gaps = harness(); gaps.db.prepare("UPDATE canonical_memory_units SET chunk_id='old-chunk'").run();
    await expectFailure(gaps, gaps.service.start(gaps.identity(), gaps.control()), "HINDSIGHT_CURRENT_PREPARATION_GAPS");
    expect(gaps.transport.calls("transfer-post")).toBe(0);
    expect(gaps.service.status({ runId: "run", predecessorEpochId: gaps.local.epochId }).run?.currentState).toMatchObject({ preparationGapCount: 1 });
  });

  it("persists a drift-proving native refusal as an invalidation and refuses the same preparation on resume", async () => {
    const h = harness();
    h.transport.fail("transfer-post", { response: { status: 409, body: JSON.stringify({ error: "current_state_transfer_refused", reason: "ownership_drift" }) } });
    await expectFailure(h, h.service.start(h.identity(), h.control()), "HINDSIGHT_CURRENT_NATIVE_REFUSED");
    expect(h.db.prepare("SELECT count(*) AS n FROM hindsight_current_native_invalidations").get()?.n).toBe(1);
    await expectFailure(h, h.service.resumeActivation(h.identity("op-2"), h.control()), "HINDSIGHT_CURRENT_NATIVE_REFUSED");
    expect(h.transport.calls("transfer-post")).toBe(1);
    // A refusal that proves no drift (Shared contract) leaves no invalidation, so resume may submit the same frozen request again.
    const transient = harness();
    transient.transport.fail("transfer-post", { response: { status: 409, body: JSON.stringify({ error: "current_state_transfer_refused", reason: "target_conflict" }) } });
    await expectFailure(transient, transient.service.start(transient.identity(), transient.control()), "HINDSIGHT_CURRENT_NATIVE_REFUSED");
    expect(transient.db.prepare("SELECT count(*) AS n FROM hindsight_current_native_invalidations").get()?.n).toBe(0);
    await transient.service.resumeActivation(transient.identity("op-2"), transient.control());
    expect(readMemoryAuthoritySelection(transient.db).mode).toBe("hindsight");
  });

  it("replays a lost import acknowledgement and a lost verification reply from persisted results with exactly one POST each", async () => {
    const lostImport = harness();
    lostImport.transport.fail("transfer-post", { response: new Error("lost ACK"), afterEffect: true });
    await expectFailure(lostImport, lostImport.service.start(lostImport.identity(), lostImport.control()), "HINDSIGHT_UNREACHABLE");
    await lostImport.service.resumeActivation(lostImport.identity("op-2"), lostImport.control());
    expect(lostImport.transport.calls("transfer-post")).toBe(2); expect(lostImport.transport.calls("verification-verify")).toBe(2);
    const lostVerify = harness();
    lostVerify.transport.fail("verification-verify", { response: new Error("lost reply"), afterEffect: true });
    await expectFailure(lostVerify, lostVerify.service.start(lostVerify.identity(), lostVerify.control()), "HINDSIGHT_UNREACHABLE");
    await lostVerify.service.resumeActivation(lostVerify.identity("op-2"), lostVerify.control());
    expect(lostVerify.transport.calls("verification-verify")).toBe(2); expect(lostVerify.transport.calls("transfer-post")).toBe(2);
    expect(readMemoryAuthoritySelection(lostVerify.db).mode).toBe("hindsight");
  });

  it("fails an incomplete verification candidate and advances the same candidate on resume", async () => {
    const h = harness(); h.transport.incompleteVerification();
    await expectFailure(h, h.service.start(h.identity(), h.control()), "HINDSIGHT_CURRENT_VERIFICATION_INCOMPLETE");
    await h.service.resumeActivation(h.identity("op-2"), h.control());
    expect(h.transport.calls("verification-verify")).toBe(3); expect(h.transport.calls("transfer-post")).toBe(2);
  });

  it("stops writing after a lost lease, refuses a resume against the live holder, and takes over a releasable holder", async () => {
    const h = harness(); const second = h.banks[1]!.nativeBankId;
    h.transport.before(({ route, bankId }) => {
      if (route === "snapshot-create" && bankId === second) {
        h.db.prepare("UPDATE hindsight_cutover_runs SET lease_owner='hindsight-activation:other',lease_fence=lease_fence+1,lease_expires_at='2099-01-01T00:00:00.000Z' WHERE run_id='run'").run();
      }
    });
    await expect(h.service.start(h.identity(), h.control())).rejects.toThrow("HINDSIGHT_CUTOVER_LEASE_LOST");
    expect(h.db.prepare("SELECT count(*) AS n FROM hindsight_current_verification_evidence").get()?.n).toBe(1);
    expect(h.db.prepare("SELECT lease_owner FROM hindsight_cutover_runs WHERE run_id='run'").get()?.lease_owner).toBe("hindsight-activation:other");
    h.transport.before(null);
    await expect(h.service.resumeActivation(h.identity("op-2"), h.control())).rejects.toThrow("HINDSIGHT_CUTOVER_LEASE_LOST");
    await h.service.resumeActivation(h.identity("op-3"), h.control({ takeOverFrom: "hindsight-activation:other" }));
    expect(h.transport.calls("transfer-post")).toBe(2);
    expect(readMemoryAuthoritySelection(h.db).mode).toBe("hindsight");
  });

  it.each([
    ["unreachable", new Error("offline"), "HINDSIGHT_UNREACHABLE"],
    ["timeout", { status: 408, body: "{}" }, "HINDSIGHT_TIMEOUT"],
    ["invalid", { status: 200, body: "not json" }, "HINDSIGHT_RESPONSE_INVALID"],
  ] as const)("fails closed on a %s transport answer without a drift observation and resumes cleanly", async (_label, response, code) => {
    const h = harness(); h.transport.fail("snapshot-create", { response });
    await expectFailure(h, h.service.start(h.identity(), h.control()), code);
    expect(h.db.prepare("SELECT count(*) AS n FROM hindsight_current_native_invalidations").get()?.n).toBe(0);
    await h.service.resumeActivation(h.identity("op-2"), h.control());
    expect(readMemoryAuthoritySelection(h.db).mode).toBe("hindsight");
  });

  it("honours a stop request only at a Bank boundary and resumes from the persisted evidence", async () => {
    const h = harness();
    await expectFailure(h, h.service.start(h.identity(), h.control({ stopRequested: () => h.checkpoints.some((c) => c.progress.verifiedBankCount >= 1) })),
      "HINDSIGHT_ACTIVATION_INTERRUPTED");
    expect(h.transport.calls("transfer-post")).toBe(1);
    await h.service.resumeActivation(h.identity("op-2"), h.control());
    expect(h.transport.calls("transfer-post")).toBe(2);
  });

  it("stops at the next Bank boundary on shutdown, awaits the in-flight attempt and refuses new attempts", async () => {
    const h = harness(); let stopping: Promise<void> | undefined;
    h.transport.before(({ route }) => { if (route === "verification-page") stopping ??= h.service.stop(); });
    await expectFailure(h, h.service.start(h.identity(), h.control()), "HINDSIGHT_ACTIVATION_INTERRUPTED");
    await stopping; expect(h.service.stopRequested()).toBe(true);
    expect(h.transport.calls("transfer-post")).toBe(1);
    await expect(h.service.resumeActivation(h.identity("op-2"), h.control())).rejects.toThrow("HINDSIGHT_ACTIVATION_INTERRUPTED");
  });

  it("refuses promotion when the connection drifted mid-run and resumes without new native writes once repaired", async () => {
    const h = harness();
    h.transport.before(({ route }) => { if (route === "verification-page") h.db.prepare("UPDATE hindsight_connection_state SET phase='failed' WHERE singleton=1").run(); });
    await expectFailure(h, h.service.start(h.identity(), h.control()), "HINDSIGHT_CONNECTION_NOT_VERIFIED");
    h.transport.before(null);
    h.db.prepare("UPDATE hindsight_connection_state SET phase='configured' WHERE singleton=1").run();
    const posts = h.transport.calls("transfer-post");
    await h.service.resumeActivation(h.identity("op-2"), h.control());
    expect(h.transport.calls("transfer-post")).toBe(posts);
    expect(readMemoryAuthoritySelection(h.db).mode).toBe("hindsight");
  });
});

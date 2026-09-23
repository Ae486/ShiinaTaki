import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryActivationStatusSchema, MemoryAuthorityStatusSchema, type MemoryOperation, type MemoryOperationRequest } from "@taki/shared";
import { createHindsightIngestionSourceRepo } from "../../db/hindsight-ingestion-source-repo.ts";
import { createMemoryOperationRepo } from "../../db/memory-operation-repo.ts";
import { createLogger } from "../../logging/logger.ts";
import * as hindsightSubsystem from "../hindsight/hindsight-memory-subsystem.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { createMemoryOperationService } from "../operations/memory-operation-service.ts";
import { scriptedGenerateModel } from "../../testing/mock-language-model.ts";
import type { HindsightSubsystem } from "../hindsight-runtime-binding.ts";
import {
  JOURNEY_CHARACTER, TOOL_OPTIONS, configureHindsight, createHindsightActivationJourney, onboardLocal, type HindsightActivationJourney, type JourneySession,
} from "./hindsight-activation-journey-fixture.ts";

const journeys: HindsightActivationJourney[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const journey of journeys.splice(0)) await journey.close(); });
function journey(...args: Parameters<typeof createHindsightActivationJourney>) { const value = createHindsightActivationJourney(...args); journeys.push(value); return value; }

const activate = (session: JourneySession, expectedEpochId: string): MemoryOperationRequest =>
  ({ kind: "hindsight.activate", source: { mode: "new", setupRevision: session.setup.status().revision, expectedEpochId } });

/** Every Hindsight subsystem the composition constructs, so a test can drive its flush port (the composition exposes no draft). */
function observeHindsightSubsystems(): HindsightSubsystem[] {
  const built: HindsightSubsystem[] = []; const construct = hindsightSubsystem.createHindsightMemorySubsystem;
  vi.spyOn(hindsightSubsystem, "createHindsightMemorySubsystem").mockImplementation((input) => { const value = construct(input); built.push(value); return value; });
  return built;
}

/** Legacy -> Local -> a retained Local memory -> configured B3: the instance every C03 case starts from. */
async function readyInstance(j: HindsightActivationJourney) {
  const session = j.session;
  const localEpochId = await onboardLocal(session);
  const run = await session.runtime.captureRun(JOURNEY_CHARACTER);
  expect(await run.tools.retain!.execute!({ content: "用户最近在准备一场演讲。", layer: "episodes", context: null }, TOOL_OPTIONS)).toMatchObject({ ok: true });
  await configureHindsight(session);
  return { session, localEpochId };
}

describe("C03 — first Hindsight activation through registered operations", () => {
  it("activates a healthy Local instance in one operation, rebinds in-process and serves a Hindsight Run", async () => {
    const j = journey(); const { session, localEpochId } = await readyInstance(j);
    const before = session.activationStatus();
    expect(MemoryActivationStatusSchema.parse(before)).toEqual(before);
    expect(before).toMatchObject({ authority: { mode: "canonical-local", epochId: localEpochId }, setup: { configured: true },
      prerequisites: { blocking: [] }, run: null, actions: { activate: true, resume: false, recoverBinding: false } });
    expect(before.prerequisites.banks).toHaveLength(2);

    const operation = await session.settled(activate(session, localEpochId));
    expect(operation).toMatchObject({ state: "completed", result: { kind: "hindsight", outcome: "activated", runtimeAvailable: true, blocking: [] },
      producer: { progress: { phase: "completed", bankCount: 2, verifiedBankCount: 2 } } });
    const selection = readMemoryAuthoritySelection(session.db);
    expect(selection).toMatchObject({ mode: "hindsight", epochId: (operation.producer as { hindsightEpochId: string }).hindsightEpochId,
      transactionId: (operation.producer as { transactionId: string }).transactionId });
    expect(session.db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n).toBe(1);
    expect(session.db.prepare("SELECT count(*) AS n FROM hindsight_authority_bank_receipts").get()?.n).toBe(2);
    expect(j.transport.calls("transfer-post")).toBe(2); expect(j.transport.calls("verification-verify")).toBe(2);
    expect(session.runtime.operations()).not.toBeNull();
    expect(session.runtime.operations()!.scheduler.started()).toBe(true);
    const authority = session.authorityStatus();
    expect(MemoryAuthorityStatusSchema.parse(authority)).toEqual(authority);
    expect(authority).toMatchObject({ authority: { mode: "hindsight" }, runtime: { providerId: "hindsight", available: true, unavailableReason: null } });
    const after = session.activationStatus();
    expect(MemoryActivationStatusSchema.parse(after)).toEqual(after);
    expect(after).toMatchObject({ authority: { mode: "hindsight" }, runtime: { available: true }, run: { phase: "activated", receipt: { transactionId: selection.transactionId } },
      actions: { activate: false, resume: false, recoverBinding: false } });

    const run = await session.runtime.captureRun(JOURNEY_CHARACTER);
    expect(run.snapshot.providerId).toBe("hindsight");
    expect(j.model.doGenerateCalls).toHaveLength(0);
  });

  it("witnesses a chat commit during the interval, carries it once into the Hindsight epoch and refuses setup RPCs while open", async () => {
    // The scripted gate keeps the carried span (seq 1..2, the journey's only Timeline entries) for both Banks.
    const j = journey({ model: scriptedGenerateModel([{ kind: "text", deltas: [JSON.stringify({ decision: "keep", route: "both", fromSeq: 1, throughSeq: 2 })] }]) });
    const subsystems = observeHindsightSubsystems();
    const { session, localEpochId } = await readyInstance(j);
    let entries: ReturnType<typeof session.chat> = []; let conflict: unknown;
    j.transport.before(async ({ route }) => {
      if (route !== "verification-verify" || entries.length > 0) return;
      entries = session.chat("我最近在准备演讲", "我记住了：你在准备演讲");
      conflict = await session.setup.validate({ expectedRevision: session.setup.status().revision }).then(() => null, (error: unknown) => error);
    });
    const operation = await session.settled(activate(session, localEpochId));
    expect(operation).toMatchObject({ state: "completed", result: { outcome: "activated" }, producer: { progress: { carriedWitnessCount: 2 } } });
    expect(conflict).toMatchObject({ code: "HINDSIGHT_STATE_CONFLICT" });
    const epochId = (operation.producer as { hindsightEpochId: string }).hindsightEpochId;
    const witnesses = createHindsightIngestionSourceRepo(session.db); const scope = { epochId, characterId: JOURNEY_CHARACTER };
    expect(witnesses.unprocessedCount(scope)).toBe(2);
    expect(witnesses.pendingEntries({ ...scope, throughSeq: entries[1]!.seq }).map((proof) => proof.entry.seq)).toEqual(entries.map((entry) => entry.seq));
    // The same commit witnessed again (Hindsight runtime now bound) is a no-op, never a second copy.
    session.runtime.recordPrimaryCommitted({ characterId: JOURNEY_CHARACTER, entries });
    expect(witnesses.unprocessedCount(scope)).toBe(2);
    expect(session.db.prepare("SELECT count(*) AS n FROM hindsight_ingestion_cursors WHERE authority_epoch_id=:epoch").get({ epoch: epochId })?.n).toBe(1);
    expect(() => session.setup.disable({ expectedRevision: session.setup.status().revision })).toThrow("HINDSIGHT_STATE_CONFLICT");
    expect(session.activationStatus().custody).toMatchObject({ unconsumedWitnesses: 2, pendingSpans: 0 });
    // The carried witnesses are processed by the bound Hindsight epoch exactly once: the first Run synchronizes the replica,
    // then one gate call, one complete span, both Banks queued durably (application offline), and a second flush over the
    // same range finds nothing left.
    expect(entries.map((entry) => entry.seq)).toEqual([1, 2]);
    expect((await session.runtime.captureRun(JOURNEY_CHARACTER)).snapshot.providerId).toBe("hindsight");
    j.application.control.offline = true;
    const range = { characterId: JOURNEY_CHARACTER, fromSeq: 1, throughSeq: 2 };
    expect(await subsystems[0]!.memoryFlush.prepareRetirement({ ...range, operationId: "journey-flush" })).toMatchObject({ status: "success", writes: 2, throughSeq: 2 });
    expect(j.model.doGenerateCalls).toHaveLength(1);
    expect(witnesses.unprocessedCount(scope)).toBe(0);
    expect(session.db.prepare("SELECT state FROM hindsight_ingestion_spans WHERE authority_epoch_id=:epoch").all({ epoch: epochId }).map((row) => row.state)).toEqual(["complete"]);
    expect(session.activationStatus().custody).toMatchObject({ unconsumedWitnesses: 0, pendingSpans: 0 });
    expect(await subsystems[0]!.memoryFlush.prepareRetirement({ ...range, operationId: "journey-flush-again" })).toMatchObject({ status: "success", writes: 0 });
    expect(j.model.doGenerateCalls).toHaveLength(1);
  });

  it("survives a lost submit reply through discovery, refuses a duplicate while open and stops at a Bank boundary on shutdown", async () => {
    const j = journey(); const { session, localEpochId } = await readyInstance(j);
    let stopping: Promise<void> | undefined;
    j.transport.before(({ route }) => { if (route === "verification-page") stopping ??= session.activation.stop(); });
    session.operations.submit(activate(session, localEpochId));
    expect(() => session.operations.submit(activate(session, localEpochId))).toThrow("MEMORY_OPERATION_BUSY");
    await session.operations.stop(); await stopping;
    const discovered = session.operations.list({ includeTerminal: true, limit: 10 }).filter((operation) => operation.kind === "hindsight.activate");
    expect(discovered).toHaveLength(1);
    expect(discovered[0]).toMatchObject({ kind: "hindsight.activate", state: "failed", reason: "producer_incomplete", errorCode: "HINDSIGHT_ACTIVATION_INTERRUPTED" });
    expect(readMemoryAuthoritySelection(session.db)).toMatchObject({ mode: "canonical-local", epochId: localEpochId });
    expect(j.transport.calls("transfer-post")).toBe(1);
    expect(session.activationStatus()).toMatchObject({ authority: { mode: "canonical-local" }, runtime: { available: true }, run: { receipt: null }, actions: { resume: true, activate: false } });
    expect(await session.runtime.captureRun(JOURNEY_CHARACTER)).toMatchObject({ snapshot: { providerId: "local" } });

    const next = await j.restart("boot-b");
    expect(next.activationStatus().actions).toMatchObject({ resume: true, activate: false });
    expect(j.transport.calls("transfer-post")).toBe(1);
    const resumed = await next.settled({ kind: "hindsight.activate", source: { mode: "resume", runId: (discovered[0]!.producer as { runId: string }).runId } });
    expect(resumed).toMatchObject({ state: "completed", result: { outcome: "activated" }, producer: { transactionId: (discovered[0]!.producer as { transactionId: string }).transactionId } });
    expect(j.transport.calls("transfer-post")).toBe(2);
    expect(next.authorityStatus().runtime).toEqual({ providerId: "hindsight", available: true, unavailableReason: null });
  });

  it("classifies a crash before COMMIT as incomplete without redispatch and a restart after COMMIT from the receipt without re-promoting", async () => {
    const j = journey(); const { session, localEpochId } = await readyInstance(j);
    j.transport.fail("transfer-post", { response: new Error("lost ACK"), afterEffect: true });
    const request = activate(session, localEpochId);
    const failedAttempt = await session.settled(request);
    expect(failedAttempt).toMatchObject({ state: "failed", errorCode: "HINDSIGHT_UNREACHABLE" });
    const crashed = foreignRow(session, { request, producer: failedAttempt.producer! });
    const posts = j.transport.calls("transfer-post");
    const rebooted = await j.restart("boot-b");
    expect(rebooted.operations.status(crashed)).toMatchObject({ state: "outcome_unknown", reason: "producer_incomplete" });
    expect(rebooted.changes.map((change) => change.state)).toEqual(["outcome_unknown"]);
    expect(j.transport.calls("transfer-post")).toBe(posts);
    expect(rebooted.runtime.bindingSnapshot()).toMatchObject({ selection: "canonical-local", binding: { kind: "published", epochId: localEpochId } });
    const committed = await rebooted.settled({ kind: "hindsight.activate", source: { mode: "resume", runId: (failedAttempt.producer as { runId: string }).runId } });
    expect(committed).toMatchObject({ state: "completed", result: { outcome: "activated" } });
    expect(j.transport.calls("transfer-post")).toBe(2);

    const late = foreignRow(rebooted, { request: { kind: "hindsight.activate", source: { mode: "resume", runId: (committed.producer as { runId: string }).runId } }, producer: committed.producer! });
    const after = await j.restart("boot-c");
    expect(after.runtime.operations()?.epochId).toBe((committed.producer as { hindsightEpochId: string }).hindsightEpochId);
    expect(after.operations.status(late)).toMatchObject({ state: "completed", result: { outcome: "activated", runtimeAvailable: true } });
    expect(after.db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n).toBe(1);
    expect(j.transport.calls("transfer-post")).toBe(2);
    expect(after.activationStatus()).toMatchObject({ authority: { mode: "hindsight" }, runtime: { available: true }, actions: { recoverBinding: false } });
    expect((await after.runtime.captureRun(JOURNEY_CHARACTER)).snapshot.providerId).toBe("hindsight");
  });

  it("keeps Hindsight selected with a structured unavailable runtime when the rebind fails, witnesses the interval and repairs through recover", async () => {
    const j = journey(); const { session, localEpochId } = await readyInstance(j);
    vi.spyOn(hindsightSubsystem, "createHindsightMemorySubsystem").mockImplementationOnce(() => { throw new Error("synthetic Hindsight constructor failure"); });
    const first = await session.settled(activate(session, localEpochId));
    expect(first).toMatchObject({ state: "failed", reason: "runtime_unavailable", errorCode: "MEMORY_RUNTIME_UNAVAILABLE",
      result: { outcome: "binding_unavailable", runtimeAvailable: false }, producer: { progress: { phase: "binding" } } });
    const epochId = (first.producer as { hindsightEpochId: string }).hindsightEpochId;
    expect(readMemoryAuthoritySelection(session.db)).toMatchObject({ mode: "hindsight", epochId });
    expect(session.runtime.bindingSnapshot().binding).toEqual({ kind: "none" });
    expect(session.runtime.hindsightBindingSnapshot()).toMatchObject({ selection: "hindsight", binding: { kind: "unavailable", epochId } });
    expect(session.runtime.operations()).toBeNull();
    await expect(session.runtime.captureRun(JOURNEY_CHARACTER)).rejects.toThrow("MEMORY_RUNTIME_UNAVAILABLE");
    expect(() => session.runtime.writeMemory({ characterId: JOURNEY_CHARACTER, layer: "episodes", content: "late", importance: 3 })).toThrow("MEMORY_INTEGRITY_ERROR");
    expect(session.authorityStatus()).toMatchObject({ authority: { mode: "hindsight", epochId }, runtime: { providerId: "hindsight", available: false, unavailableReason: "not_installed" } });
    const status = session.activationStatus();
    expect(MemoryActivationStatusSchema.parse(status)).toEqual(status);
    expect(status).toMatchObject({ runtime: { available: false, unavailableReason: "not_installed" }, run: { receipt: { epochId } }, actions: { recoverBinding: true, activate: false, resume: false } });
    // A primary commit while committed-but-unbound lands in the Hindsight source ledger by the marker, never in retired Local.
    const entries = session.chat("绑定失败期间的对话", "我仍然记得这句话");
    const witnesses = createHindsightIngestionSourceRepo(session.db);
    expect(witnesses.unprocessedCount({ epochId, characterId: JOURNEY_CHARACTER })).toBe(2);
    expect(session.db.prepare("SELECT count(*) AS n FROM canonical_memory_primary_commits WHERE timeline_seq>=:seq").get({ seq: entries[0]!.seq })?.n).toBe(0);

    const repaired = await session.settled({ kind: "hindsight.activate", source: { mode: "recover", epochId } });
    expect(repaired).toMatchObject({ state: "completed", result: { outcome: "activated", epochId, runtimeAvailable: true }, producer: { transactionId: (first.producer as { transactionId: string }).transactionId } });
    expect(session.operations.status(first.operationId)).toEqual(first);
    expect(session.db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n).toBe(1);
    expect(j.transport.calls("transfer-post")).toBe(2);
    expect(session.runtime.operations()?.scheduler.started()).toBe(true);
    expect(session.authorityStatus().runtime).toEqual({ providerId: "hindsight", available: true, unavailableReason: null });
    expect((await session.runtime.captureRun(JOURNEY_CHARACTER)).snapshot.providerId).toBe("hindsight");
    expect(witnesses.unprocessedCount({ epochId, characterId: JOURNEY_CHARACTER })).toBe(2);
  });

  it("fails closed on a corrupt marker: boot observation stays unknown and no fallback authority is selected", async () => {
    const j = journey(); const { session, localEpochId } = await readyInstance(j);
    const request = activate(session, localEpochId);
    const operation = await session.settled(request);
    expect(operation.state).toBe("completed");
    const late = foreignRow(session, { request, producer: operation.producer! });
    session.db.prepare("UPDATE memory_authority_selection SET activation_transaction_id='corrupt' WHERE singleton=1").run();
    const owner = createMemoryOperationService({ db: session.db, live: session.runtime.operations, setup: session.setup, hindsight: session.activation,
      bootId: "boot-corrupt", onChanged: () => undefined, logger: createLogger("fatal") });
    expect(owner.status(late)).toMatchObject({ state: "outcome_unknown", reason: "commitment_unknown" });
    expect(() => readMemoryAuthoritySelection(session.db)).toThrow("MEMORY_INTEGRITY_ERROR");
    expect(() => owner.submit({ kind: "hindsight.activate", source: { mode: "recover", epochId: (operation.producer as { hindsightEpochId: string }).hindsightEpochId } })).toThrow("MEMORY_INTEGRITY_ERROR");
    expect(session.db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n).toBe(1);
  });
});

/** A row another boot left open, exactly as the durable table would hold it after a crash. */
function foreignRow(session: JourneySession, input: { request: MemoryOperationRequest; producer: NonNullable<MemoryOperation["producer"]> }): string {
  const repo = createMemoryOperationRepo(session.db);
  const operationId = crypto.randomUUID();
  repo.insertAdmitted({ operationId, kind: "hindsight.activate", family: "hindsight-activation", request: input.request, producer: input.producer, bootId: "boot-old", authorityEpochId: null });
  repo.transition({ operationId, expectedState: "admitted", patch: { state: "running" } });
  return operationId;
}

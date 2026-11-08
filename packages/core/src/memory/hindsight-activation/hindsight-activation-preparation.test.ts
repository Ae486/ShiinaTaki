import { afterEach, expect, it, vi } from "vitest";
import { REPLICA_AUTO_INTERVAL_MS, REPLICA_FULL_RECONCILIATION_INTERVAL_MS, type MemoryOperationRequest } from "@taki/shared";
import { createMemoryOperationRepo } from "../../db/memory-operation-repo.ts";
import { createHindsightClient } from "../hindsight/hindsight-client.ts";
import * as hindsightSubsystem from "../hindsight/hindsight-memory-subsystem.ts";
import type { HindsightSubsystem } from "../hindsight-runtime-binding.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import {
  JOURNEY_CHARACTER, TOOL_OPTIONS, configureHindsight, createHindsightActivationJourney, onboardLocal,
  type HindsightActivationJourney, type JourneySession,
} from "./hindsight-activation-journey-fixture.ts";

const FACT = "The user is preparing a presentation about astronomy.";
const journeys: HindsightActivationJourney[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const journey of journeys.splice(0)) await journey.close();
  vi.useRealTimers();
});

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForRelease(released: Promise<void>, signal?: AbortSignal): Promise<void> {
  let abort: () => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("HINDSIGHT_CANCELLED"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
  try { await Promise.race([released, interrupted]); }
  finally { signal?.removeEventListener("abort", abort); }
}

function manualScheduling(): HindsightSubsystem[] {
  const built: HindsightSubsystem[] = [];
  const construct = hindsightSubsystem.createHindsightMemorySubsystem;
  vi.spyOn(hindsightSubsystem, "createHindsightMemorySubsystem").mockImplementation((input) => {
    const subsystem = construct(input);
    for (const bank of subsystem.state.runtime.banks()) subsystem.scheduler.configure(bank.bankId, {
      automatic: false, autoIntervalMs: REPLICA_AUTO_INTERVAL_MS, fullReconciliationIntervalMs: REPLICA_FULL_RECONCILIATION_INTERVAL_MS,
    });
    built.push(subsystem);
    return subsystem;
  });
  return built;
}

async function ready() {
  const journey = createHindsightActivationJourney({ characterFact: FACT });
  journeys.push(journey);
  const session = journey.session;
  const epochId = await onboardLocal(session);
  const run = await session.runtime.captureRun(JOURNEY_CHARACTER);
  expect(await run.tools.retain!.execute!({ content: FACT, layer: "episodes", context: null }, TOOL_OPTIONS)).toMatchObject({ ok: true });
  await configureHindsight(session);
  return { journey, session, epochId };
}

const activationRequest = (session: JourneySession, epochId: string): MemoryOperationRequest => ({ kind: "hindsight.activate", source: {
  mode: "new", setupRevision: session.setup.status().revision, expectedEpochId: epochId,
} });

async function expectMemory(session: JourneySession) {
  const run = await session.runtime.captureRun(JOURNEY_CHARACTER);
  expect(Object.keys(run.tools)).toEqual(expect.arrayContaining(["retain", "recall"]));
  expect(await run.tools.recall!.execute!({ query: "presentation", scope: "character", limit: 10, maxTokens: 2_048 }, TOOL_OPTIONS))
    .toMatchObject({ ok: true, data: { partial: false, hits: [{ record: { unit: { text: FACT } } }] } });
}

function expectSingleCommit(journey: HindsightActivationJourney, session: JourneySession, epochId: string) {
  expect(readMemoryAuthoritySelection(session.db)).toMatchObject({ mode: "hindsight", epochId });
  expect(session.db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n).toBe(1);
  expect(journey.transport.calls("transfer-post")).toBe(2);
}

it("keeps activation in binding beyond the chat admission budget, then serves immediate memory tools and the retained Character fact", async () => {
  const { journey, session, epochId } = await ready();
  const entered = deferred(); const released = deferred();
  const snapshot = journey.client.createApplicationSnapshot!;
  const characterBankId = journey.bindings.find((bank) => bank.scope === "character")!.externalBankId;
  vi.spyOn(journey.client, "createApplicationSnapshot").mockImplementation(async (input) => {
    if (input.bankId === characterBankId) { entered.resolve(); await waitForRelease(released.promise, input.context.signal); }
    return snapshot(input);
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  const operation = session.operations.submit(activationRequest(session, epochId));
  try {
    await entered.promise;
    vi.setSystemTime(Date.now() + 7_501);
    expect(session.operations.status(operation.operationId)).toMatchObject({ state: "running", producer: { progress: { phase: "binding" } } });
    expect(session.activationStatus().actions.recoverBinding).toBe(false);
    released.resolve();
    await session.operations.stop();
    expect(session.operations.status(operation.operationId)).toMatchObject({ state: "completed", producer: { progress: { phase: "completed" } } });
    await expectMemory(session);
  } finally { released.resolve(); }
}, 30_000);

it("preserves a committed preparation failure and recovers the same epoch even when the runtime is installed", async () => {
  const { journey, session, epochId } = await ready();
  const snapshot = journey.client.createApplicationSnapshot!;
  const characterBankId = journey.bindings.find((bank) => bank.scope === "character")!.externalBankId;
  let offline = true;
  vi.spyOn(journey.client, "createApplicationSnapshot").mockImplementation(async (input) => {
    if (offline && input.bankId === characterBankId) throw new Error("HINDSIGHT_UNREACHABLE");
    return snapshot(input);
  });
  const failed = await session.settled(activationRequest(session, epochId));
  expect(failed).toMatchObject({ state: "failed", errorCode: "HINDSIGHT_UNREACHABLE", result: null, producer: { progress: { phase: "binding" } } });
  expect(failed.producer?.kind).toBe("hindsight");
  if (failed.producer?.kind !== "hindsight") throw new Error("fixture activation producer missing");
  const committedEpochId = failed.producer.hindsightEpochId;
  expect(session.runtime.bindingSnapshot().binding.kind).toBe("none");
  expect(session.activationStatus()).toMatchObject({ runtime: { available: true }, actions: { recoverBinding: true, activate: false, resume: false } });
  offline = false;
  const preparation = vi.spyOn(session.runtime, "prepareHindsightActivation");
  const repaired = await session.settled({ kind: "hindsight.activate", source: { mode: "recover", epochId: committedEpochId } });
  expect(preparation).toHaveBeenCalledTimes(1);
  expect(repaired).toMatchObject({ state: "completed", producer: { transactionId: failed.producer.transactionId, progress: { phase: "completed" } } });
  expect(session.operations.status(failed.operationId)).toEqual(failed);
  expectSingleCommit(journey, session, committedEpochId);
  await expectMemory(session);
}, 30_000);

it("explicitly prepares receipt Banks while automatic scheduling is disabled and preserves that preference", async () => {
  const { journey, session, epochId } = await ready();
  manualScheduling();
  const operation = await session.settled(activationRequest(session, epochId));
  expect(operation.state).toBe("completed");
  const schedules = session.runtime.operations()!.scheduler.status();
  expect(schedules).toHaveLength(2);
  expect(schedules.every((bank) => !bank.automatic && bank.lastAttemptAt === null)).toBe(true);
  expect(journey.application.calls.filter((call) => call.operation === "snapshot").map((call) => call.bankId).sort())
    .toEqual(journey.bindings.map((bank) => bank.externalBankId).sort());
  await expectMemory(session);
  expect(session.runtime.operations()!.scheduler.status().every((bank) => !bank.automatic)).toBe(true);
}, 30_000);

it.each(["committing", "binding"] as const)("keeps a crash with checkpoint %s incomplete at boot and explicitly repeats same-receipt preparation", async (phase) => {
  const { journey, session, epochId } = await ready();
  const request = activationRequest(session, epochId);
  const completed = await session.settled(request);
  if (completed.producer?.kind !== "hindsight") throw new Error("fixture activation producer missing");
  const producer = { ...completed.producer, progress: { ...completed.producer.progress, phase } };
  const repo = createMemoryOperationRepo(session.db); const operationId = crypto.randomUUID();
  repo.insertAdmitted({ operationId, kind: "hindsight.activate", family: "hindsight-activation", request, producer,
    bootId: "crashed-boot", authorityEpochId: null });
  repo.transition({ operationId, expectedState: "admitted", patch: { state: "running" } });
  const rebooted = await journey.restart("recovery-boot");
  expect(rebooted.runtime.hindsightBindingSnapshot().binding.kind).toBe("published");
  expect(rebooted.operations.status(operationId)).toMatchObject({ state: "outcome_unknown", reason: "producer_incomplete", producer: { progress: { phase: "binding" } } });
  expect(rebooted.activationStatus().actions.recoverBinding).toBe(true);
  const preparation = vi.spyOn(rebooted.runtime, "prepareHindsightActivation");
  const recovered = await rebooted.settled({ kind: "hindsight.activate", source: { mode: "recover", epochId: producer.hindsightEpochId } });
  expect(preparation).toHaveBeenCalledTimes(1);
  expect(preparation.mock.calls[0]![0]).toMatchObject({ epochId: producer.hindsightEpochId, bankIds: producer.banks.map((bank) => bank.nativeBankId) });
  expect(recovered).toMatchObject({ state: "completed", producer: { transactionId: producer.transactionId, progress: { phase: "completed" } } });
  expect(rebooted.operations.status(completed.operationId)).toEqual(completed);
  expectSingleCommit(journey, rebooted, producer.hindsightEpochId);
  await expectMemory(rebooted);
}, 30_000);

it("settles a stopped initial preparation and recovers its unchanged receipt after restart", async () => {
  const { journey, session, epochId } = await ready();
  manualScheduling();
  const entered = deferred(); const released = deferred();
  const snapshot = journey.client.createApplicationSnapshot!;
  const characterBankId = journey.bindings.find((bank) => bank.scope === "character")!.externalBankId;
  vi.spyOn(journey.client, "createApplicationSnapshot").mockImplementation(async (input) => {
    if (input.bankId === characterBankId) { entered.resolve(); await waitForRelease(released.promise, input.context.signal); }
    return snapshot(input);
  });
  const operation = session.operations.submit(activationRequest(session, epochId));
  try {
    await entered.promise;
    await session.activation.stop();
    await session.operations.stop();
    const stopped = session.operations.status(operation.operationId);
    expect(stopped).toMatchObject({ state: "failed", errorCode: "HINDSIGHT_CANCELLED", producer: { progress: { phase: "binding" } } });
    if (stopped.producer?.kind !== "hindsight") throw new Error("fixture activation producer missing");
    released.resolve();
    const rebooted = await journey.restart("after-stop");
    expect(rebooted.operations.status(operation.operationId)).toEqual(stopped);
    expect(rebooted.activationStatus().actions.recoverBinding).toBe(true);
    const recovered = await rebooted.settled({ kind: "hindsight.activate", source: { mode: "recover", epochId: stopped.producer.hindsightEpochId } });
    expect(recovered).toMatchObject({ state: "completed", producer: { transactionId: stopped.producer.transactionId, progress: { phase: "completed" } } });
    expectSingleCommit(journey, rebooted, stopped.producer.hindsightEpochId);
    await expectMemory(rebooted);
  } finally { released.resolve(); }
}, 30_000);

it("aborts and joins preparation during recovery of an already installed runtime", async () => {
  const { journey, session, epochId } = await ready();
  manualScheduling();
  const completed = await session.settled(activationRequest(session, epochId));
  if (completed.producer?.kind !== "hindsight") throw new Error("fixture activation producer missing");
  const entered = deferred(); const released = deferred();
  const changes = journey.client.applicationChanges!; let held = false;
  vi.spyOn(journey.client, "applicationChanges").mockImplementation(async (input) => {
    if (!held) {
      held = true;
      const signal = input.context.signal;
      expect(signal).toBeDefined();
      entered.resolve();
      await waitForRelease(released.promise, signal);
    }
    return changes(input);
  });
  const operation = session.operations.submit({ kind: "hindsight.activate", source: { mode: "recover", epochId: completed.producer.hindsightEpochId } });
  try {
    await entered.promise;
    expect(session.operations.status(operation.operationId)).toMatchObject({ state: "running", producer: { progress: { phase: "binding" } } });
    await session.activation.stop();
    await session.operations.stop();
    expect(session.operations.status(operation.operationId)).toMatchObject({ state: "failed", errorCode: "HINDSIGHT_CANCELLED", producer: { progress: { phase: "binding" } } });
    expect(session.operations.status(completed.operationId)).toEqual(completed);
    expectSingleCommit(journey, session, completed.producer.hindsightEpochId);
  } finally { released.resolve(); }
}, 30_000);

it.each([false, true])("keeps the default REST limit per request across multiple calls totaling over 10s (queued: %s)", async (queued) => {
  const { journey, session, epochId } = await ready();
  const built = manualScheduling();
  const firstEntered = deferred(); const firstReleased = deferred();
  const secondEntered = deferred(); const secondReleased = deferred();
  const ownCharacterCall = deferred();
  const characterBankId = journey.bindings.find((bank) => bank.scope === "character")!.externalBankId;
  const snapshot = journey.client.createApplicationSnapshot!;
  const page = journey.client.applicationSnapshotPage!;
  const timeouts: number[] = [];
  vi.spyOn(journey.client, "createApplicationSnapshot").mockImplementation(async (input) => {
    if (input.bankId === characterBankId) {
      timeouts.push(input.context.timeoutMs);
      firstEntered.resolve();
      await waitForRelease(firstReleased.promise, input.context.signal);
    }
    return snapshot(input);
  });
  vi.spyOn(journey.client, "applicationSnapshotPage").mockImplementation(async (input) => {
    if (input.bankId === characterBankId) {
      timeouts.push(input.context.timeoutMs);
      secondEntered.resolve();
      await waitForRelease(secondReleased.promise, input.context.signal);
    }
    return page(input);
  });
  let previous: Promise<void> | undefined;
  const prepare = session.runtime.prepareHindsightActivation;
  const modes: Array<"foreground" | undefined> = [];
  vi.spyOn(session.runtime, "prepareHindsightActivation").mockImplementation((input) => {
    const service = built.at(-1)!.state.service;
    const synchronize = service.synchronize;
    vi.spyOn(service, "synchronize").mockImplementation((request) => {
      modes.push(request.mode);
      if (request.bankId === characterBankId && request.context.signal) ownCharacterCall.resolve();
      return synchronize(request);
    });
    if (queued) {
      previous = service.synchronize({ bankId: characterBankId, mode: "foreground", context: { timeoutMs: 10_000 } });
      void previous.catch(() => undefined);
    }
    return prepare(input);
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  const operation = session.operations.submit(activationRequest(session, epochId));
  try {
    await Promise.all([firstEntered.promise, ownCharacterCall.promise]);
    vi.setSystemTime(Date.now() + 6_000);
    firstReleased.resolve();
    await secondEntered.promise;
    vi.setSystemTime(Date.now() + 6_001);
    expect(session.operations.status(operation.operationId).state).toBe("running");
    secondReleased.resolve();
    await previous;
    await session.operations.stop();
    expect(session.operations.status(operation.operationId)).toMatchObject({ state: "completed", producer: { progress: { phase: "completed" } } });
    expect([...new Set(timeouts)]).toEqual([10_000]);
    expect(modes.every((mode) => mode === "foreground")).toBe(true);
    await expectMemory(session);
  } finally { firstReleased.resolve(); secondReleased.resolve(); }
}, 30_000);

it("retains the production client's default 10s HTTP timeout and original error during activation preparation", async () => {
  const { journey, session, epochId } = await ready();
  manualScheduling();
  const entered = deferred(); const timeouts: number[] = [];
  const snapshot = journey.client.createApplicationSnapshot!;
  const characterBankId = journey.bindings.find((bank) => bank.scope === "character")!.externalBankId;
  const timeoutClient = createHindsightClient({ endpoint: "http://127.0.0.1:18481", resolveApiKey: () => journey.secrets.state.value,
    transport: () => { entered.resolve(); return new Promise(() => undefined); } });
  vi.spyOn(journey.client, "createApplicationSnapshot").mockImplementation((input) => {
    if (input.bankId !== characterBankId) return snapshot(input);
    timeouts.push(input.context.timeoutMs);
    return timeoutClient.createApplicationSnapshot!(input);
  });
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const operation = session.operations.submit(activationRequest(session, epochId));
  await entered.promise;
  await vi.advanceTimersByTimeAsync(10_000);
  await session.operations.stop();
  expect(timeouts).toEqual([10_000]);
  expect(session.operations.status(operation.operationId)).toMatchObject({ state: "failed", errorCode: "HINDSIGHT_TIMEOUT", result: null,
    producer: { progress: { phase: "binding" } } });
  expect(session.activationStatus()).toMatchObject({ runtime: { available: true }, actions: { recoverBinding: true } });
}, 30_000);

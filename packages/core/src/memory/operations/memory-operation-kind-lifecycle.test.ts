import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryOperation, MemoryOperationRequest } from "@taki/shared";
import { createMemoryOperationRepo } from "../../db/memory-operation-repo.ts";
import { createLogger } from "../../logging/logger.ts";
import {
  JOURNEY_CHARACTER, configureHindsight, createHindsightActivationJourney, onboardLocal, type HindsightActivationJourney, type JourneySession,
} from "../hindsight-activation/hindsight-activation-journey-fixture.ts";
import { hindsightBankBindings } from "../hindsight/hindsight-bank-identity.ts";
import * as hindsightLifecycle from "../hindsight-lifecycle/hindsight-lifecycle-revalidate.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { EXCLUSIVE_MEMORY_FAMILIES, MemoryOperationRefusal } from "./memory-operation-contract.ts";
import { createMemoryOperationService } from "./memory-operation-service.ts";

const journeys: HindsightActivationJourney[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const journey of journeys.splice(0)) await journey.close(); });
function journey(...args: Parameters<typeof createHindsightActivationJourney>) { const value = createHindsightActivationJourney(...args); journeys.push(value); return value; }

type MemoryOperationFamily = (typeof EXCLUSIVE_MEMORY_FAMILIES)[number];
const MIKA = "mika";
const provision: MemoryOperationRequest = { kind: "bank.provision", characterId: MIKA };
const revalidate = (epochId: string): MemoryOperationRequest => ({ kind: "connection.revalidate", expectedEpochId: epochId });
const lifecycleRows = (session: JourneySession) => session.operations.list({ includeTerminal: true, limit: 50 })
  .filter((operation) => operation.kind === "bank.provision" || operation.kind === "connection.revalidate");

function refusal(session: JourneySession, request: MemoryOperationRequest) {
  try { session.operations.submit(request); } catch (error) { if (error instanceof MemoryOperationRefusal) return { reason: error.reason, activeOperationId: error.activeOperationId }; throw error; }
  throw new Error("expected a refusal");
}

async function activatedInstance(j: HindsightActivationJourney) {
  const session = j.session;
  const localEpochId = await onboardLocal(session);
  await configureHindsight(session);
  const activated = await session.settled({ kind: "hindsight.activate", source: { mode: "new", setupRevision: session.setup.status().revision, expectedEpochId: localEpochId } });
  expect(activated.state).toBe("completed");
  return { session, localEpochId, epochId: readMemoryAuthoritySelection(session.db).epochId! };
}

/** An open row exactly as a crashed boot (or a still-running owner) leaves it in the durable table. */
function openRow(session: JourneySession, input: { family: MemoryOperationFamily; operation: MemoryOperation; producer?: MemoryOperation["producer"] }): string {
  const repo = createMemoryOperationRepo(session.db); const operationId = crypto.randomUUID();
  repo.insertAdmitted({ operationId, kind: input.operation.kind, family: input.family, request: input.operation.request,
    producer: (input.producer ?? input.operation.producer)!, bootId: "boot-old", authorityEpochId: null });
  repo.transition({ operationId, expectedState: "admitted", patch: { state: "running" } });
  return operationId;
}

describe("bank.provision / connection.revalidate — admission", () => {
  it("refuses under a Local marker, on a stale epoch and without the lifecycle service, leaving no row", async () => {
    const j = journey({ characters: [MIKA] });
    const session = j.session;
    const localEpochId = await onboardLocal(session);
    expect(refusal(session, provision)).toMatchObject({ reason: "MEMORY_OPERATION_UNSUPPORTED" });
    expect(refusal(session, revalidate(localEpochId))).toMatchObject({ reason: "MEMORY_OPERATION_UNSUPPORTED" });
    await configureHindsight(session);
    const activated = await session.settled({ kind: "hindsight.activate", source: { mode: "new", setupRevision: session.setup.status().revision, expectedEpochId: localEpochId } });
    expect(activated.state).toBe("completed");
    expect(refusal(session, revalidate(localEpochId))).toMatchObject({ reason: "MEMORY_OPERATION_UNSUPPORTED" });
    const bare = createMemoryOperationService({ db: session.db, live: session.runtime.operations, setup: session.setup, local: session.local,
      hindsight: session.activation, bootId: "boot-bare", logger: createLogger("fatal"), onChanged: () => undefined });
    const epochId = readMemoryAuthoritySelection(session.db).epochId!;
    expect(() => bare.submit(provision)).toThrow("MEMORY_OPERATION_UNSUPPORTED");
    expect(() => bare.submit(revalidate(epochId))).toThrow("MEMORY_OPERATION_UNSUPPORTED");
    expect(lifecycleRows(session)).toEqual([]);
  });

  it("stamps the Core origin and refuses both kinds while any of the four exclusive families holds an open row", async () => {
    const j = journey({ characters: [MIKA] });
    const { session, epochId } = await activatedInstance(j);
    const settled = await session.settled(revalidate(epochId));
    expect(settled).toMatchObject({ state: "completed", producer: { origin: "operator" } });
    const history = session.operations.list({ includeTerminal: true, limit: 50 });
    const sample = (kind: MemoryOperation["kind"]) => history.find((operation) => operation.kind === kind)!;
    const families: [MemoryOperationFamily, MemoryOperation][] = [["setup", sample("setup.validate")], ["local-onboarding", sample("local.onboard.prepare")],
      ["hindsight-activation", sample("hindsight.activate")], ["hindsight-lifecycle", settled]];
    for (const [family, operation] of families) {
      const open = openRow(session, { family, operation });
      expect(refusal(session, provision)).toEqual({ reason: "MEMORY_OPERATION_BUSY", activeOperationId: open });
      expect(refusal(session, revalidate(epochId))).toEqual({ reason: "MEMORY_OPERATION_BUSY", activeOperationId: open });
      session.db.prepare("DELETE FROM memory_operations WHERE operation_id=:id").run({ id: open });
    }
    expect(lifecycleRows(session)).toHaveLength(1);
  });

  it("cancels only before the deferred claim, with no native call", async () => {
    const j = journey({ characters: [MIKA] });
    const { session, epochId } = await activatedInstance(j);
    const produced = [vi.spyOn(session.lifecycle, "provision"), vi.spyOn(session.lifecycle, "revalidate")];
    for (const request of [provision, revalidate(epochId)]) {
      const admitted = session.operations.submit(request);
      expect(session.operations.cancel(admitted.operationId)).toMatchObject({ state: "cancelled" });
      await session.operations.stop();
      expect(session.operations.status(admitted.operationId)).toMatchObject({ state: "cancelled" });
    }
    for (const producer of produced) expect(producer).not.toHaveBeenCalled();
    expect(j.transport.calls("bank-stats")).toBe(0);

    let running: unknown;
    j.transport.before(({ route }) => {
      if (route !== "bank-stats") return;
      const open = session.operations.list({ includeTerminal: false, limit: 5 })[0]!;
      running = (() => { try { session.operations.cancel(open.operationId); return null; } catch (error) { return error; } })();
    });
    expect(await session.settled(provision)).toMatchObject({ state: "completed" });
    expect(running).toMatchObject({ reason: "MEMORY_OPERATION_RUNNING" });
  });
});

describe("bank.provision / connection.revalidate — boot observation", () => {
  it("settles a crashed provision from the B3 row and replica binding, else outcome_unknown without redispatch", async () => {
    const j = journey({ characters: [MIKA] });
    const { session, epochId } = await activatedInstance(j);
    const done = await session.settled(provision);
    expect(done.state).toBe("completed");
    const stats = j.transport.calls("bank-stats"); const puts = j.transport.calls("bank-put");
    // One open row per family is a table invariant, so each crash is observed by its own restart.
    const ready = openRow(session, { family: "hindsight-lifecycle", operation: done, producer: { ...done.producer!, phase: "syncing" } as MemoryOperation["producer"] });
    const next = await j.restart("boot-b");
    expect(next.operations.status(ready)).toMatchObject({ state: "completed", reason: null, result: { kind: "bank", characterId: MIKA, readiness: "ready" },
      producer: { phase: "completed", admittedEpochId: epochId } });
    const stale = openRow(next, { family: "hindsight-lifecycle", operation: done,
      producer: { ...done.producer!, characterId: "rana", nativeBankId: hindsightBankBindings("rana")[1].externalBankId, phase: "applying" } as MemoryOperation["producer"] });
    const last = await j.restart("boot-c");
    expect(last.operations.status(stale)).toMatchObject({ state: "outcome_unknown", reason: "producer_incomplete", result: null, producer: { phase: "applying" } });
    expect(j.transport.calls("bank-stats")).toBe(stats);
    expect(j.transport.calls("bank-put")).toBe(puts);
  });

  it("settles a crashed revalidation only from the recorded fingerprint, its evidence and a runtime built on it", async () => {
    const j = journey();
    const { session, epochId } = await activatedInstance(j);
    session.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", 12_000);
    const rebound = await session.settled(revalidate(epochId));
    expect(rebound).toMatchObject({ state: "completed", result: { outcome: "rebound" } });
    const produced = vi.spyOn(hindsightLifecycle, "revalidateHindsightConnection");
    const recorded = openRow(session, { family: "hindsight-lifecycle", operation: rebound, producer: { ...rebound.producer!, phase: "rebinding" } as MemoryOperation["producer"] });
    const next = await j.restart("boot-b");
    expect(next.operations.status(recorded)).toMatchObject({ state: "completed", result: { kind: "connection", outcome: "rebound" }, producer: { phase: "completed" } });
    const unrecorded = openRow(next, { family: "hindsight-lifecycle", operation: rebound,
      producer: { ...rebound.producer!, fingerprintAfter: "f".repeat(64), phase: "validating" } as MemoryOperation["producer"] });
    const last = await j.restart("boot-c");
    expect(last.operations.status(unrecorded)).toMatchObject({ state: "outcome_unknown", reason: "producer_incomplete", producer: { phase: "validating" } });
    expect(produced).not.toHaveBeenCalled();
    expect((await last.runtime.captureRun(JOURNEY_CHARACTER)).snapshot.capabilities.recall).toBe(true);
  });
});

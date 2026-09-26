import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryOperation, MemoryOperationRequest } from "@taki/shared";
import { readApplicationCheckpoint } from "../../db/hindsight-application-replica-checkpoint.ts";
import { readReplicaCheckpoint } from "../../db/hindsight-replica-checkpoint-store.ts";
import { createMemoryOperationRepo } from "../../db/memory-operation-repo.ts";
import { createLogger } from "../../logging/logger.ts";
import {
  JOURNEY_CHARACTER, TOOL_OPTIONS, configureHindsight, createHindsightActivationJourney, onboardLocal, type HindsightActivationJourney, type JourneySession,
} from "../hindsight-activation/hindsight-activation-journey-fixture.ts";
import { createNativeBackupRouteDouble, type NativeBackupRouteDouble } from "../hindsight-backup/hindsight-backup-route-fixtures.ts";
import { createHindsightBackupStore } from "../hindsight-backup/hindsight-backup-store.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { EXCLUSIVE_MEMORY_FAMILIES, MemoryOperationRefusal } from "./memory-operation-contract.ts";
import { createMemoryOperationService } from "./memory-operation-service.ts";

type Family = (typeof EXCLUSIVE_MEMORY_FAMILIES)[number];
const BACKUP_ID = "11111111-1111-4111-8111-111111111111";

const journeys: HindsightActivationJourney[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const journey of journeys.splice(0)) await journey.close(); });

function journey(route?: NativeBackupRouteDouble) {
  const value = createHindsightActivationJourney({ backupRoute: route }); journeys.push(value); return value;
}

/** Native mirrors Core at snapshot time: every Bank at Core's checkpoints and every Core terminal id receipted. */
function mirroringRoute(j: () => HindsightActivationJourney): NativeBackupRouteDouble {
  const route = createNativeBackupRouteDouble({ providerLineage: "", banks: new Map(), receipts: new Set() });
  route.onSnapshot = (request) => {
    const { db } = j().session;
    route.state.providerLineage = request.providerLineageId;
    for (const bankId of request.nativeBankIds) {
      const replica = readReplicaCheckpoint(db, bankId); const application = readApplicationCheckpoint(db, bankId);
      route.state.banks.set(bankId, { bankGeneration: replica?.bankGeneration ?? "99999999-9999-4999-8999-999999999999",
        currentCursor: replica?.endCursor ?? 0,
        application: application ? { nativeCursor: application.checkpoint.native_cursor, stateCursor: application.checkpoint.state_cursor } : null });
    }
    for (const id of request.operationIds) route.state.receipts.add(id);
  };
  return route;
}

async function activated(j: HindsightActivationJourney) {
  const session = j.session;
  const localEpochId = await onboardLocal(session);
  await configureHindsight(session);
  const done = await session.settled({ kind: "hindsight.activate", source: { mode: "new", setupRevision: session.setup.status().revision, expectedEpochId: localEpochId } });
  expect(done.state).toBe("completed");
  return { session, localEpochId, epochId: readMemoryAuthoritySelection(session.db).epochId! };
}

const capture = (expectedEpochId: string): MemoryOperationRequest => ({ kind: "backup.capture", expectedEpochId });
const backupRows = (session: JourneySession) => session.operations.list({ includeTerminal: true, limit: 50 }).filter((operation) => operation.kind === "backup.capture");

function refusal(session: JourneySession, request: MemoryOperationRequest) {
  try { session.operations.submit(request); } catch (error) { if (error instanceof MemoryOperationRefusal) return { reason: error.reason, activeOperationId: error.activeOperationId }; throw error; }
  throw new Error("expected a refusal");
}

function openRow(session: JourneySession, input: { family: Family; operation: Pick<MemoryOperation, "kind" | "request" | "producer"> }): string {
  const repo = createMemoryOperationRepo(session.db); const operationId = crypto.randomUUID();
  repo.insertAdmitted({ operationId, kind: input.operation.kind, family: input.family, request: input.operation.request,
    producer: input.operation.producer!, bootId: "boot-old", authorityEpochId: null });
  repo.transition({ operationId, expectedState: "admitted", patch: { state: "running" } });
  return operationId;
}

describe("backup.capture — admission", () => {
  it("refuses under the Local marker, on a stale epoch, without a published runtime and without the producer, leaving no row", async () => {
    const j = journey(mirroringRoute(() => j));
    const session = j.session;
    const localEpochId = await onboardLocal(session);
    expect(refusal(session, capture(localEpochId))).toMatchObject({ reason: "MEMORY_OPERATION_UNSUPPORTED" });
    await configureHindsight(session);
    await session.settled({ kind: "hindsight.activate", source: { mode: "new", setupRevision: session.setup.status().revision, expectedEpochId: localEpochId } });
    const epochId = readMemoryAuthoritySelection(session.db).epochId!;
    expect(refusal(session, capture(localEpochId))).toMatchObject({ reason: "MEMORY_OPERATION_UNSUPPORTED" });
    const quiet = { setup: session.setup, local: session.local, hindsight: session.activation, logger: createLogger("fatal"), onChanged: () => undefined };
    const bare = createMemoryOperationService({ ...quiet, db: session.db, live: session.runtime.operations, bootId: "boot-bare" });
    expect(() => bare.submit(capture(epochId))).toThrow("MEMORY_OPERATION_UNSUPPORTED");
    const unbound = createMemoryOperationService({ ...quiet, db: session.db, live: () => null, backup: session.backup, bootId: "boot-unbound" });
    expect(() => unbound.submit(capture(epochId))).toThrow("MEMORY_OPERATION_UNSUPPORTED");
    expect(backupRows(session)).toEqual([]);
  });

  it("is exclusive with setup, onboarding, activation and lifecycle in both directions", async () => {
    const j = journey(mirroringRoute(() => j));
    const { session, epochId } = await activated(j);
    const history = session.operations.list({ includeTerminal: true, limit: 50 });
    const sample = (kind: MemoryOperation["kind"]) => history.find((operation) => operation.kind === kind)!;
    const revalidate = await session.settled({ kind: "connection.revalidate", expectedEpochId: epochId });
    const others: [Family, MemoryOperation][] = [["setup", sample("setup.validate")], ["local-onboarding", sample("local.onboard.prepare")],
      ["hindsight-activation", sample("hindsight.activate")], ["hindsight-lifecycle", revalidate]];
    for (const [family, operation] of others) {
      const open = openRow(session, { family, operation });
      expect(refusal(session, capture(epochId))).toEqual({ reason: "MEMORY_OPERATION_BUSY", activeOperationId: open });
      session.db.prepare("DELETE FROM memory_operations WHERE operation_id=:id").run({ id: open });
    }
    const open = openRow(session, { family: "hindsight-backup",
      operation: { kind: "backup.capture", request: capture(epochId), producer: { kind: "backup", backupId: BACKUP_ID, phase: "capturing-core" } } });
    const blocked: MemoryOperationRequest[] = [sample("setup.validate").request, sample("local.onboard.prepare").request,
      { kind: "hindsight.activate", source: { mode: "recover", epochId } }, { kind: "connection.revalidate", expectedEpochId: epochId }, capture(epochId)];
    for (const request of blocked) expect(refusal(session, request)).toEqual({ reason: "MEMORY_OPERATION_BUSY", activeOperationId: open });
    session.db.prepare("DELETE FROM memory_operations WHERE operation_id=:id").run({ id: open });
  });

  it("cancels only before the deferred claim, with no native call", async () => {
    const route = mirroringRoute(() => j); const j = journey(route);
    const { session, epochId } = await activated(j);
    const admitted = session.operations.submit(capture(epochId));
    expect(session.operations.cancel(admitted.operationId)).toMatchObject({ state: "cancelled" });
    await session.operations.stop();
    expect(route.requests).toEqual([]);
    expect(await createHindsightBackupStore(j.dataDir).list()).toEqual([]);
  });
});

describe("backup.capture — execution", () => {
  it("captures a verified pair while chat keeps committing and Run writes refuse retryably, then resumes writers", async () => {
    const route = mirroringRoute(() => j); const j = journey(route);
    const { session, epochId } = await activated(j);
    const run = await session.runtime.captureRun(JOURNEY_CHARACTER);
    const mirror = route.onSnapshot!;
    let during: unknown;
    route.onSnapshot = async (request) => {
      const entries = session.chat("备份的时候还能聊天吗？", "可以的。");
      const write = await run.tools.retain!.execute!({ content: "备份期间的写入。", layer: "episodes", context: null }, TOOL_OPTIONS);
      during = { chatted: entries.length, write, scheduler: session.runtime.operations()!.scheduler.started() };
      await mirror(request);
    };
    const settled = await session.settled(capture(epochId));
    expect(settled).toMatchObject({ state: "completed", errorCode: null, producer: { kind: "backup", phase: "completed" },
      result: { kind: "backup", mismatch: null } });
    expect(during).toMatchObject({ chatted: 2, write: { ok: false, code: "MEMORY_AUTHORITY_FENCED" }, scheduler: false });
    const [listed] = await createHindsightBackupStore(j.dataDir).list();
    expect(listed).toMatchObject({ backupId: (settled.producer as { backupId: string }).backupId, authority: { epochId }, banks: expect.any(Array) });
    expect(listed!.banks).toHaveLength(2);
    expect(session.runtime.operations()!.scheduler.started()).toBe(true);
    expect(await run.tools.retain!.execute!({ content: "备份之后的写入。", layer: "episodes", context: null }, TOOL_OPTIONS)).toMatchObject({ ok: true });
  });

  it("fails ROUTE_UNAVAILABLE on the production route without pausing anything", async () => {
    const j = journey();
    const { session, epochId } = await activated(j);
    const settled = await session.settled(capture(epochId));
    expect(settled).toMatchObject({ state: "failed", reason: "producer_refused", errorCode: "HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE", result: null });
    expect(session.runtime.operations()!.scheduler.started()).toBe(true);
  });

  it("records the pair mismatch in the result when native lacks a Core Bank", async () => {
    const route = mirroringRoute(() => j); const j = journey(route);
    const { session, epochId } = await activated(j);
    const mirror = route.onSnapshot!;
    route.onSnapshot = async (request) => { await mirror(request); route.state.banks.clear(); };
    const settled = await session.settled(capture(epochId));
    expect(settled).toMatchObject({ state: "failed", reason: "producer_failed", errorCode: "HINDSIGHT_BACKUP_PAIR_MISMATCH",
      result: { kind: "backup", verifiedAt: null, mismatch: { reason: "native_bank_id" } } });
    expect(await createHindsightBackupStore(j.dataDir).list()).toEqual([]);
  });
});

describe("backup.capture — boot observation", () => {
  it("settles a capture interrupted by a restart as outcome_unknown, quarantining its partial dir without redispatch", async () => {
    const route = mirroringRoute(() => j); const j = journey(route);
    const { session, epochId } = await activated(j);
    const store = createHindsightBackupStore(j.dataDir);
    await store.begin(BACKUP_ID);
    const open = openRow(session, { family: "hindsight-backup",
      operation: { kind: "backup.capture", request: capture(epochId), producer: { kind: "backup", backupId: BACKUP_ID, phase: "capturing-native" } } });
    const next = await j.restart("boot-b");
    expect(next.operations.status(open)).toMatchObject({ state: "outcome_unknown", reason: "producer_incomplete",
      producer: { kind: "backup", backupId: BACKUP_ID, phase: "capturing-native" } });
    expect(route.requests).toEqual([]);
    expect(await store.list()).toEqual([]);
    expect(readdirSync(store.root).filter((name) => name.endsWith(".partial"))).toEqual([]);
    expect(existsSync(join(store.root, "quarantine"))).toBe(true);
  });
});

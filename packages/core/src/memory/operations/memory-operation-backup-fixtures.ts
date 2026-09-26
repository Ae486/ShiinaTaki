/**
 * INPUT:  a Hindsight activation journey (Core DB, operation owner, backup producer, native route double)
 * OUTPUT: mirroringRoute() (native mirrors Core at snapshot time), activatedHindsight() (Legacy -> Local -> Hindsight),
 *         refusalOf() and openBackupRow() shared by the backup kind journey tests
 * POS:    core/memory/operations — test support; not in the production path
 */
import { expect } from "vitest";
import type { MemoryOperation, MemoryOperationRequest } from "@taki/shared";
import { readApplicationCheckpoint } from "../../db/hindsight-application-replica-checkpoint.ts";
import { readReplicaCheckpoint } from "../../db/hindsight-replica-checkpoint-store.ts";
import { createMemoryOperationRepo } from "../../db/memory-operation-repo.ts";
import {
  configureHindsight, onboardLocal, type HindsightActivationJourney, type JourneySession,
} from "../hindsight-activation/hindsight-activation-journey-fixture.ts";
import { createNativeBackupRouteDouble, type NativeBackupRouteDouble } from "../hindsight-backup/hindsight-backup-route-fixtures.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { MemoryOperationRefusal, type EXCLUSIVE_MEMORY_FAMILIES } from "./memory-operation-contract.ts";

export type ExclusiveFamily = (typeof EXCLUSIVE_MEMORY_FAMILIES)[number];

/** Native mirrors Core at snapshot time: every Bank at Core's checkpoints and every Core terminal id receipted. */
export function mirroringRoute(j: () => HindsightActivationJourney): NativeBackupRouteDouble {
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

export async function activatedHindsight(j: HindsightActivationJourney) {
  const session = j.session;
  const localEpochId = await onboardLocal(session);
  await configureHindsight(session);
  const done = await session.settled({ kind: "hindsight.activate", source: { mode: "new", setupRevision: session.setup.status().revision, expectedEpochId: localEpochId } });
  expect(done.state).toBe("completed");
  return { session, localEpochId, epochId: readMemoryAuthoritySelection(session.db).epochId! };
}

export function refusalOf(session: JourneySession, request: MemoryOperationRequest) {
  try { session.operations.submit(request); } catch (error) { if (error instanceof MemoryOperationRefusal) return { reason: error.reason, activeOperationId: error.activeOperationId }; throw error; }
  throw new Error("expected a refusal");
}

/** A running row another boot left open, inserted directly so no producer runs. */
export function openBackupRow(session: JourneySession, input: { family: ExclusiveFamily; operation: Pick<MemoryOperation, "kind" | "request" | "producer"> }): string {
  const repo = createMemoryOperationRepo(session.db); const operationId = crypto.randomUUID();
  repo.insertAdmitted({ operationId, kind: input.operation.kind, family: input.family, request: input.operation.request,
    producer: input.operation.producer!, bootId: "boot-old", authorityEpochId: null });
  repo.transition({ operationId, expectedState: "admitted", patch: { state: "running" } });
  return operationId;
}

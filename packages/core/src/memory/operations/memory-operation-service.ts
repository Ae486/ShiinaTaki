/**
 * INPUT:  operator operation requests (plus Core's automatic lifecycle submissions), the kind registry, the live Hindsight
 *         runtime accessor, the B3 setup service and the optional Local onboarding / Hindsight activation / lifecycle / backup
 *         services and optional transition driver
 * OUTPUT: createMemoryOperationService() — durable admit/execute/observe/settle/cancel with transition fan-out
 * POS:    core/memory/operations — the single operation owner (D-S1-1); every state change is a repo CAS, then onChanged
 */
import { randomUUID } from "node:crypto";
import type { MemoryOperation, MemoryOperationListParams, MemoryOperationProducerRef, MemoryOperationRequest } from "@taki/shared";
import { MemoryTransitionErrorCodeSchema } from "@taki/shared";
import { createMemoryOperationRepo, type MemoryOperationRepo } from "../../db/memory-operation-repo.ts";
import { readReplicaRequest } from "../../db/hindsight-replica-request-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import type { Logger } from "../../logging/logger.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import type { HindsightActivationService } from "../hindsight-activation/hindsight-activation-service.ts";
import type { HindsightBackupService } from "../hindsight-backup/hindsight-backup-service.ts";
import type { HindsightLifecycleService } from "../hindsight-lifecycle/hindsight-lifecycle-service.ts";
import type { HindsightSetupService } from "../hindsight/hindsight-setup-service.ts";
import type { LocalOnboardingService } from "../local-onboarding/local-onboarding-service.ts";
import {
  MemoryOperationRefusal, type MemoryOperationAdmission, type MemoryOperationContext, type MemoryOperationKindHandler, type MemoryOperationSettlement,
  type MemoryOperationsRuntime,
} from "./memory-operation-contract.ts";
import { MEMORY_OPERATION_KINDS, memoryOperationHandler, type MemoryOperationKindRegistry } from "./memory-operation-kinds.ts";
import { createTransitionOperationStorage, type MemoryTransitionDriver } from "./memory-operation-transition-storage.ts";
import { withTransitionAdmissionContext } from "../transitions/transition-evidence-context.ts";
import { quarantineEmergencyProducers, operationIsQuarantined } from "../../db/memory-transition-emergency-quarantine.ts";

export interface MemoryOperationService {
  /** The origin defaults to the operator; only Core's automatic lifecycle trigger passes "automatic". */
  submit(request: MemoryOperationRequest, admission?: MemoryOperationAdmission): MemoryOperation;
  status(operationId: string): MemoryOperation;
  list(params: MemoryOperationListParams): MemoryOperation[];
  /** Terminal rows, newest settlement first, for the composite status read. */
  recent(limit: number): MemoryOperation[];
  /** The newest row of one family, refreshed when still open; the onboarding status derives its actions from it. */
  latest(family: string): MemoryOperation | undefined;
  cancel(operationId: string): MemoryOperation;
  /** Awaits in-flight settlements; producers are stopped by their own owners (memory runtime, setup deadlines). */
  stop(): Promise<void>;
}

export interface MemoryOperationServiceInput {
  db: Database;
  live(): MemoryOperationsRuntime | null;
  setup: HindsightSetupService;
  local?: LocalOnboardingService;
  hindsight?: HindsightActivationService;
  lifecycle?: HindsightLifecycleService;
  backup?: HindsightBackupService;
  transition?: MemoryTransitionDriver;
  bootId: string;
  onChanged(operation: MemoryOperation): void;
  logger: Logger;
  kinds?: MemoryOperationKindRegistry;
  repo?: MemoryOperationRepo;
  now?: () => string;
}

interface Owner {
  repo: MemoryOperationRepo; kinds: MemoryOperationKindRegistry; ctx: MemoryOperationContext; input: MemoryOperationServiceInput;
  inflight: Map<Promise<void>, string>;
}

export function createMemoryOperationService(input: MemoryOperationServiceInput): MemoryOperationService {
  const now = input.now ?? (() => new Date().toISOString());
  const repo = input.repo ?? createMemoryOperationRepo(input.db, now);
  const owner: Owner = {
    repo, kinds: input.kinds ?? MEMORY_OPERATION_KINDS,
    ctx: { live: input.live, setup: input.setup, local: input.local, hindsight: input.hindsight, lifecycle: input.lifecycle, backup: input.backup,
      transition: input.transition, transitionStorage: createTransitionOperationStorage(input.db),
      lookup: (operationId) => repo.get(operationId),
      replicaRequest: (requestId) => readReplicaRequest(input.db, requestId),
      activeInFamily: (family) => repo.activeInFamily(family), latestInFamily: (family) => repo.latestInFamily(family), now }, input, inflight: new Map(),
  };
  observeBoot(owner);
  // A previous process cannot report what happened to its open rows; unknown stays unknown (D-S1-3).
  for (const operation of owner.repo.reconcileForeign(input.bootId)) input.onChanged(operation);
  return {
    submit: (request, admission) => submit(owner, request, admission ?? { origin: "operator" }),
    status: (operationId) => refresh(owner, requireOperation(owner, operationId)),
    list: (params) => list(owner, params),
    recent: (limit) => owner.repo.listRecent(limit),
    latest: (family) => { const row = owner.repo.latestInFamily(family); return row ? refresh(owner, row) : undefined; },
    cancel: (operationId) => cancel(owner, operationId),
    stop: async () => {
      const required = () => [...owner.inflight].filter(([, id]) => !operationIsQuarantined(input.db, id)).map(([promise]) => promise);
      while (required().length > 0) await Promise.allSettled(required());
    },
  };
}

/** Kinds with durable producer receipts reconstruct proven outcomes before the generic fallback; observation never dispatches work. */
function observeBoot(owner: Owner): void {
  for (const operation of owner.repo.listForeign(owner.input.bootId)) {
    const handler = memoryOperationHandler(owner.kinds, operation.kind);
    let settlement: MemoryOperationSettlement | null = null;
    try { settlement = handler.observeBoot?.(operation, owner.ctx) ?? null; }
    catch (error) {
      owner.input.logger.child({ mod: "memory-operations" }).warn({ operationId: operation.operationId, err: error instanceof Error ? error.name : "unknown" }, "boot observation failed; row stays unknown");
    }
    if (settlement) settle(owner, operation.operationId, settlement);
  }
}

function submit(owner: Owner, request: MemoryOperationRequest, admission: MemoryOperationAdmission): MemoryOperation {
  const handler = memoryOperationHandler(owner.kinds, request.kind);
  const family = handler.family(request);
  const operationId = randomUUID();
  let admitted: MemoryOperation | undefined;
  let existing: MemoryOperation | undefined;
  let quarantined: MemoryOperation[] = [];
  try {
    owner.input.db.transaction(() => {
      existing = handler.existing?.(request, owner.ctx);
      if (existing) return;
      const persist = (ctx: MemoryOperationContext) => {
        const producer = handler.admit(request, ctx, admission);
        if (request.kind === "transition.emergency-local" && !request.recovery) quarantined = quarantineEmergencyProducers(owner.input.db,
          { repo: owner.repo, emergencyOperationId: operationId, epochId: request.expected.predecessorEpochId,
            bankIds: request.expected.banks.map((bank) => bank.sourceBankId), now: ctx.now() });
        admitted = owner.repo.insertAdmitted({ operationId, kind: request.kind, family, request, producer, bootId: owner.input.bootId,
          authorityEpochId: readMemoryAuthoritySelection(owner.input.db, ctx.admissionVerification).epochId });
        handler.persistAdmission?.(admitted, ctx);
      };
      // This lifetime is inside the transaction and ends before notification or async execution.
      // Never attach it to owner.ctx: later work and nested/new submissions need independent proof.
      if (family === "memory-transition") withTransitionAdmissionContext({ db: owner.input.db, startedAt: owner.ctx.now() },
        (verification) => persist({ ...owner.ctx, admissionVerification: verification }));
      else persist(owner.ctx);
    });
  } catch (error) {
    // A handler already identified the conflicting family owner; preserve that actionable identity.
    if (error instanceof MemoryOperationRefusal) throw error;
    const transitionError = MemoryTransitionErrorCodeSchema.safeParse(error instanceof Error ? error.message : null);
    if (transitionError.success) throw new MemoryOperationRefusal(transitionError.data);
    if (!(error instanceof Error) || error.message !== "MEMORY_OPERATION_BUSY") throw error;
    throw new MemoryOperationRefusal("MEMORY_OPERATION_BUSY", owner.repo.activeInFamily(family)?.operationId ?? null);
  }
  if (existing) return existing;
  if (!admitted?.producer) throw new Error("MEMORY_OPERATION_NOT_FOUND");
  if (request.kind === "transition.emergency-local") owner.ctx.transition?.emergencyAdmitted?.(request.expected.predecessorEpochId);
  for (const operation of quarantined) owner.input.onChanged(operation);
  owner.input.onChanged(admitted);
  const execution = execute(owner, handler, { operationId, request, producer: admitted.producer });
  owner.inflight.set(execution, operationId);
  void execution.finally(() => owner.inflight.delete(execution));
  return requireOperation(owner, operationId);
}

async function execute(owner: Owner, handler: MemoryOperationKindHandler, input: { operationId: string; request: MemoryOperationRequest; producer: MemoryOperationProducerRef }): Promise<void> {
  const { operationId } = input;
  const claim = () => transition(owner, operationId, (current) => current.state === "admitted" ? { state: "running" } : null);
  try {
    const settlement = await handler.execute({
      operationId, request: input.request, producer: input.producer, ctx: owner.ctx, running: () => { claim(); },
      tryClaim: () => claim()?.state === "running",
      checkpoint: (producer) => { transition(owner, operationId, (current) => current.state === "running" ? { producer } : null); },
    });
    if (settlement) settle(owner, operationId, settlement);
  } catch (error) {
    owner.input.logger.child({ mod: "memory-operations" }).error({ operationId, err: error instanceof Error ? error.name : "unknown" }, "memory operation execution threw");
    settle(owner, operationId, { state: "failed", reason: "producer_failed", errorCode: null, result: null });
  }
}

function settle(owner: Owner, operationId: string, settlement: MemoryOperationSettlement): void {
  transition(owner, operationId, (current) => current.terminalAt !== null ? null : {
    state: settlement.state, reason: settlement.reason, errorCode: settlement.errorCode, result: settlement.result,
    ...(settlement.producer ? { producer: settlement.producer } : {}),
  });
}

type Patch = Parameters<MemoryOperationRepo["transition"]>[0]["patch"];
/** Reads the row, applies the CAS patch the caller derives from it, and publishes; a lost race is not an error. */
function transition(owner: Owner, operationId: string, patch: (current: MemoryOperation) => Patch | null): MemoryOperation | undefined {
  const current = owner.repo.get(operationId);
  if (!current) return undefined;
  const change = patch(current);
  if (!change) return current;
  try {
    const next = owner.repo.transition({ operationId, expectedState: current.state, patch: change });
    owner.input.onChanged(next);
    return next;
  } catch (error) {
    if (error instanceof Error && error.message === "MEMORY_OPERATION_STATE_CONFLICT") return owner.repo.get(operationId);
    throw error;
  }
}

function refresh(owner: Owner, operation: MemoryOperation): MemoryOperation {
  if (operation.terminalAt !== null) return operation;
  const observation = memoryOperationHandler(owner.kinds, operation.kind).observe?.(operation, owner.ctx) ?? null;
  if (!observation) return operation;
  if (observation.kind === "running") {
    return transition(owner, operation.operationId, (current) => current.state === "admitted" ? { state: "running" } : null) ?? operation;
  }
  settle(owner, operation.operationId, observation.settlement);
  return requireOperation(owner, operation.operationId);
}

function list(owner: Owner, params: MemoryOperationListParams): MemoryOperation[] {
  const active = owner.repo.listActive().map((operation) => refresh(owner, operation)).filter((operation) => operation.terminalAt === null);
  const recent = params.includeTerminal ? owner.repo.listRecent(params.limit) : [];
  return [...active, ...recent].slice(0, params.limit);
}

function cancel(owner: Owner, operationId: string): MemoryOperation {
  const current = refresh(owner, requireOperation(owner, operationId));
  if (current.terminalAt !== null) throw new MemoryOperationRefusal("MEMORY_OPERATION_SETTLED");
  const handler = memoryOperationHandler(owner.kinds, current.kind);
  if (!handler.cancel) throw new MemoryOperationRefusal("MEMORY_OPERATION_RUNNING");
  handler.cancel(current, owner.ctx);
  const next = transition(owner, operationId, (row) => row.terminalAt !== null ? null : { state: "cancelled", reason: "cancelled_before_claim" });
  if (!next || next.state !== "cancelled") throw new MemoryOperationRefusal("MEMORY_OPERATION_SETTLED");
  return next;
}

function requireOperation(owner: Owner, operationId: string): MemoryOperation {
  const operation = owner.repo.get(operationId);
  if (!operation) throw new MemoryOperationRefusal("MEMORY_OPERATION_NOT_FOUND");
  return operation;
}

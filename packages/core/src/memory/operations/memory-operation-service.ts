/**
 * INPUT:  operator operation requests (plus Core's automatic lifecycle submissions), the kind registry, the live Hindsight
 *         runtime accessor, the B3 setup service and the optional Local onboarding / Hindsight activation / lifecycle / backup
 *         services
 * OUTPUT: createMemoryOperationService() — durable admit/execute/observe/settle/cancel with transition fan-out
 * POS:    core/memory/operations — the single operation owner (D-S1-1); every state change is a repo CAS, then onChanged
 */
import { randomUUID } from "node:crypto";
import type { MemoryOperation, MemoryOperationListParams, MemoryOperationProducerRef, MemoryOperationRequest } from "@taki/shared";
import { createMemoryOperationRepo, type MemoryOperationRepo } from "../../db/memory-operation-repo.ts";
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
  bootId: string;
  onChanged(operation: MemoryOperation): void;
  logger: Logger;
  kinds?: MemoryOperationKindRegistry;
  repo?: MemoryOperationRepo;
  now?: () => string;
}

interface Owner {
  repo: MemoryOperationRepo; kinds: MemoryOperationKindRegistry; ctx: MemoryOperationContext; input: MemoryOperationServiceInput;
  inflight: Set<Promise<void>>;
}

export function createMemoryOperationService(input: MemoryOperationServiceInput): MemoryOperationService {
  const now = input.now ?? (() => new Date().toISOString());
  const repo = input.repo ?? createMemoryOperationRepo(input.db, now);
  const owner: Owner = {
    repo, kinds: input.kinds ?? MEMORY_OPERATION_KINDS,
    ctx: { live: input.live, setup: input.setup, local: input.local, hindsight: input.hindsight, lifecycle: input.lifecycle, backup: input.backup,
      lookup: (operationId) => repo.get(operationId),
      activeInFamily: (family) => repo.activeInFamily(family), latestInFamily: (family) => repo.latestInFamily(family), now }, input, inflight: new Set(),
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
    stop: async () => { while (owner.inflight.size > 0) await Promise.allSettled([...owner.inflight]); },
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
  const producer = handler.admit(request, owner.ctx, admission);
  const family = handler.family(request);
  const operationId = randomUUID();
  let admitted: MemoryOperation;
  try {
    admitted = owner.repo.insertAdmitted({ operationId, kind: request.kind, family, request, producer, bootId: owner.input.bootId,
      authorityEpochId: readMemoryAuthoritySelection(owner.input.db).epochId });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "MEMORY_OPERATION_BUSY") throw error;
    throw new MemoryOperationRefusal("MEMORY_OPERATION_BUSY", owner.repo.activeInFamily(family)?.operationId ?? null);
  }
  owner.input.onChanged(admitted);
  const execution = execute(owner, handler, { operationId, request, producer });
  owner.inflight.add(execution);
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

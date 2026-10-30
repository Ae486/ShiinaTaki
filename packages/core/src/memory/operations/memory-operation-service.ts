/**
 * INPUT:  operator operation requests, the kind registry, the live Hindsight runtime accessor and the B3 setup service
 * OUTPUT: createMemoryOperationService() — durable admit/execute/observe/settle/cancel with transition fan-out
 * POS:    core/memory/operations — the single operation owner (D-S1-1); every state change is a repo CAS, then onChanged
 */
import { randomUUID } from "node:crypto";
import type { MemoryOperation, MemoryOperationListParams, MemoryOperationProducerRef, MemoryOperationRequest } from "@taki/shared";
import { createMemoryOperationRepo, type MemoryOperationRepo } from "../../db/memory-operation-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import type { Logger } from "../../logging/logger.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import type { HindsightSetupService } from "../hindsight/hindsight-setup-service.ts";
import {
  MemoryOperationRefusal, type MemoryOperationContext, type MemoryOperationKindHandler, type MemoryOperationSettlement,
  type MemoryOperationsRuntime,
} from "./memory-operation-contract.ts";
import { MEMORY_OPERATION_KINDS, memoryOperationHandler, type MemoryOperationKindRegistry } from "./memory-operation-kinds.ts";

export interface MemoryOperationService {
  submit(request: MemoryOperationRequest): MemoryOperation;
  status(operationId: string): MemoryOperation;
  list(params: MemoryOperationListParams): MemoryOperation[];
  /** Terminal rows, newest settlement first, for the composite status read. */
  recent(limit: number): MemoryOperation[];
  cancel(operationId: string): MemoryOperation;
  /** Awaits in-flight settlements; producers are stopped by their own owners (memory runtime, setup deadlines). */
  stop(): Promise<void>;
}

export interface MemoryOperationServiceInput {
  db: Database;
  live(): MemoryOperationsRuntime | null;
  setup: HindsightSetupService;
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
  const owner: Owner = {
    repo: input.repo ?? createMemoryOperationRepo(input.db, now), kinds: input.kinds ?? MEMORY_OPERATION_KINDS,
    ctx: { live: input.live, setup: input.setup, now }, input, inflight: new Set(),
  };
  // A previous process cannot report what happened to its open rows; unknown stays unknown (D-S1-3).
  for (const operation of owner.repo.reconcileForeign(input.bootId)) input.onChanged(operation);
  return {
    submit: (request) => submit(owner, request),
    status: (operationId) => refresh(owner, requireOperation(owner, operationId)),
    list: (params) => list(owner, params),
    recent: (limit) => owner.repo.listRecent(limit),
    cancel: (operationId) => cancel(owner, operationId),
    stop: async () => { while (owner.inflight.size > 0) await Promise.allSettled([...owner.inflight]); },
  };
}

function submit(owner: Owner, request: MemoryOperationRequest): MemoryOperation {
  const handler = memoryOperationHandler(owner.kinds, request.kind);
  const producer = handler.admit(request, owner.ctx);
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
  const running = () => transition(owner, operationId, (current) => current.state === "admitted" ? { state: "running" } : null);
  try {
    const settlement = await handler.execute({ request: input.request, producer: input.producer, ctx: owner.ctx, running });
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

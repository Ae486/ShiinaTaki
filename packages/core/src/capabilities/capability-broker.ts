/**
 * INPUT:  explicit Host dispatch descriptors; exact Node capability.respond/challenge frames; abort/deadline/disconnect events
 * OUTPUT: createCapabilityBroker() -> request/challenge/resolve/cancelGeneration with Host+generation-owned settlement
 * POS:    core/capabilities — single atomic owner of pending Host attempts; never replays after terminal uncertainty
 */
import { randomUUID } from "node:crypto";
import {
  CAPABILITY_METHODS,
  type CapabilityCancel,
  type CapabilityChallenge,
  type CapabilityRequest,
  type CapabilityRespondParams,
  type CapabilityRespondResult,
  type HostOperationControl,
} from "@taki/shared";
import type { ApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import type { Logger } from "../logging/logger.ts";
import { capabilityInputDigest } from "./canonical-input.ts";
import { acceptCapabilityChallenge, retireChallengesForGeneration, retireChallengesForPolicy } from "./capability-challenge.ts";
import {
  TIMEOUT_MESSAGE,
  interruptedOutcome,
  notifyHostCancel,
  releaseChallenge,
  settlePending,
  type CapabilityBrokerState,
  type CapabilityDispatchTarget,
  type PendingCapability,
} from "./capability-broker-state.ts";
import { responseOutcome, terminalFailure } from "./capability-response.ts";

export type CapabilityFailureCode =
  | "DENIED"
  | "APPROVAL_REQUIRED"
  | "EXEC_FAILED"
  | "UNSUPPORTED_CAPABILITY"
  | "CAPABILITY_TIMEOUT"
  | "NODE_DISCONNECTED"
  | "CANCELLED"
  | "OUTCOME_UNKNOWN";

export type CapabilityOutcome =
  | { ok: true; output: unknown }
  | { ok: false; code: CapabilityFailureCode; message: string; state?: "cancelled" | "outcome_unknown" };

export interface CapabilityBroker {
  request(target: CapabilityDispatchTarget, input: unknown, identity?: CapabilityRequestIdentity): Promise<CapabilityOutcome>;
  challenge(params: CapabilityChallenge, provenance: { hostId: string; connectionGeneration: number }): CapabilityRespondResult;
  resolve(params: CapabilityRespondParams, provenance: { hostId: string; connectionGeneration: number }): CapabilityRespondResult;
  cancelGeneration(hostId: string, connectionGeneration: number, reason: string): void;
}

export type { CapabilityDispatchTarget, CapabilityNotify } from "./capability-broker-state.ts";
export { TERMINAL_RECORD_LIMIT } from "./capability-broker-state.ts";
export { TIMEOUT_MESSAGE } from "./capability-broker-state.ts";

export interface CapabilityRequestIdentity {
  runId?: string;
  operationId?: string;
  approvalGeneration?: number;
}

const DEFAULT_TIMEOUT_MS = 90_000;

export function createCapabilityBroker(deps: {
  logger: Logger;
  approval: ApprovalInteractionService;
  timeoutMs?: number;
  now?: () => number;
}): CapabilityBroker {
  const log = deps.logger.child({ mod: "capability" });
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const state: CapabilityBrokerState = {
    log,
    approval: deps.approval,
    now: deps.now ?? Date.now,
    pending: new Map(),
    terminal: new Map(),
  };
  // Registered ONCE per broker: append-only listener arrays make per-request subscription a leak.
  deps.approval.onApprovalGenerationChanged((generation) => retireChallengesForGeneration(state, generation));
  deps.approval.onPolicyInvalidated((generation) => retireChallengesForPolicy(state, generation));

  return {
    request: (target, input, identity = {}) => dispatchRequest({ state, target, input, identity, timeoutMs, log }),
    challenge: (params, provenance) => acceptCapabilityChallenge(state, params, provenance),
    resolve: (params, provenance) => resolveResponse(state, params, provenance),
    cancelGeneration(hostId, connectionGeneration, reason) {
      for (const [requestId, entry] of state.pending) {
        if (entry.control.targetHostId !== hostId || entry.control.connectionGeneration !== connectionGeneration) continue;
        bestEffortCancel(requestId, entry, "generation_retired");
        settlePending(state, requestId, {
          outcome: interruptedOutcome(entry.execution, reason),
          terminalReason: "late",
        });
      }
    },
  };
}

function dispatchRequest(args: {
  state: CapabilityBrokerState;
  target: CapabilityDispatchTarget;
  input: unknown;
  identity: CapabilityRequestIdentity;
  timeoutMs: number;
  log: Logger;
}): Promise<CapabilityOutcome> {
  const { state, target, input, identity, timeoutMs } = args;
  const requestId = randomUUID();
  const control = makeControl({ target, input, identity, dispatchedMs: state.now(), timeoutMs });
  return new Promise<CapabilityOutcome>((resolve) => {
    const entry: PendingCapability = {
      control,
      input,
      target,
      execution: target.descriptor.execution,
      cancellation: target.descriptor.cancellation,
      finish: resolve,
      timer: setTimeout(() => expire(state, requestId), timeoutMs),
    };
    state.pending.set(requestId, entry);
    target.notify(CAPABILITY_METHODS.request, { requestId, control, input } satisfies CapabilityRequest);
    args.log.info({ requestId, attemptId: control.attemptId, capability: control.capabilityId }, "capability requested");
  });
}

function resolveResponse(
  state: CapabilityBrokerState,
  params: CapabilityRespondParams,
  provenance: { hostId: string; connectionGeneration: number },
): CapabilityRespondResult {
  const pending = state.pending.get(params.requestId);
  if (pending) {
    const failure = terminalFailure({ expected: pending.control, expectedAuthorization: pending.authorization, params, provenance });
    if (failure) return failure;
    settlePending(state, params.requestId, { outcome: responseOutcome(params), terminalReason: "duplicate" });
    return { accepted: true };
  }
  const terminal = state.terminal.get(params.requestId);
  if (!terminal) return { accepted: false, reason: "unknown_request" };
  return terminalFailure({ expected: terminal.control, expectedAuthorization: terminal.authorization, params, provenance })
    ?? { accepted: false, reason: terminal.reason };
}

function expire(state: CapabilityBrokerState, requestId: string): void {
  const entry = state.pending.get(requestId);
  if (!entry) return;
  bestEffortCancel(requestId, entry, "deadline_exceeded");
  const outcome = entry.execution === "effect"
    ? { ok: false as const, code: "OUTCOME_UNKNOWN" as const, message: TIMEOUT_MESSAGE, state: "outcome_unknown" as const }
    : { ok: false as const, code: "CAPABILITY_TIMEOUT" as const, message: TIMEOUT_MESSAGE };
  settlePending(state, requestId, { outcome, terminalReason: "late" });
}

function makeControl({ target, input, identity, dispatchedMs, timeoutMs }: {
  target: CapabilityDispatchTarget;
  input: unknown;
  identity: CapabilityRequestIdentity;
  dispatchedMs: number;
  timeoutMs: number;
}): HostOperationControl {
  return {
    runId: identity.runId ?? randomUUID(),
    operationId: identity.operationId ?? randomUUID(),
    attemptId: randomUUID(),
    targetHostId: target.hostId,
    connectionGeneration: target.connectionGeneration,
    catalogGeneration: target.catalogGeneration,
    policyGeneration: target.policyGeneration,
    governanceProjection: target.governanceProjection,
    approvalGeneration: identity.approvalGeneration ?? 1,
    capabilityId: target.descriptor.capabilityId,
    inputDigest: capabilityInputDigest(target.descriptor.capabilityId, input),
    idempotencyKey: randomUUID(),
    dispatchedAt: new Date(dispatchedMs).toISOString(),
    deadlineAt: new Date(dispatchedMs + timeoutMs).toISOString(),
  };
}

function bestEffortCancel(requestId: string, entry: PendingCapability, reason: CapabilityCancel["reason"]): void {
  releaseChallenge(entry);
  if (entry.cancellation === "cooperative") {
    notifyHostCancel(entry, requestId, reason);
  }
}

/**
 * INPUT:  explicit Host dispatch descriptors; exact Node capability.respond frames; abort/deadline/disconnect events
 * OUTPUT: createCapabilityBroker() -> request/resolve/cancelGeneration with Host+generation-owned settlement
 * POS:    core/capabilities — single atomic owner of pending Host attempts; never replays after terminal uncertainty
 */
import { randomUUID } from "node:crypto";
import {
  CAPABILITY_METHODS,
  type CapabilityCancel,
  type CapabilityCancellation,
  type CapabilityExecutionKind,
  type CapabilityRequest,
  type CapabilityRespondParams,
  type CapabilityRespondResult,
  type HostCapabilityDescriptor,
  type HostFrameRejectReason,
  type HostOperationControl,
} from "@taki/shared";
import type { Logger } from "../logging/logger.ts";
import { capabilityInputDigest } from "./canonical-input.ts";

export type CapabilityFailureCode =
  | "DENIED"
  | "EXEC_FAILED"
  | "UNSUPPORTED_CAPABILITY"
  | "CAPABILITY_TIMEOUT"
  | "NODE_DISCONNECTED"
  | "CANCELLED"
  | "OUTCOME_UNKNOWN";

export type CapabilityOutcome =
  | { ok: true; output: unknown }
  | { ok: false; code: CapabilityFailureCode; message: string; state?: "cancelled" | "outcome_unknown" };

export type CapabilityNotify = (method: string, params: unknown) => void;

export interface CapabilityDispatchTarget {
  hostId: string;
  connectionGeneration: number;
  catalogGeneration: number;
  descriptor: HostCapabilityDescriptor;
  notify: CapabilityNotify;
}

export interface CapabilityRequestIdentity {
  runId?: string;
  operationId?: string;
  policyGeneration?: number;
  approvalGeneration?: number;
}

export interface CapabilityBroker {
  request(
    target: CapabilityDispatchTarget,
    input: unknown,
    identity?: CapabilityRequestIdentity,
  ): Promise<CapabilityOutcome>;
  resolve(params: CapabilityRespondParams, provenance: { hostId: string; connectionGeneration: number }): CapabilityRespondResult;
  cancelGeneration(hostId: string, connectionGeneration: number, reason: string): void;
}

const DEFAULT_TIMEOUT_MS = 90_000;
export const TERMINAL_RECORD_LIMIT = 256;
export const TIMEOUT_MESSAGE = "capability request timed out";

interface Pending {
  control: HostOperationControl;
  execution: CapabilityExecutionKind;
  cancellation: CapabilityCancellation;
  notify: CapabilityNotify;
  finish: (outcome: CapabilityOutcome) => void;
}

interface BrokerState {
  log: Logger;
  pending: Map<string, Pending>;
  terminal: Map<string, TerminalRecord>;
}

interface TerminalRecord {
  control: HostOperationControl;
  reason: Extract<HostFrameRejectReason, "duplicate" | "late">;
}

interface ControlInput {
  target: CapabilityDispatchTarget;
  input: unknown;
  identity: CapabilityRequestIdentity;
  dispatchedMs: number;
  timeoutMs: number;
}

export function createCapabilityBroker(deps: { logger: Logger; timeoutMs?: number; now?: () => number }): CapabilityBroker {
  const log = deps.logger.child({ mod: "capability" });
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = deps.now ?? Date.now;
  const pending = new Map<string, Pending>();
  const state: BrokerState = { log, pending, terminal: new Map() };

  return {
    request(target, input, identity = {}) {
      const requestId = randomUUID();
      const dispatchedMs = now();
      const control = makeControl({ target, input, identity, dispatchedMs, timeoutMs });
      return new Promise<CapabilityOutcome>((resolve) => {
        const timer = setTimeout(() => expire(state, requestId), timeoutMs);
        pending.set(requestId, {
          control,
          execution: target.descriptor.execution,
          cancellation: target.descriptor.cancellation,
          notify: target.notify,
          finish: (outcome) => { clearTimeout(timer); resolve(outcome); },
        });
        target.notify(CAPABILITY_METHODS.request, { requestId, control, input } satisfies CapabilityRequest);
        log.info({ requestId, attemptId: control.attemptId, capability: control.capabilityId }, "capability requested");
      });
    },
    resolve: (params, provenance) => resolveResponse(state, params, provenance),
    cancelGeneration(hostId, connectionGeneration, reason) {
      for (const [requestId, entry] of pending) {
        if (entry.control.targetHostId !== hostId || entry.control.connectionGeneration !== connectionGeneration) continue;
        bestEffortCancel(requestId, entry, "generation_retired");
        settle(state, requestId, { outcome: interruptedOutcome(entry.execution, reason), terminalReason: "late" });
      }
    },
  };
}

function resolveResponse(
  state: BrokerState,
  params: CapabilityRespondParams,
  provenance: { hostId: string; connectionGeneration: number },
): CapabilityRespondResult {
  const pending = state.pending.get(params.requestId);
  if (pending) {
    const failure = provenanceFailure(pending.control, params.control, provenance);
    if (failure) return failure;
    settle(state, params.requestId, { outcome: responseOutcome(params), terminalReason: "duplicate" });
    return { accepted: true };
  }
  const terminal = state.terminal.get(params.requestId);
  if (!terminal) return { accepted: false, reason: "unknown_request" };
  return provenanceFailure(terminal.control, params.control, provenance) ?? {
    accepted: false,
    reason: terminal.reason,
  };
}

function provenanceFailure(
  expected: HostOperationControl,
  actual: HostOperationControl,
  provenance: { hostId: string; connectionGeneration: number },
): CapabilityRespondResult | undefined {
  if (provenance.hostId !== expected.targetHostId) return { accepted: false, reason: "wrong_host" };
  if (provenance.connectionGeneration !== expected.connectionGeneration) {
    return { accepted: false, reason: "stale_generation" };
  }
  if (!sameControl(actual, expected)) return { accepted: false, reason: "stale_generation" };
  return undefined;
}

function settle(
  state: BrokerState,
  requestId: string,
  terminal: { outcome: CapabilityOutcome; terminalReason: TerminalRecord["reason"] },
): boolean {
  const entry = state.pending.get(requestId);
  if (!entry) return false;
  state.pending.delete(requestId);
  rememberTerminal(state.terminal, requestId, { control: entry.control, reason: terminal.terminalReason });
  state.log.info({ requestId, attemptId: entry.control.attemptId, ok: terminal.outcome.ok }, "capability settled");
  entry.finish(terminal.outcome);
  return true;
}

function rememberTerminal(records: Map<string, TerminalRecord>, requestId: string, terminal: TerminalRecord): void {
  if (records.size >= TERMINAL_RECORD_LIMIT) {
    const oldest = records.keys().next().value as string | undefined;
    if (oldest !== undefined) records.delete(oldest);
  }
  records.set(requestId, terminal);
}

function expire(state: BrokerState, requestId: string): void {
  const entry = state.pending.get(requestId);
  if (!entry) return;
  bestEffortCancel(requestId, entry, "deadline_exceeded");
  const outcome = entry.execution === "effect"
    ? { ok: false as const, code: "OUTCOME_UNKNOWN" as const, message: TIMEOUT_MESSAGE, state: "outcome_unknown" as const }
    : { ok: false as const, code: "CAPABILITY_TIMEOUT" as const, message: TIMEOUT_MESSAGE };
  settle(state, requestId, { outcome, terminalReason: "late" });
}

function makeControl({ target, input, identity, dispatchedMs, timeoutMs }: ControlInput): HostOperationControl {
  return {
    runId: identity.runId ?? randomUUID(),
    operationId: identity.operationId ?? randomUUID(),
    attemptId: randomUUID(),
    targetHostId: target.hostId,
    connectionGeneration: target.connectionGeneration,
    catalogGeneration: target.catalogGeneration,
    policyGeneration: identity.policyGeneration ?? 1,
    approvalGeneration: identity.approvalGeneration ?? 1,
    capabilityId: target.descriptor.capabilityId,
    inputDigest: capabilityInputDigest(target.descriptor.capabilityId, input),
    idempotencyKey: randomUUID(),
    dispatchedAt: new Date(dispatchedMs).toISOString(),
    deadlineAt: new Date(dispatchedMs + timeoutMs).toISOString(),
  };
}

function bestEffortCancel(requestId: string, entry: Pending, reason: CapabilityCancel["reason"]): void {
  if (entry.cancellation === "cooperative") {
    entry.notify(CAPABILITY_METHODS.cancel, { requestId, control: entry.control, reason } satisfies CapabilityCancel);
  }
}

function interruptedOutcome(execution: CapabilityExecutionKind, message: string): CapabilityOutcome {
  return execution === "effect"
    ? { ok: false, code: "OUTCOME_UNKNOWN", message, state: "outcome_unknown" }
    : { ok: false, code: "NODE_DISCONNECTED", message };
}

function responseOutcome(params: CapabilityRespondParams): CapabilityOutcome {
  switch (params.state) {
    case "completed": return { ok: true, output: params.output };
    case "failed": return { ok: false, code: params.error.code, message: params.error.message };
    case "cancelled": return { ok: false, code: "CANCELLED", message: "capability request cancelled", state: "cancelled" };
    case "outcome_unknown": return { ok: false, code: "OUTCOME_UNKNOWN", message: "capability outcome is unknown", state: "outcome_unknown" };
  }
}

function sameControl(left: HostOperationControl, right: HostOperationControl): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

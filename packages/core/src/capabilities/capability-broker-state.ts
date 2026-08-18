/**
 * INPUT:  sealed Host attempts, operator/Host Connection ownership, timers, and terminal transitions
 * OUTPUT: shared broker state primitives with exact cleanup, cancellation, and bounded terminal lineage
 * POS:    core/capabilities — internal state owner used by the Host request and Approval challenge/resume paths
 */
import type {
  ApprovalDecisionBinding,
  CapabilityAuthorization,
  CapabilityCancel,
  CapabilityCancelReason,
  CapabilityCancellation,
  CapabilityChallenge,
  CapabilityExecutionKind,
  HostCapabilityDescriptor,
  HostGovernanceProjection,
  HostOperationControl,
} from "@taki/shared";
import { CAPABILITY_METHODS } from "@taki/shared";
import type { ApprovalInteractionService, ApprovalRequestHandle } from "../approval/approval-interaction-service.ts";
import type { Logger } from "../logging/logger.ts";
import type { Connection } from "../server/connection-registry.ts";
import type { CapabilityOutcome } from "./capability-broker.ts";

export type CapabilityNotify = (method: string, params: unknown) => void;

export interface CapabilityDispatchTarget {
  hostId: string;
  connectionGeneration: number;
  catalogGeneration: number;
  descriptor: HostCapabilityDescriptor;
  connection: Connection;
  notify: CapabilityNotify;
  policyGeneration: number;
  governanceProjection: HostGovernanceProjection;
  operator?: { connection: Connection; signal?: AbortSignal };
  isCurrent(): boolean;
}

export interface PendingChallenge {
  value: CapabilityChallenge;
  binding: ApprovalDecisionBinding;
  handle?: ApprovalRequestHandle;
}

export interface PendingAuthorization {
  value: CapabilityAuthorization;
}

export interface PendingCapability {
  control: HostOperationControl;
  /** Exact raw capability input — memory-only inside this pending record; dropped on every terminal transition. */
  input: unknown;
  target: CapabilityDispatchTarget;
  execution: CapabilityExecutionKind;
  cancellation: CapabilityCancellation;
  finish: (outcome: CapabilityOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  abortListener?: () => void;
  challenge?: PendingChallenge;
  authorization?: PendingAuthorization;
}

export interface TerminalRecord {
  control: HostOperationControl;
  authorization?: PendingAuthorization;
  reason: "duplicate" | "late";
}

export interface CapabilityBrokerState {
  log: Logger;
  approval: ApprovalInteractionService;
  now: () => number;
  pending: Map<string, PendingCapability>;
  terminal: Map<string, TerminalRecord>;
}

export const TERMINAL_RECORD_LIMIT = 256;
export const TIMEOUT_MESSAGE = "capability request timed out";

/** Retires one pending attempt: releases its interaction handle/abort hook and records bounded terminal lineage. */
export function settlePending(
  state: CapabilityBrokerState,
  requestId: string,
  terminal: { outcome: CapabilityOutcome; terminalReason: TerminalRecord["reason"] },
): boolean {
  const entry = state.pending.get(requestId);
  if (!entry) return false;
  state.pending.delete(requestId);
  clearTimeout(entry.timer);
  releaseChallenge(entry);
  rememberTerminal(state.terminal, requestId, { control: entry.control, authorization: entry.authorization, reason: terminal.terminalReason });
  state.log.info({ requestId, attemptId: entry.control.attemptId, ok: terminal.outcome.ok }, "capability settled");
  entry.finish(terminal.outcome);
  return true;
}

/** Releases the operator interaction handle and abort hook exactly once; safe on already-finished handles. */
export function releaseChallenge(entry: PendingCapability): void {
  entry.challenge?.handle?.cancel();
  entry.challenge = undefined;
  entry.abortListener?.();
  entry.abortListener = undefined;
}

export function rememberTerminal(records: Map<string, TerminalRecord>, requestId: string, terminal: TerminalRecord): void {
  if (records.size >= TERMINAL_RECORD_LIMIT) {
    const oldest = records.keys().next().value as string | undefined;
    if (oldest !== undefined) records.delete(oldest);
  }
  records.set(requestId, terminal);
}

export function interruptedOutcome(
  execution: CapabilityExecutionKind,
  cancellation: CapabilityCancellation,
  message: string,
): CapabilityOutcome {
  if (execution === "effect") {
    return { ok: false, code: "OUTCOME_UNKNOWN", message, state: "outcome_unknown" };
  }
  return cancellation === "cooperative"
    ? { ok: false, code: "CANCELLED", message, state: "cancelled" }
    : { ok: false, code: "NODE_DISCONNECTED", message };
}

/**
 * Best-effort pre-execution retirement notice for the Host. Sent regardless of the descriptor's cancellation
 * kind: a pending challenge has started no effect, so honoring the cancel can never strand a running side effect.
 */
export function notifyHostCancel(entry: PendingCapability, requestId: string, reason: CapabilityCancelReason): void {
  try {
    entry.target.notify(CAPABILITY_METHODS.cancel, {
      requestId,
      control: entry.control,
      reason,
    } satisfies CapabilityCancel);
  } catch {
    // The pending state is already retired; a broken Host socket cannot strand Core authority.
  }
}

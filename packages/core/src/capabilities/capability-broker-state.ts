/**
 * INPUT:  sealed Host attempts, operator/Host Connection ownership, timers, and terminal transitions
 * OUTPUT: shared broker state primitives with exact cleanup, cancellation, and bounded terminal lineage
 * POS:    core/capabilities — internal state owner used by the Host request and Approval challenge/resume paths
 */
import type {
  ApprovalDecisionBinding,
  CapabilityAuthorization,
  CapabilityAuthorizationLineage,
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
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { settleHostEffect } from "./capability-effect-lifecycle.ts";
import type { CapabilityRequestObservers } from "./capability-observers.ts";
import { deploymentOutcome, deploymentUnknown, isDispatchedDeployment } from "./hindsight-deployment-outcome.ts";

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
  signal?: AbortSignal;
  isCurrent(): boolean;
  ownerCurrent?: () => boolean;
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
  executionAbortListener?: () => void;
  challenge?: PendingChallenge;
  authorization?: PendingAuthorization;
  effect?: { id: string; version: number; state: "waiting" | "intent_committed" };
  targetDispatched?: boolean;
  observers?: CapabilityRequestObservers;
  hindsightCheckpointConsumed?: boolean;
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
  effects?: EffectLifecycleService;
}

export const TERMINAL_RECORD_LIMIT = 256;
export const TIMEOUT_MESSAGE = "capability request timed out";

/** Retires one pending attempt: releases its interaction handle/abort hook and records bounded terminal lineage. */
export function settlePending(
  state: CapabilityBrokerState,
  requestId: string,
  terminal: {
    outcome: CapabilityOutcome; terminalReason: TerminalRecord["reason"];
    acceptance?: { provenance: { hostId: string; connectionGeneration: number }; authorization: CapabilityAuthorizationLineage | undefined };
  },
): boolean {
  const entry = state.pending.get(requestId);
  if (!entry) return false;
  let intended = deploymentOutcome(entry, terminal.outcome);
  if (intended.ok && isDispatchedDeployment(entry) && !acceptanceCurrent(state, entry)) intended = deploymentUnknown();
  const accepted = settleHostEffect(state, entry, intended);
  let outcome = accepted ? intended : isDispatchedDeployment(entry) ? deploymentUnknown() : {
    ok: false as const,
    code: "CANCELLED" as const,
    message: "Host Effect settlement was stale",
    state: "cancelled" as const,
  };
  state.pending.delete(requestId);
  clearTimeout(entry.timer);
  entry.executionAbortListener?.();
  entry.executionAbortListener = undefined;
  releaseChallenge(entry);
  rememberTerminal(state.terminal, requestId, { control: entry.control, authorization: entry.authorization, reason: terminal.terminalReason });
  // Effect settlement may downgrade success. Only its final outcome can reach an admission owner.
  if (outcome.ok && terminal.acceptance && entry.observers?.onAccepted) {
    try {
      if (!acceptanceCurrent(state, entry)) throw new Error("stale custody acceptance");
      entry.observers.onAccepted({ requestId, control: structuredClone(entry.control), ...terminal.acceptance, outcome });
    } catch {
      outcome = isDispatchedDeployment(entry) ? deploymentUnknown()
        : { ok: false, code: "CANCELLED", message: "Host acceptance was stale", state: "cancelled" };
    }
  }
  entry.observers = undefined;
  state.log.info({ requestId, attemptId: entry.control.attemptId, ok: outcome.ok }, "capability settled");
  entry.finish(outcome);
  return true;
}

function acceptanceCurrent(state: CapabilityBrokerState, entry: PendingCapability): boolean {
  try {
    return entry.target.isCurrent() && entry.target.operator?.signal?.aborted !== true
      && state.now() < Date.parse(entry.control.deadlineAt)
      && (entry.control.expiresAt === undefined || state.now() < Date.parse(entry.control.expiresAt))
      && state.approval.approvalGeneration() === (entry.authorization?.value.approvalGeneration ?? entry.control.approvalGeneration);
  } catch { return false; }
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

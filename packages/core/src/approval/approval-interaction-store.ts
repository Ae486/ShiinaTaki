/**
 * INPUT:  exact Connection objects plus pending/session Approval records
 * OUTPUT: transient state container and lazy per-connection collection accessors
 * POS:    core/approval — in-memory storage shape for one Core process epoch; never persisted
 */
import type { ApprovalChoice, ApprovalDecisionBinding } from "@taki/shared";
import type { Connection } from "../server/connection-registry.ts";
import type { ApprovalInteractionDecision } from "./approval-interaction-service.ts";

export interface PendingApproval {
  approvalId: string;
  owner: Connection;
  binding: ApprovalDecisionBinding;
  allowedChoices: ReadonlySet<ApprovalChoice>;
  approvalGeneration: number;
  policyGeneration: number;
  resolve: (decision: ApprovalInteractionDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface SessionApproval {
  binding: ApprovalDecisionBinding;
  processEpoch: string;
  approvalGeneration: number;
  policyGeneration: number;
}

export interface ApprovalInteractionState {
  pending: Map<string, PendingApproval>;
  byConnection: Map<Connection, Set<string>>;
  sessions: Map<Connection, Map<string, SessionApproval>>;
}

export function createApprovalInteractionState(): ApprovalInteractionState {
  return { pending: new Map(), byConnection: new Map(), sessions: new Map() };
}

export function connectionIds(state: ApprovalInteractionState, connection: Connection): Set<string> {
  const existing = state.byConnection.get(connection);
  if (existing) return existing;
  const created = new Set<string>();
  state.byConnection.set(connection, created);
  return created;
}

export function connectionSessions(
  state: ApprovalInteractionState,
  connection: Connection,
): Map<string, SessionApproval> {
  const existing = state.sessions.get(connection);
  if (existing) return existing;
  const created = new Map<string, SessionApproval>();
  state.sessions.set(connection, created);
  return created;
}

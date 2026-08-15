/**
 * INPUT:  retained LegacyApproval ask data + per-turn notify; legacy approval.respond params
 * OUTPUT: createApprovalBroker(deps) -> { ask, resolve, denyAll } — correlate operator decisions by approvalId
 * POS:    core/approval — dormant pre-Batch-B prompt broker retained for compatibility and regression tests
 */
import { randomUUID } from "node:crypto";
import {
  APPROVAL_METHODS,
  type LegacyApprovalRequest,
  type LegacyApprovalRespondParams,
  type LegacyApprovalRespondResult,
  type LegacyApprovalScope,
} from "@taki/shared";
import type { Logger } from "../logging/logger.ts";

export interface ApprovalAsk {
  serverName: string;
  toolName: string;
  input: unknown;
}

/** The operator's decision, including the scope so the caller can persist always/never (decision-store). */
export interface ApprovalOutcome {
  approved: boolean;
  scope: LegacyApprovalScope;
  reason?: string;
}

export type ApprovalNotify = (method: string, params: unknown) => void;

export interface ApprovalBroker {
  /** Notifies the operator and resolves when they answer, they disconnect, or 60 s elapses (fail-closed deny). */
  ask(ask: ApprovalAsk, notify: ApprovalNotify): Promise<ApprovalOutcome>;
  /** Applies an operator answer to the pending ask; unknown/late id -> {accepted:false} (normal, never an error). */
  resolve(params: LegacyApprovalRespondParams): LegacyApprovalRespondResult;
  /** Denies every pending ask now (operator socket closed) — fail-closed. */
  denyAll(reason: string): void;
}

// Fail-closed: an operator who never answers is a deny, not a hang (ruling 3).
const DEFAULT_TIMEOUT_MS = 60_000;
export const TIMEOUT_REASON = "approval timed out";

interface Pending {
  finish: (outcome: ApprovalOutcome) => void;
}

export function createApprovalBroker(deps: { logger: Logger; timeoutMs?: number }): ApprovalBroker {
  const log = deps.logger.child({ mod: "approval" });
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pending = new Map<string, Pending>();

  function settle(approvalId: string, outcome: ApprovalOutcome): boolean {
    const entry = pending.get(approvalId);
    if (!entry) return false;
    pending.delete(approvalId);
    entry.finish(outcome);
    return true;
  }

  return {
    ask(ask, notify) {
      const approvalId = randomUUID();
      return new Promise<ApprovalOutcome>((resolve) => {
        const timer = setTimeout(() => settle(approvalId, { approved: false, scope: "once", reason: TIMEOUT_REASON }), timeoutMs);
        pending.set(approvalId, {
          finish: (outcome) => {
            clearTimeout(timer);
            resolve(outcome);
          },
        });
        // The ask carries the tool input to the operator's console (the one place it may travel); core logs get names only.
        notify(APPROVAL_METHODS.request, {
          approvalId,
          serverName: ask.serverName,
          toolName: ask.toolName,
          input: ask.input,
        } satisfies LegacyApprovalRequest);
        log.info({ approvalId, server: ask.serverName, tool: ask.toolName }, "tool approval requested");
      });
    },
    resolve(params) {
      const outcome: ApprovalOutcome = {
        approved: params.approved,
        scope: params.scope,
        reason: params.approved ? undefined : "operator denied",
      };
      return { accepted: settle(params.approvalId, outcome) };
    },
    denyAll(reason) {
      for (const approvalId of [...pending.keys()]) settle(approvalId, { approved: false, scope: "once", reason });
    },
  };
}

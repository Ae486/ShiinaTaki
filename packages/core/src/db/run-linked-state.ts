/**
 * INPUT: trusted Core linked-admission intent and canonical Run terminal facts
 * OUTPUT: narrow synchronous delegation participation in existing Run transactions
 * POS: core/db — internal repository contract, never supplied by RPC or model JSON
 */
import type { Attempt, Run, RunOutcome, RunSnapshot, SubagentWorkToken, TriggerRequest } from "@taki/shared";

export type RunLinkedAdmission = (
  | { kind: "subagent"; token: SubagentWorkToken; triggerInputId: string }
  | { kind: "parent-continuation"; completionId: string; resultDigest: string }
  | { kind: "agent-inbox"; consumerId: string; resumesConsumerId: string; operationKey: string }
) & {
  /** Rechecks process-owned source/capacity authority after asynchronous capture, with no IO. */
  validateTx: () => void;
};
export interface RunTerminalFact {
  run: Run;
  attempt: Attempt;
  finalOutcome: RunOutcome;
  receiptId: string;
  at: string;
}
export interface RunLinkedState {
  onAdmitTx(input: { request: TriggerRequest; run: Run; attempt: Attempt; snapshot: RunSnapshot;
    reused: boolean; link?: RunLinkedAdmission }): void;
  onTerminalTx(fact: RunTerminalFact): void;
  afterTerminalCommit?(fact: RunTerminalFact): void;
}

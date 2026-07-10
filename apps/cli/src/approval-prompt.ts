/**
 * INPUT:  an ApprovalRequest (server/tool/input the agent wants to run) + the operator's typed answer
 * OUTPUT: renderApprovalAsk(req) -> prompt string; parseApprovalAnswer(answer) -> {approved, scope} | null
 * POS:    cli — pure rendering/parsing for the approval prompt (unit-tested); no IO, no WS (main wires it to stdin)
 */
import type { ApprovalRequest, ApprovalScope } from "@taki/shared";

export interface ApprovalAnswer {
  approved: boolean;
  scope: ApprovalScope;
}

// Single-key answers: approve (y/s/a) or deny (d/n). `n` = deny-always, which the core persists as `never`.
const ANSWERS: Record<string, ApprovalAnswer> = {
  y: { approved: true, scope: "once" },
  s: { approved: true, scope: "session" },
  a: { approved: true, scope: "always" },
  d: { approved: false, scope: "once" },
  n: { approved: false, scope: "always" },
};

const LEGEND = "[y]es once  [s]ession  [a]lways  [d]eny once  [n]ever: ";

/** The input is shown so the operator can judge the ask — this is the one place a tool input surfaces (not in core logs). */
export function renderApprovalAsk(req: ApprovalRequest): string {
  return `\n[approval] ${req.serverName}/${req.toolName} wants to run with:\n  ${JSON.stringify(req.input)}\n${LEGEND}`;
}

/** null for an unrecognized answer — the caller re-prompts. */
export function parseApprovalAnswer(answer: string): ApprovalAnswer | null {
  return ANSWERS[answer.trim().toLowerCase()] ?? null;
}

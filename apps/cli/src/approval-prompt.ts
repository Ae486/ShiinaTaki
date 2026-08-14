/**
 * INPUT:  one canonical redacted Approval request plus an operator answer
 * OUTPUT: safe prompt rendering and explicit canonical choice parsing; no raw execution input or durable deny shortcut
 * POS:    cli — pure operator presentation/parser; main owns stdin and chat-client owns the targeted socket
 */
import type { ApprovalChoice, CanonicalApprovalRequest } from "@taki/shared";

const KEYS: Record<string, ApprovalChoice> = {
  y: "allow_once",
  s: "allow_session",
  a: "allow_always",
  d: "deny",
};

export function renderApprovalAsk(request: CanonicalApprovalRequest): string {
  const details = request.presentation.sections.flatMap((section) => [
    `  ${section.title}`,
    ...section.fields.map((field) => `    ${field.label}: ${field.value}`),
  ]).join("\n");
  const choices = request.allowedChoices.map(choiceLabel).join("  ");
  return `\n[approval] ${request.presentation.title}\n  ${request.presentation.riskSummary}\n${details}\n${choices}: `;
}

export function parseApprovalAnswer(answer: string, allowedChoices: readonly ApprovalChoice[]): ApprovalChoice | null {
  const choice = KEYS[answer.trim().toLowerCase()];
  return choice && allowedChoices.includes(choice) ? choice : null;
}

export function renderApprovalDisclosure(request: CanonicalApprovalRequest): string {
  const revision = request.disclosureRevision;
  return revision === undefined
    ? "\n[approval] This request does not offer current future-background disclosure; choose another option: "
    : `\n[approval] Confirm revision ${revision}: this grant also permits matching future background runs. Type yes to confirm, or no to deny: `;
}

export function parseApprovalDisclosure(answer: string): boolean {
  return ["y", "yes", "confirm", "confirmed"].includes(answer.trim().toLowerCase());
}

export function approvalStatusMessage(status: string): string {
  return {
    late: "Approval response was late and was not applied.",
    wrong_session: "Approval belongs to another connection.",
    invalidated: "Approval was invalidated before the response was applied.",
    scope_not_allowed: "That approval scope is not allowed for this capability.",
    stale_generation: "Approval state changed before the response was applied.",
    disclosure_required: "Current future-background disclosure was required.",
  }[status] ?? "Approval response was rejected.";
}

function choiceLabel(choice: ApprovalChoice): string {
  return {
    allow_once: "[y]es once",
    allow_session: "[s]ession",
    allow_always: "[a]lways (future background use)",
    deny: "[d]eny this request",
  }[choice];
}

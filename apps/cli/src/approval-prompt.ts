/**
 * INPUT:  one canonical redacted Approval request plus an operator answer
 * OUTPUT: exact literal command reconstruction or ordinary fields, explicit choices and background-use consent
 * POS:    cli — pure operator presentation/parser; main owns stdin and chat-client owns the targeted socket
 */
import { reconstructApprovalCommand, type ApprovalChoice, type CanonicalApprovalRequest } from "@taki/shared";

const KEYS: Record<string, ApprovalChoice> = {
  y: "allow_once",
  s: "allow_session",
  a: "allow_always",
  d: "deny",
};

export function renderApprovalAsk(request: CanonicalApprovalRequest): string {
  const details = reconstructApprovalCommand(request.presentation) ?? request.presentation.sections.flatMap((section) => [
    `  ${section.title}`,
    ...section.fields.map((field) => `    ${field.label}: ${field.value}`),
  ]).join("\n");
  const choices = request.allowedChoices.map(choiceLabel).join("  ");
  return `\n[审批] ${request.presentation.title}\n${request.presentation.riskSummary}\n${details}\n${choices}: `;
}

export function parseApprovalAnswer(answer: string, allowedChoices: readonly ApprovalChoice[]): ApprovalChoice | null {
  const choice = KEYS[answer.trim().toLowerCase()];
  return choice && allowedChoices.includes(choice) ? choice : null;
}

export function renderApprovalDisclosure(request: CanonicalApprovalRequest): string {
  const revision = request.disclosureRevision;
  return revision === undefined
    ? "\n[审批] 此请求不支持长期允许，请选择其他选项："
    : "\n[审批] 此长期允许也适用于未来后台运行。输入 yes 明确同意，或输入 no 拒绝：";
}

export function parseApprovalDisclosure(answer: string): boolean {
  return ["y", "yes", "confirm", "confirmed"].includes(answer.trim().toLowerCase());
}

export function approvalStatusMessage(status: string): string {
  return {
    late: "审批已结束，本次回复未生效。",
    wrong_session: "此审批属于其他连接。",
    invalidated: "审批已失效，本次回复未生效。",
    scope_not_allowed: "此操作不支持所选的允许范围。",
    stale_generation: "审批状态已变化，请重新操作。",
    disclosure_required: "请先明确同意长期允许适用于未来后台运行。",
  }[status] ?? "审批回复未被接受。";
}

function choiceLabel(choice: ApprovalChoice): string {
  return {
    allow_once: "[y] 仅本次允许",
    allow_session: "[s] 本连接期间允许",
    allow_always: "[a] 始终允许（含未来后台运行）",
    deny: "[d] 拒绝本次请求",
  }[choice];
}

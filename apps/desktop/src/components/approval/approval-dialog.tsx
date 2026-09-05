/**
 * INPUT:  one socket-local canonical Approval request plus a response callback
 * OUTPUT: <ApprovalDialog> — sealed presentation, explicit choices, and future-background-use acknowledgement.
 * POS:    ui/components/approval — ephemeral operator prompt; disclosure revisions stay in the controller binding.
 *         The shared Dialog traps/restores focus and keeps escapePolicy="none" for fail-closed approval.
 */
import { useId } from "react";
import type { ApprovalChoice, CanonicalApprovalRequest } from "@taki/shared";
import { Dialog } from "@/components/ui/dialog.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { ActionButton } from "@/windows/home/action-button.js";
import type { ApprovalDialogStatus } from "./approval-dialog-controller.ts";

export interface ApprovalDialogProps {
  request: CanonicalApprovalRequest;
  queued: number;
  status: ApprovalDialogStatus;
  disclosureAcknowledged: boolean;
  onDisclosureAcknowledged(accepted: boolean): void;
  onChoose(choice: ApprovalChoice): void;
  onDismiss(): void;
}

const LABELS: Record<ApprovalChoice, string> = {
  allow_once: "仅本次允许",
  allow_session: "本连接期间允许",
  allow_always: "始终允许（含未来后台运行）",
  deny: "拒绝本次请求",
};

export function ApprovalDialog({
  request,
  queued,
  status,
  disclosureAcknowledged,
  onDisclosureAcknowledged,
  onChoose,
  onDismiss,
}: ApprovalDialogProps) {
  const titleId = useId();
  const choicesDisabled = status.kind === "responding" || (status.kind === "error" && status.dismissible);
  const disclosureRevision = request.allowedChoices.includes("allow_always") ? request.disclosureRevision : undefined;
  const disclosure = disclosureRevision !== undefined
    ? <DisclosureAck
        accepted={disclosureAcknowledged}
        disabled={status.kind === "responding"}
        onChange={onDisclosureAcknowledged}
      />
    : null;
  return (
    <Dialog open onClose={onDismiss} escapePolicy="none" labelledBy={titleId} ariaLabel="操作审批">
      <h2 id={titleId} className="text-base font-semibold text-text-strong">{request.presentation.title}</h2>
      <p className="mt-2 text-sm text-text-body">{request.presentation.riskSummary}</p>
      {queued > 0 && <p className="mt-2 text-xs text-text-secondary">另有 {queued} 个请求等待处理。</p>}
      <ApprovalSections request={request} />
      {disclosure}
      {status.kind === "error" && <div className="mt-4"><FeedbackLine tone="danger">{status.message}</FeedbackLine></div>}
      {status.kind === "responding" && <div className="mt-4"><FeedbackLine tone="info">正在提交审批…</FeedbackLine></div>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {status.kind === "error" && status.dismissible && (
          <ActionButton onClick={onDismiss}>关闭</ActionButton>
        )}
        {/* C3: allow choices carry the primary tone (granting is not a danger act); deny carries danger-soft. */}
        {request.allowedChoices.map((choice) => (
          <ActionButton
            key={choice}
            tone={choice === "deny" ? "danger-soft" : "primary"}
            disabled={choicesDisabled || (choice === "allow_always" && !disclosureAcknowledged)}
            onClick={() => onChoose(choice)}
          >
            {LABELS[choice]}
          </ActionButton>
        ))}
      </div>
    </Dialog>
  );
}

function ApprovalSections({ request }: { request: CanonicalApprovalRequest }) {
  return (
    <div className="mt-4 space-y-3">
      {request.presentation.sections.map((section) => (
        <section key={section.title} className="rounded-xl bg-surface-muted p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{section.title}</h3>
          {section.fields.map((field) => (
            <p key={field.label} className="mt-1 break-words text-sm text-text-body"><span className="font-medium">{field.label}：</span>{field.value}</p>
          ))}
        </section>
      ))}
    </div>
  );
}

function DisclosureAck({
  accepted,
  disabled,
  onChange,
}: {
  accepted: boolean;
  disabled: boolean;
  onChange(accepted: boolean): void;
}) {
  return (
    <label className="mt-4 flex items-start gap-2 rounded-lg border border-warn-border bg-warn-soft p-3 text-sm text-warn-strong">
      <input
        type="checkbox"
        checked={accepted}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="mt-0.5 h-4 w-4"
      />
      <span>我明确同意此长期允许也适用于未来后台运行。</span>
    </label>
  );
}

/**
 * INPUT:  one socket-local canonical Approval request plus a response callback
 * OUTPUT: <ApprovalDialog> — bounded redacted modal with explicit once/session/always/deny choices
 * POS:    ui/components/approval — ephemeral operator prompt; never writes navigation, events, stores, or localStorage
 */
import type { ApprovalChoice, CanonicalApprovalRequest } from "@taki/shared";
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
  const choicesDisabled = status.kind === "responding" || (status.kind === "error" && status.dismissible);
  const disclosureRevision = request.allowedChoices.includes("allow_always") ? request.disclosureRevision : undefined;
  const disclosure = disclosureRevision !== undefined
    ? <DisclosureAck
        revision={disclosureRevision}
        accepted={disclosureAcknowledged}
        disabled={status.kind === "responding"}
        onChange={onDisclosureAcknowledged}
      />
    : null;
  return (
    <div data-keep-interactive className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4" role="dialog" aria-modal="true" aria-label="操作审批">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-slate-900">{request.presentation.title}</h2>
        <p className="mt-2 text-sm text-slate-600">{request.presentation.riskSummary}</p>
        {queued > 0 && <p className="mt-2 text-xs text-slate-500">另有 {queued} 个请求等待处理。</p>}
        <ApprovalSections request={request} />
        {disclosure}
        {status.kind === "error" && <p className="mt-4 text-sm text-danger" role="alert">{status.message}</p>}
        {status.kind === "responding" && <p className="mt-4 text-sm text-slate-500" role="status">正在提交审批…</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {status.kind === "error" && status.dismissible && (
            <button type="button" onClick={onDismiss} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
              关闭
            </button>
          )}
          {/* C3: allow choices carry the primary tone (ActionButton's primary — granting is not a danger act);
              deny carries the soft danger tone (border + danger text on white), matching ActionButton's danger-soft. */}
          {request.allowedChoices.map((choice) => (
            <button key={choice} type="button" disabled={choicesDisabled || (choice === "allow_always" && !disclosureAcknowledged)} onClick={() => onChoose(choice)} className={choice === "deny"
              ? "rounded-lg border border-danger-border bg-white px-3 py-2 text-sm font-medium text-danger hover:bg-danger-soft"
              : "rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"}>
              {LABELS[choice]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ApprovalSections({ request }: { request: CanonicalApprovalRequest }) {
  return (
    <div className="mt-4 space-y-3">
      {request.presentation.sections.map((section) => (
        <section key={section.title} className="rounded-xl bg-slate-50 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{section.title}</h3>
          {section.fields.map((field) => (
            <p key={field.label} className="mt-1 text-sm text-slate-700"><span className="font-medium">{field.label}：</span>{field.value}</p>
          ))}
        </section>
      ))}
    </div>
  );
}

function DisclosureAck({
  revision,
  accepted,
  disabled,
  onChange,
}: {
  revision: number;
  accepted: boolean;
  disabled: boolean;
  onChange(accepted: boolean): void;
}) {
  return (
    <label className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <input
        type="checkbox"
        checked={accepted}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="mt-0.5 h-4 w-4"
      />
      <span>我明确同意此长期允许也适用于未来后台运行（披露版本 {revision}）。</span>
    </label>
  );
}

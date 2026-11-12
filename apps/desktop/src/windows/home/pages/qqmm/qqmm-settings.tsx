/**
 * INPUT: the single shared settings draft, normalized preview and controller.
 * OUTPUT: grouped complete settings, explicit preview/save and restart confirmation.
 * POS: Home QQ settings; hidden configuration survives only in the shared candidate.
 */
import { useCallback, useState } from "react";
import { availableSettingsFields, type ManagementController, type ManagementState, type SettingsDraft } from "@qqmm/management-client";
import { Dialog } from "@/components/ui/dialog.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { ActionButton } from "../../action-button.tsx";
import { PageCard } from "../../page-card.tsx";
import { QqmmSettingField } from "./qqmm-setting-field.tsx";
import { QqmmDimensions } from "./qqmm-dimensions.tsx";
import { issueLabel, RETENTION_HELP, SETTINGS_GROUPS, settingsImpact } from "./qqmm-management-labels.ts";

type SettingsProps = { state: ManagementState; controller: ManagementController };
export function QqmmSettings({ state, controller }: SettingsProps) {
  const draft = state.settingsDraft;
  const fields = availableSettingsFields(draft);
  const disabled = state.connection !== "connected" || !draft.base || draft.status === "saving" || draft.status === "validating";
  return <section aria-label="配置设置" className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-text-strong">配置设置</h2>
      <ActionButton disabled={disabled} onClick={() => controller.resetSettings()}>放弃修改</ActionButton></div>
    {!draft.base && <FeedbackLine tone="info" action={state.connection === "connected" ? { label: "重新读取配置", onClick: () => void controller.loadSettings() } : undefined}>{draft.message ? "完整配置暂不可用。" : "正在读取完整配置…"}</FeedbackLine>}
    {draft.base && SETTINGS_GROUPS.map((group) => <PageCard key={group.key} title={group.title}><div className="grid gap-3">
      {group.key === "capture" && <p className="text-xs text-text-secondary">{RETENTION_HELP}</p>}
      <div className="grid gap-4 @lg:grid-cols-2">{fields.filter((field) => field.group === group.key).map((field) => <QqmmSettingField key={field.key} field={field} draft={draft} controller={controller} disabled={disabled} />)}</div>
      {group.key === "summary" && <QqmmDimensions draft={draft} controller={controller} disabled={disabled} />}
    </div></PageCard>)}
    {draft.issues.length > 0 && <FeedbackLine tone="warn">{draft.issues.map(issueLabel).join(" ")}</FeedbackLine>}
    {draft.message && <FeedbackLine tone={draft.status === "saved" ? "ok" : "warn"}>{draft.message}</FeedbackLine>}
    <SettingsSave draft={draft} controller={controller} disabled={disabled} />
  </section>;
}

function SettingsSave({ draft, controller, disabled }: { draft: SettingsDraft; controller: ManagementController; disabled: boolean }) {
  // Bind confirmation to the exact preview object; a background revalidation or
  // an edit must never reuse consent for a different apply plan.
  const [confirmedPreview, setConfirmedPreview] = useState<SettingsDraft["preview"]>(null);
  const closeConfirmation = useCallback(() => setConfirmedPreview(null), []);
  const lines = settingsImpact(draft);
  const save = () => draft.preview?.applyPlan.requiresConfirmation ? setConfirmedPreview(draft.preview) : void controller.applySettings();
  const confirm = () => { closeConfirmation(); confirmSettings(controller, confirmedPreview); };
  return <>
    {lines.length > 0 && <FeedbackLine tone={draft.preview?.retentionImpact.expiresEarlier || draft.preview?.applyPlan.requiresConfirmation ? "warn" : "info"}>{lines.map((line) => <p key={line}>{line}</p>)}</FeedbackLine>}
    <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-border bg-surface py-3">
      <ActionButton disabled={disabled} busy={draft.status === "validating"} onClick={() => void controller.validateSettings()}>预览变更</ActionButton>
      <ActionButton tone="accent" disabled={disabled || draft.status !== "preview"} busy={draft.status === "saving"} onClick={save}>确认保存</ActionButton>
    </div>
    <Dialog open={!disabled && confirmedPreview !== null && confirmedPreview === draft.preview} onClose={closeConfirmation} ariaLabel="确认配置影响">
      <h2 className="pr-7 text-sm font-semibold text-text-strong">确认配置影响</h2>
      <div className="my-4 grid gap-2 text-xs text-text-body">{lines.map((line) => <p key={line}>{line}</p>)}</div>
      <div className="flex justify-end gap-2"><ActionButton onClick={() => setConfirmedPreview(null)}>取消</ActionButton><ActionButton tone="accent" onClick={confirm}>保存并重启运行环境</ActionButton></div>
    </Dialog>
  </>;
}

/** React may not have committed a queued render before an operator clicks. */
export function confirmSettings(controller: Pick<ManagementController, "getState" | "applySettings">,
  preview: SettingsDraft["preview"]): void {
  if (preview !== null && controller.getState().settingsDraft.preview === preview) void controller.applySettings(true);
}

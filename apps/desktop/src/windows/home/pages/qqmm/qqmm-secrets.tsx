/**
 * INPUT: public credential slot state and the shared ephemeral input draft.
 * OUTPUT: write-only credential submission/status with immediate input retirement.
 * POS: Home QQ controls; no component-owned plaintext copy or secret reveal path.
 */
import type { ManagementController, ManagementState, SecretSlot } from "@qqmm/management-client";
import { Field, FIELD_CONTROL } from "@/components/ui/field.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { ActionButton } from "../../action-button.tsx";
import { managementDate, secretLabel, secretStatus } from "./qqmm-management-labels.ts";

type SecretsProps = { state: ManagementState; controller: ManagementController };
export function QqmmSecrets({ state, controller }: SecretsProps) {
  if (!state.session || !state.secrets) return null;
  const connection = state.settings?.config.connection;
  const name = state.session.backend === "direct" ? connection?.direct?.authTokenSecretRef ?? "direct.authToken" : state.session.backend === "pmhq" ? connection?.pmhq?.managerTokenSecretRef ?? "pmhq.managerToken" : null;
  const slots = state.secrets.slots.filter((slot) => slot.name === name);
  return <div className="grid gap-3">
    {slots.map((slot) => <SecretInput key={slot.name} state={state} controller={controller} slot={slot} />)}
    {state.secretDraft.message && <FeedbackLine tone={state.secretDraft.status === "saved" ? "ok" : "warn"}>{state.secretDraft.message}</FeedbackLine>}
  </div>;
}
function SecretInput({ state, controller, slot }: SecretsProps & { slot: SecretSlot }) {
  const draft = state.secretDraft;
  const value = draft.name === slot.name ? draft.value : "";
  const disabled = state.connection !== "connected" || draft.status === "saving";
  return <div className="grid gap-2 border-t border-border pt-3">
    <Field label={secretLabel(slot)} hint="仅用于更新凭据，提交后输入立即清空。">
      <input className={FIELD_CONTROL} type="password" autoComplete="new-password" spellCheck={false} disabled={disabled} value={value} onChange={(event) => controller.setSecretDraft(slot.name, event.target.value)} />
    </Field>
    <p className="text-xs text-text-secondary">{secretStatus(slot)}{slot.nextAttemptAt !== undefined && ` · 下次检查 ${managementDate(slot.nextAttemptAt)}`}</p>
    {state.session?.backend === "pmhq" && <p className="text-xs text-text-secondary">凭据已保存不代表 QQ 已连接，请以当前连接状态为准。</p>}
    <div className="flex flex-wrap gap-2">
      <ActionButton disabled={disabled || !value.trim()} busy={draft.status === "saving"} onClick={() => void controller.saveSecret()}>更新凭据</ActionButton>
      {slot.candidateStatus !== "none" && <ActionButton disabled={disabled} onClick={() => void controller.clearSecretCandidate(slot.name)}>撤回待验证凭据</ActionButton>}
    </div>
  </div>;
}

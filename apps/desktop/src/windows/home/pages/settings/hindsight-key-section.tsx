/**
 * INPUT:  generation-safe key presence/actions and transient password draft from useHindsightKey.
 * OUTPUT: a discoverable write-only Hindsight API Key form with truthful storage/validation feedback.
 * POS:    ui/windows/home/pages/settings — existing Home primitives; values never populate from Core.
 */
import { Field, FIELD_CONTROL } from "@/components/ui/field.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { ActionButton } from "../../action-button.tsx";
import { PageCard } from "../../page-card.tsx";
import { useHindsightKey } from "./use-hindsight-key.ts";

export function HindsightKeySection() {
  return <HindsightKeyForm view={useHindsightKey()} />;
}

export function HindsightKeyForm({ view }: { view: ReturnType<typeof useHindsightKey> }) {
  const { state, connectionReady, value } = view;
  const disabled = !connectionReady || state.loading || state.busy !== null || state.presence?.health !== "ok";
  return (
    <PageCard title="Hindsight API Key">
      <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void view.save(); }}>
        <p className="text-xs text-text-secondary">用于现有 Hindsight 实例的身份验证。地址在下方配置项设置，完成后到操作页校验连接。</p>
        <p className="text-xs text-text-body" role="status">{presenceLabel(view)}</p>
        <Field label="Hindsight API Key" hint="只保存或替换，不读取已有密钥。">
          <input type="password" autoComplete="off" spellCheck={false} className={FIELD_CONTROL}
            value={value} disabled={disabled} onChange={(event) => view.edit(event.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <ActionButton tone="primary" disabled={disabled || value.length === 0} busy={state.busy === "set"}
            onClick={() => void view.save()}>{state.presence?.present ? "替换 API Key" : "保存 API Key"}</ActionButton>
          <ActionButton disabled={disabled || !state.presence?.present} busy={state.busy === "clear"}
            onClick={() => void view.clear()}>清除 API Key</ActionButton>
          <ActionButton tone="ghost" disabled={!connectionReady || state.loading || state.busy !== null}
            onClick={() => void view.refresh()}>刷新密钥状态</ActionButton>
        </div>
        {state.feedback && <FeedbackLine tone={state.feedback.tone}>{state.feedback.message}</FeedbackLine>}
      </form>
    </PageCard>
  );
}

function presenceLabel(view: ReturnType<typeof useHindsightKey>): string {
  if (!view.connectionReady) return "连接恢复后将重新读取密钥状态。";
  if (view.state.loading) return "正在读取密钥状态…";
  const presence = view.state.presence;
  if (!presence) return "保存状态未知。";
  if (presence.health !== "ok") return presence.health === "locked"
    ? "密钥存储已锁定，保存状态未知。请先恢复 Core 的密钥存储。"
    : "密钥存储不可读或版本不受支持，保存状态未知。请检查 Core 的密钥存储。";
  return presence.present ? "已保存 API Key（连接校验结果请查看操作页）。" : "尚未保存 API Key。";
}

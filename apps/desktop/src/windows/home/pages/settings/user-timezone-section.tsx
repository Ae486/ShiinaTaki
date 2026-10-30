/**
 * INPUT: Home-owned Core timezone projection and an explicit local settings draft
 * OUTPUT: fixed/follow-this-device controls and honest last-confirmation/source status
 * POS: ui/settings — Core persists timezone; refreshing never overwrites an edited draft
 */
import { useState, useSyncExternalStore } from "react";
import { UserTimezoneNameSchema } from "@taki/shared";
import { Field, FIELD_CONTROL } from "@/components/ui/field.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { useHomeClient } from "../../home-client-context.ts";
import { ActionButton } from "../../action-button.tsx";
import type { TimezoneView } from "@/features/presence/user-timezone-controller.js";

const EMPTY: TimezoneView = { data: null, loading: false, saving: false, error: null };
const noopSubscribe = () => () => undefined;
const emptySnapshot = () => EMPTY;

export function UserTimezoneSection() {
  const { timezone, client } = useHomeClient();
  const view = useSyncExternalStore(timezone?.subscribe ?? noopSubscribe, timezone?.snapshot ?? emptySnapshot, emptySnapshot);
  const [draft, setDraft] = useState<string | null>(null);
  const zone = draft ?? view.data?.state.timezone ?? "UTC";
  const ready = !!client && !!view.data && !view.saving;
  return <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-card">
    <h2 className="text-sm font-semibold text-text-strong">用户时区</h2>
    <p className="text-xs text-text-secondary">用于提醒、安静时段和每日额度。跟随设备时，保留最近一次确认结果。</p>
    {view.data && <p className="text-xs text-text-secondary">
      当前：{view.data.state.timezone} · {view.data.state.mode === "fixed" ? "固定时区" : "跟随指定设备"}
      {view.data.state.confirmedAt ? ` · 确认于 ${new Date(view.data.state.confirmedAt).toLocaleString()}` : " · 尚未确认"}
      {view.data.state.mode !== "fixed" && view.data.reportStatus !== "current" ? " · 等待指定设备报告" : ""}
    </p>}
    <Field label="固定时区（IANA 名称）"><input className={FIELD_CONTROL} value={zone} placeholder="Asia/Shanghai"
      onChange={(event) => setDraft(event.target.value)} /></Field>
    <div className="flex flex-wrap gap-2">
      <ActionButton disabled={!ready || !UserTimezoneNameSchema.safeParse(zone).success} busy={view.saving}
        onClick={() => void timezone?.save({ mode: "fixed", timezone: zone })}>使用固定时区</ActionButton>
      <ActionButton disabled={!ready} onClick={() => void timezone?.save({ mode: "follow-primary-device" })}>跟随此设备</ActionButton>
      <ActionButton tone="ghost" disabled={!client || view.loading || view.saving} onClick={() => void timezone?.refresh()}>刷新</ActionButton>
    </div>
    {view.error && <FeedbackLine tone="warn">{view.error}</FeedbackLine>}
  </section>;
}

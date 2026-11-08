/**
 * INPUT:  one Bank's persisted schedule, operation lock and the common operations actions
 * OUTPUT: automatic/manual mode, editable incremental/full intervals and explicit complete-config save
 * POS:    ui/windows/home/pages/operations — presentational child of MemoryAuthorityCard; no durable frontend state
 */
import { Field, FIELD_CONTROL } from "@/components/ui/field.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import type { MemoryReplicaScheduleConfig } from "@taki/shared";
import { ActionButton } from "../../action-button.tsx";
import { REPLICA_INTERVAL_UNITS, type ReplicaIntervalDraft } from "./memory-replica-settings-state.ts";
import { useMemoryReplicaSettings } from "./use-memory-replica-settings.ts";
import type { MemoryOperationsView } from "./use-memory-operations.ts";

export function MemoryReplicaSettingsForm(props: { bankId: string; schedule: MemoryReplicaScheduleConfig; ops: MemoryOperationsView; locked: boolean }) {
  const form = useMemoryReplicaSettings(props);
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border-subtle pt-3">
      <Field label="后台同步模式" hint={`已保存：${props.schedule.automatic ? "自动" : "仅手动"}`}>
        <select className={FIELD_CONTROL} value={form.draft.automatic ? "automatic" : "manual"} disabled={props.locked}
          onChange={(event) => form.setAutomatic(event.target.value === "automatic")}>
          <option value="automatic">自动</option><option value="manual">仅手动</option>
        </select>
      </Field>
      <IntervalField label="增量同步间隔" maxDays={31} interval={form.draft.incremental} locked={props.locked}
        change={(interval) => form.setInterval("incremental", interval)} />
      <IntervalField label="完整对账间隔" maxDays={90} interval={form.draft.full} locked={props.locked}
        change={(interval) => form.setInterval("full", interval)} />
      <p className="text-xs text-text-secondary">仅手动关闭后台同步；使用记忆和切换权威所需的同步仍会执行。</p>
      {!form.valid && <FeedbackLine tone="warn">请填写范围内的有效同步间隔。</FeedbackLine>}
      <div><ActionButton tone="secondary" busy={props.ops.busyKey === `configure:${props.bankId}`} disabled={props.locked || !form.valid}
        onClick={() => void form.save()}>保存同步设置</ActionButton></div>
    </div>
  );
}

function IntervalField(props: { label: string; maxDays: number; interval: ReplicaIntervalDraft; locked: boolean; change(interval: ReplicaIntervalDraft): void }) {
  const changeUnit = (unit: string) => {
    if (unit === "minutes" || unit === "hours" || unit === "days") props.change({ ...props.interval, unit });
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label={props.label} hint={`1 分钟至 ${props.maxDays} 天`}>
        <input type="number" step="any" min={60_000 / REPLICA_INTERVAL_UNITS[props.interval.unit]}
          max={props.maxDays * REPLICA_INTERVAL_UNITS.days / REPLICA_INTERVAL_UNITS[props.interval.unit]}
          className={FIELD_CONTROL} value={props.interval.value} disabled={props.locked}
          onChange={(event) => props.change({ ...props.interval, value: event.target.value })} />
      </Field>
      <Field label={`${props.label}单位`}>
        <select className={FIELD_CONTROL} value={props.interval.unit} disabled={props.locked}
          onChange={(event) => changeUnit(event.target.value)}>
          <option value="minutes">分钟</option><option value="hours">小时</option><option value="days">天</option>
        </select>
      </Field>
    </div>
  );
}

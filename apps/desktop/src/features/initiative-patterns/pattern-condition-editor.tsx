/**
 * INPUT: finite Shared condition atoms and explicit form edits.
 * OUTPUT: labelled supported condition controls; source-bound work stays readable and immutable.
 * POS: Desktop proposal form; never accepts scripts or asks operators for opaque runtime IDs.
 */
import type { InitiativeSetupStatus, InteractionPatternCondition } from "@taki/shared";
import { Field, FIELD_CONTROL } from "@/components/ui/field.js";
import { ActionButton } from "@/windows/home/action-button.js";
import { CONDITION_LABELS, WEEKDAYS, describeCondition } from "./pattern-labels.ts";
import { newCondition } from "./pattern-draft.ts";

type Completions = InitiativeSetupStatus["completions"];
type AtomProps = { condition: InteractionPatternCondition; onChange(condition: InteractionPatternCondition): void; completions?: Completions };

function ClockFields({ condition, onChange }: AtomProps) {
  if (condition.kind !== "local_time_window") return null;
  return <div className="grid gap-2">
    <div className="grid grid-cols-2 gap-2">
      <Field label="开始时间（用户时区）"><input className={FIELD_CONTROL} type="time" value={condition.start} onChange={(e) => onChange({ ...condition, start: e.target.value })} /></Field>
      <Field label="结束时间（用户时区）"><input className={FIELD_CONTROL} type="time" value={condition.end} onChange={(e) => onChange({ ...condition, end: e.target.value })} /></Field>
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="生效星期">
      {WEEKDAYS.map((label, index) => <label key={label} className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={condition.daysOfWeek.includes(index + 1)} onChange={(e) => onChange({ ...condition,
          daysOfWeek: e.target.checked ? [...condition.daysOfWeek, index + 1].sort() : condition.daysOfWeek.filter((day) => day !== index + 1),
        })} />{label}
      </label>)}
    </div>
  </div>;
}

function AtomFields({ condition, onChange, completions = [] }: AtomProps) {
  switch (condition.kind) {
    case "local_time_window": return <ClockFields condition={condition} onChange={onChange} />;
    case "application_in_set": return <Field label="应用名称（每行一个）" hint="与已允许的活动来源提供的应用名称匹配。">
      <textarea className={FIELD_CONTROL} rows={3} value={condition.applications.join("\n")} onChange={(e) => onChange({ ...condition, applications: e.target.value.split("\n") })} />
    </Field>;
    case "activity_dwell_at_least": return <Field label="持续时间（分钟）"><input className={FIELD_CONTROL} type="number" min={1} max={1440} value={condition.minutes} onChange={(e) => onChange({ ...condition, minutes: e.target.valueAsNumber })} /></Field>;
    case "known_idle_state": return <Field label="空闲状态"><select className={FIELD_CONTROL} value={condition.state} onChange={(e) => onChange({ ...condition, state: e.target.value === "idle" ? "idle" : "active" })}>
      <option value="active">非空闲</option><option value="idle">空闲</option>
    </select></Field>;
    case "completion_of": return <Field label="指定工作" hint="仅列出当前可引用的工作；过期后需要重新选择。">
      <select className={FIELD_CONTROL} value={completions.findIndex((item) => item.runId === condition.runId)} onChange={(event) => {
        const item = completions[Number(event.target.value)]; if (item) onChange({ kind: "completion_of", ...item });
      }}><option value={-1}>{condition.label}（原选择）</option>{completions.map((item, index) => <option key={item.runId} value={index}>{item.label}</option>)}</select>
    </Field>;
    default: return <p className="text-xs text-text-secondary">{describeCondition(condition)}</p>;
  }
}

export function PatternConditionEditor({ conditions, onChange, completions = [] }: { conditions: InteractionPatternCondition[]; onChange(conditions: InteractionPatternCondition[]): void; completions?: Completions }) {
  const add = (kind: string) => {
    const completion = completions[0];
    const atom = kind === "completion_of" && completion ? { kind: "completion_of" as const, ...completion } : newCondition(kind);
    if (atom) onChange([...conditions, atom]);
  };
  return <fieldset className="space-y-3">
    <legend className="mb-2 text-sm font-medium">同时满足的条件</legend>
    {conditions.map((condition, index) => <div key={index} className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{CONDITION_LABELS[condition.kind]}</span>
        <ActionButton tone="ghost" disabled={conditions.length <= 1} onClick={() => onChange(conditions.filter((_, current) => current !== index))}>移除此条件</ActionButton>
      </div>
      <AtomFields condition={condition} completions={completions} onChange={(next) => onChange(conditions.map((item, current) => current === index ? next : item))} />
    </div>)}
    <Field label="添加条件" hint="仅能使用已有信息来源；来源未启用或信息不可靠时不会触发互动。">
      <select className={FIELD_CONTROL} value="" disabled={conditions.length >= 8} onChange={(e) => add(e.target.value)}>
        <option value="">选择条件（最多 8 项）</option>
        {Object.entries(CONDITION_LABELS).filter(([key]) => newCondition(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        <option value="completion_of" disabled={completions.length === 0}>指定工作完成{completions.length === 0 ? "（暂无可引用的工作）" : ""}</option>
      </select>
    </Field>
  </fieldset>;
}

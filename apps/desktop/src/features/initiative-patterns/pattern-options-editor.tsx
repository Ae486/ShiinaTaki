/**
 * INPUT: an editable Pattern definition and explicit value changes.
 * OUTPUT: context/outcome, chance/cooldown and finite lifetime controls.
 * POS: Desktop proposal form; Core validates the final definition and global limits remain separate.
 */
import type { InteractionPatternContextSelector, InteractionPatternDefinition } from "@taki/shared";
import { Field, FIELD_CONTROL } from "@/components/ui/field.js";
import { CONTEXT_LABELS, OUTCOME_LABELS } from "./pattern-labels.ts";
import { absoluteDateTime, localDateTime } from "./pattern-draft.ts";

type Props = { draft: InteractionPatternDefinition; patch(next: Partial<InteractionPatternDefinition>): void };
const CONTEXTS: InteractionPatternContextSelector[] = ["memory_global", "memory_character", "accepted_activity", "accepted_screen", "presence"];

function ContextOptions({ draft, patch }: Props) {
  return <fieldset className="space-y-2">
    <legend className="text-sm font-medium">可参考的信息</legend>
    {CONTEXTS.map((key) => <label key={key} className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={draft.contextSelectors.includes(key)} onChange={(e) => patch({
        contextSelectors: e.target.checked ? [...draft.contextSelectors, key] : draft.contextSelectors.filter((item) => item !== key),
      })} />{CONTEXT_LABELS[key]}
    </label>)}
    <p className="text-xs text-text-secondary">选择信息不会打开感知开关或授予权限。</p>
  </fieldset>;
}

function OutcomeOptions({ draft, patch }: Props) {
  return <fieldset className="space-y-2">
    <legend className="text-sm font-medium">允许的回应</legend>
    {(["silent", "express", "speak"] as const).map((key) => <label key={key} className="flex items-center gap-2 text-xs">
      <input type="checkbox" disabled={key === "silent"} checked={draft.allowedOutcomes.includes(key)} onChange={(e) => patch({
        allowedOutcomes: e.target.checked ? [...draft.allowedOutcomes, key] : draft.allowedOutcomes.filter((item) => item !== key),
      })} />{OUTCOME_LABELS[key]}{key === "silent" ? "（始终允许）" : ""}
    </label>)}
  </fieldset>;
}

export function PatternOptionsEditor({ draft, patch }: Props) {
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-4"><ContextOptions draft={draft} patch={patch} /><OutcomeOptions draft={draft} patch={patch} /></div>
    <Field label="考虑互动的最短间隔（分钟）" hint="包括保持安静的判断；全局每日上限与说话间隔仍然适用。">
      <input className={FIELD_CONTROL} type="number" min={0} max={10080} value={draft.timing.minimumGapMinutes} onChange={(e) => patch({ timing: { ...draft.timing, minimumGapMinutes: e.target.valueAsNumber } })} />
    </Field>
    <Field label="每次符合条件的机会中，考虑互动的概率（%）">
      <input className={FIELD_CONTROL} type="number" min={0} max={100} step={0.1} value={Math.round(draft.timing.chance * 10000) / 100} onChange={(e) => patch({ timing: { ...draft.timing, chance: e.target.valueAsNumber / 100 } })} />
    </Field>
    <Field label="开始时间（当前设备时区，可留空）" hint="留空表示确认后开始。">
      <input className={FIELD_CONTROL} type="datetime-local" value={localDateTime(draft.lifetime.startsAt)} onChange={(e) => patch({ lifetime: { ...draft.lifetime, startsAt: absoluteDateTime(e.target.value) } })} />
    </Field>
    <Field label="结束时间（当前设备时区，可留空）" hint="过期后不会补发错过的互动。">
      <input className={FIELD_CONTROL} type="datetime-local" value={localDateTime(draft.lifetime.expiresAt)} onChange={(e) => patch({ lifetime: { ...draft.lifetime, expiresAt: absoluteDateTime(e.target.value) } })} />
    </Field>
  </div>;
}

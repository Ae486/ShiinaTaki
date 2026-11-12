/**
 * INPUT: one shared field descriptor, raw draft value and semantic controller.
 * OUTPUT: a stable labelled control that preserves incomplete numbers and IME text.
 * POS: Home QQ settings presentation; no second form state or candidate assembly.
 */
import type { ManagementController, SettingField, SettingsDraft } from "@qqmm/management-client";
import { Field, FIELD_CONTROL } from "@/components/ui/field.js";
import { fieldHint } from "./qqmm-management-labels.ts";

type SettingProps = { field: SettingField; draft: SettingsDraft; controller: ManagementController; disabled: boolean };
export function QqmmSettingField({ field, draft, controller, disabled }: SettingProps) {
  const value = draft.values[field.key] ?? "";
  const change = (next: string | boolean) => controller.setSetting(field.key, next);
  const invalid = draft.issues.some((issue) => issue.path === field.key);
  return <Field label={field.label} hint={fieldHint(field.key)} invalid={invalid}>
    {field.kind === "boolean" ? <input type="checkbox" disabled={disabled} checked={value === true} onChange={(event) => change(event.target.checked)} />
      : field.kind === "select" ? <select className={FIELD_CONTROL} disabled={disabled} value={String(value)} onChange={(event) => change(event.target.value)}>
        {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
        : field.kind === "textarea" || field.kind === "list" ? <textarea className={FIELD_CONTROL} rows={field.kind === "list" ? 3 : 4} disabled={disabled} value={String(value)} onChange={(event) => change(event.target.value)} />
          : <input className={FIELD_CONTROL} type="text" inputMode={field.kind === "number" ? "numeric" : undefined} autoComplete="off" disabled={disabled} value={String(value)} onChange={(event) => change(event.target.value)} />}
  </Field>;
}

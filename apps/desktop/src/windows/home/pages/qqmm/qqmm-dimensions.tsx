/**
 * INPUT: shared draft dimensions and finite add/edit/remove operations.
 * OUTPUT: ordered editable descriptions without exposing the internal dimension keys.
 * POS: Home QQ settings; stable React keys retain focus during polling and edits.
 */
import type { ManagementController, SettingsDraft } from "@qqmm/management-client";
import { Field, FIELD_CONTROL } from "@/components/ui/field.js";
import { ActionButton } from "../../action-button.tsx";

type DimensionsProps = { draft: SettingsDraft; controller: ManagementController; disabled: boolean };
export function QqmmDimensions({ draft, controller, disabled }: DimensionsProps) {
  return <div className="grid gap-3">
    <h3 className="text-xs font-medium text-text-body">摘要关注事项</h3>
    <p className="text-xs text-text-secondary">描述希望摘要特别关注的内容，最多 32 项。</p>
    {draft.dimensions.map((dimension, index) => <div key={dimension.key} className="grid gap-2">
      <Field label={`关注事项 ${index + 1}`}>
        <textarea className={FIELD_CONTROL} rows={2} disabled={disabled} value={dimension.description} onChange={(event) => controller.setDimension(dimension.key, event.target.value)} />
      </Field>
      <div><ActionButton disabled={disabled} onClick={() => controller.removeDimension(dimension.key)}>移除第 {index + 1} 项</ActionButton></div>
    </div>)}
    <div><ActionButton disabled={disabled || draft.dimensions.length >= 32} onClick={() => controller.addDimension()}>添加关注事项</ActionButton></div>
  </div>;
}

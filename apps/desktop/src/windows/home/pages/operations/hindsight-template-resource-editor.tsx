/**
 * INPUT:  complete explicit label/model/directive choices and a local draft setter
 * OUTPUT: resource list with value/inherit/suppress controls and validated complete-definition editing
 * POS:    ui/operations — edits user intent only; no resource is written before Core preview/confirmation
 */
import { useState } from "react";
import { MemoryTemplateUserChoicesSchema, type MemoryTemplateUserChoices } from "@taki/shared";
import { ActionButton } from "../../action-button.tsx";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { TemplateResourceForm, type ResourceDraft, newResourceDraft, resourceChoice } from "./hindsight-template-resource-form.tsx";

type Family = "labels" | "models" | "directives";
const LABELS = { labels: "分类标签组", models: "记忆模型", directives: "指令" } as const;
interface Props { choices: MemoryTemplateUserChoices; change(value: MemoryTemplateUserChoices): void; editing(value: boolean): void }

export function TemplateResourceEditor({ choices, change, editing }: Props) {
  const [draft, setDraft] = useState<ResourceDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editDraft = (value: ResourceDraft) => { editing(true); setDraft(value); setError(null); };
  const save = () => {
    if (!draft) return;
    try { change(resourceChoice(choices, draft)); editing(false); setDraft(null); setError(null); }
    catch { setError("请检查标识、完整定义、数值范围与高级字段格式；重复标识或不完整资源无法保存。"); }
  };
  return <div className="flex flex-col gap-3">
    {(["labels", "models", "directives"] as const).map((family) => <div key={family} className="rounded border border-border-subtle p-3">
      <p className="mb-2 text-xs font-semibold text-text-body">{LABELS[family]}</p>
      {choices[family].length === 0 && <p className="text-xs text-text-secondary">没有独立用户选择；沿用模板与原有资源。</p>}
      {choices[family].map((item) => <ResourceChoiceRow key={"key" in item ? item.key : item.id} family={family} item={item}
        update={(mode) => change(changeMode(choices, family, { item, mode }))} edit={() => editDraft(newResourceDraft(family, item))} />)}
      <ActionButton tone="link" onClick={() => editDraft(newResourceDraft(family))}>添加{LABELS[family]}选择</ActionButton>
    </div>)}
    {draft && <div className="rounded border border-border p-3" role="group" aria-label="编辑完整资源定义">
      <p className="mb-2 text-xs text-text-secondary">资源修改尚未保存到草稿。请先保存或取消此处编辑，再预览整笔变更。</p>
      <TemplateResourceForm draft={draft} change={editDraft} />
      {error && <FeedbackLine tone="danger">{error}</FeedbackLine>}
      <div className="mt-2 flex gap-2"><ActionButton onClick={save}>保存到预览草稿</ActionButton><ActionButton tone="ghost" onClick={() => { editing(false); setDraft(null); setError(null); }}>取消资源编辑</ActionButton></div>
    </div>}
  </div>;
}

type UserResource = MemoryTemplateUserChoices[Family][number];
function ResourceChoiceRow({ family, item, update, edit }: { family: Family; item: UserResource; update(mode: "inherit" | "suppress"): void; edit(): void }) {
  const id = "key" in item ? item.key : item.id;
  const name = "name" in item ? item.name : item.choice.mode === "value" && "name" in item.choice.value ? item.choice.value.name : id;
  return <div className="mb-2 rounded bg-surface-sunken p-2 text-xs text-text-body">
    <p className="break-all">{name} · {item.choice.mode === "value" ? "独立自定义值" : item.choice.mode === "inherit" ? "继承" : "明确停用"}</p>
    <div className="flex flex-wrap gap-2"><ActionButton tone="link" onClick={edit}>编辑{LABELS[family]}</ActionButton>
      <ActionButton tone="link" onClick={() => update("inherit")}>恢复继承</ActionButton><ActionButton tone="link" onClick={() => update("suppress")}>明确停用</ActionButton></div>
  </div>;
}

function changeMode(choices: MemoryTemplateUserChoices, family: Family, input: { item: UserResource; mode: "inherit" | "suppress" }): MemoryTemplateUserChoices {
  const { item, mode } = input;
  const id = "key" in item ? item.key : item.id;
  return MemoryTemplateUserChoicesSchema.parse({ ...choices, [family]: choices[family].map((entry) => {
    if (("key" in entry ? entry.key : entry.id) !== id) return entry;
    return { ...entry, choice: { mode } };
  }) });
}

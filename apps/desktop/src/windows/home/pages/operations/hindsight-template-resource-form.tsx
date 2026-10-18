/**
 * INPUT:  complete saved user definitions or a new explicit resource choice
 * OUTPUT: named editable resource fields and Shared-validated user-choice documents
 * POS:    ui/operations — advanced JSON edits only user label/trigger definitions, never Native proofs or requests
 */
import { HindsightTemplateLabelGroupSchema, HindsightTemplateModelDefinitionSchema, HindsightTemplateDirectiveDefinitionSchema,
  MemoryTemplateUserChoicesSchema, type MemoryTemplateUserChoices } from "@taki/shared";

type Family = "labels" | "models" | "directives";
type Resource = MemoryTemplateUserChoices[Family][number];
export interface ResourceDraft {
  family: Family; originalId: string | null; id: string; name: string; mode: "value" | "inherit" | "suppress";
  text: string; tags: string; maxTokens: string; priority: string; active: boolean; advanced: string;
}
const INPUT = "w-full rounded border border-border bg-surface p-2 text-xs text-text-body";
export function newResourceDraft(family: Family, item?: Resource): ResourceDraft {
  const id = item ? "key" in item ? item.key : item.id : family === "directives" ? crypto.randomUUID() : "";
  const draft: ResourceDraft = { family, originalId: item ? id : null, id, name: item && "name" in item ? item.name : "",
    mode: item?.choice.mode ?? "value", text: "", tags: "[]", maxTokens: "1024", priority: "0", active: true, advanced: "" };
  if (!item || item.choice.mode !== "value") return draft;
  const value = item.choice.value;
  if (family === "labels") return { ...draft, advanced: JSON.stringify(value, null, 2) };
  const model = HindsightTemplateModelDefinitionSchema.safeParse(value);
  if (family === "models" && model.success) return { ...draft, name: model.data.name, text: model.data.source_query,
    tags: JSON.stringify(model.data.tags), maxTokens: String(model.data.max_tokens), advanced: model.data.trigger === null ? "" : JSON.stringify(model.data.trigger, null, 2) };
  const directive = HindsightTemplateDirectiveDefinitionSchema.safeParse(value);
  return directive.success ? { ...draft, name: directive.data.name, text: directive.data.content, tags: JSON.stringify(directive.data.tags),
    priority: String(directive.data.priority), active: directive.data.is_active } : draft;
}

export function resourceChoice(choices: MemoryTemplateUserChoices, draft: ResourceDraft): MemoryTemplateUserChoices {
  const id = draft.family === "directives" ? draft.id.toLowerCase() : draft.id;
  if (draft.originalId !== null && draft.originalId !== id) throw new Error("existing resource identity cannot change");
  if (draft.originalId === null && choices[draft.family].some((entry) => ("key" in entry ? entry.key : entry.id) === id)) {
    throw new Error("new resource duplicates an existing explicit choice");
  }
  // Hidden definition fields must not prevent an explicit return to inheritance or suppression.
  const choice = draft.mode === "value" ? { mode: "value", value: resourceValue(draft) } : { mode: draft.mode };
  const item = draft.family === "labels" ? { key: id, choice } : draft.family === "models" ? { id, choice } : { id, name: draft.name, choice };
  return MemoryTemplateUserChoicesSchema.parse({ ...choices, [draft.family]: [...choices[draft.family].filter((entry) => ("key" in entry ? entry.key : entry.id) !== id), item] });
}

function resourceValue(draft: ResourceDraft): unknown {
  let value: unknown;
  if (draft.family === "labels") value = draft.advanced.trim() ? JSON.parse(draft.advanced) : { key: draft.id, type: "value", optional: true, tag: true,
    values: draft.text.split("\n").map((entry) => entry.trim()).filter(Boolean).map((entry) => ({ value: entry })) };
  if (draft.family === "models") value = { id: draft.id, name: draft.name, source_query: draft.text,
    tags: JSON.parse(draft.tags), max_tokens: numericInput(draft.maxTokens), trigger: draft.advanced.trim() ? JSON.parse(draft.advanced) : null };
  if (draft.family === "directives") value = { id: draft.id, name: draft.name, content: draft.text,
    tags: JSON.parse(draft.tags), priority: numericInput(draft.priority), is_active: draft.active };
  return value;
}
function numericInput(value: string): number { if (!value.trim()) throw new Error("numeric value is required"); return Number(value); }

export function TemplateResourceForm({ draft, change }: { draft: ResourceDraft; change(value: ResourceDraft): void }) {
  const patch = (value: Partial<ResourceDraft>) => change({ ...draft, ...value });
  return <div className="flex flex-col gap-2">
    <label className="text-xs text-text-body">资源标识<input aria-label="资源标识" className={INPUT} value={draft.id} disabled={draft.originalId !== null} onChange={(event) => patch({ id: event.target.value })} /></label>
    <label className="text-xs text-text-body">资源选择模式<select aria-label="资源选择模式" className={INPUT} value={draft.mode}
      onChange={(event) => patch({ mode: event.target.value === "inherit" ? "inherit" : event.target.value === "suppress" ? "suppress" : "value" })}>
      <option value="value">独立自定义定义</option><option value="inherit">恢复继承</option><option value="suppress">明确停用</option>
    </select></label>
    {draft.family !== "labels" && <label className="text-xs text-text-body">资源名称<input aria-label="资源名称" className={INPUT} value={draft.name} onChange={(event) => patch({ name: event.target.value })} /></label>}
    {draft.mode === "value" && <ResourceValueFields draft={draft} change={change} />}
  </div>;
}

function ResourceValueFields({ draft, change }: { draft: ResourceDraft; change(value: ResourceDraft): void }) {
  const patch = (value: Partial<ResourceDraft>) => change({ ...draft, ...value });
  if (draft.family === "labels") return <LabelFields draft={draft} change={change} />;
  return <>
    <label className="text-xs text-text-body">{draft.family === "models" ? "模型查询" : "指令内容"}<textarea aria-label="资源内容" className={`${INPUT} min-h-24`} value={draft.text} onChange={(event) => patch({ text: event.target.value })} /></label>
    {draft.family === "models" ? <>
      <label className="text-xs text-text-body">生成长度上限<input aria-label="生成长度上限" type="number" min={256} max={8192} className={INPUT} value={draft.maxTokens} onChange={(event) => patch({ maxTokens: event.target.value })} /></label>
      <label className="text-xs text-text-body">刷新条件（留空表示无自动条件）<textarea aria-label="模型刷新条件" className={INPUT} value={draft.advanced} onChange={(event) => patch({ advanced: event.target.value })} placeholder={'例如 {"refresh_after_consolidation":true}'} /></label>
    </> : <>
      <label className="text-xs text-text-body">优先级<input aria-label="指令优先级" type="number" min={-1000} max={1000} className={INPUT} value={draft.priority} onChange={(event) => patch({ priority: event.target.value })} /></label>
      <label className="text-xs text-text-body"><input type="checkbox" checked={draft.active} onChange={(event) => patch({ active: event.target.checked })} /> 启用此指令</label>
    </>}
    <details><summary className="cursor-pointer text-xs text-text-secondary">高级：资源标签</summary><label className="text-xs text-text-body">完整标签列表（JSON 数组）<textarea aria-label="资源标签" className={INPUT} value={draft.tags} onChange={(event) => patch({ tags: event.target.value })} /></label></details>
  </>;
}

function LabelFields({ draft, change }: { draft: ResourceDraft; change(value: ResourceDraft): void }) {
  const parsed = draft.advanced.trim() ? HindsightTemplateLabelGroupSchema.safeParse(safeJson(draft.advanced)) : null;
  return <>
    <p className="text-xs text-text-secondary">简单标签组每行填写一个允许值；复杂分组可编辑完整定义。停用 taki-layer 会降低自动分类覆盖。</p>
    {!draft.advanced.trim() && <textarea aria-label="标签允许值" className={`${INPUT} min-h-20`} value={draft.text} onChange={(event) => change({ ...draft, text: event.target.value })} />}
    {parsed?.success && <p className="text-xs text-text-body">当前定义：{parsed.data.key} · {parsed.data.type ?? "默认类型"} · {parsed.data.values?.map((item) => item.value).join("、") || "嵌套 / 自由值"}</p>}
    <details open={draft.advanced.trim().length > 0}><summary className="cursor-pointer text-xs text-text-secondary">高级：完整标签组定义</summary>
      <textarea aria-label="完整标签组定义" className={`${INPUT} min-h-28`} value={draft.advanced} onChange={(event) => change({ ...draft, advanced: event.target.value })} />
    </details>
  </>;
}
function safeJson(value: string): unknown { try { return JSON.parse(value); } catch { return null; } }

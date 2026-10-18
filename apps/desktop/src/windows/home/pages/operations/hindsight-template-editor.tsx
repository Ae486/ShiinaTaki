/**
 * INPUT:  a Core-seeded template intent, persisted explicit user choices and editing callbacks
 * OUTPUT: scope/default selection and text/resource customization controls, distinct from inheritance
 * POS:    ui/operations — drafts are local intent; only a reviewed Core preview can be applied
 */
import type { MemoryTemplatePreviewParams, MemoryTemplateUserChoices } from "@taki/shared";
import { ActionButton } from "../../action-button.tsx";
import type { TemplateFrame } from "./hindsight-template-state.ts";
import { templateUserChoices } from "./hindsight-template-state.ts";
import { TemplateResourceEditor } from "./hindsight-template-resource-editor.tsx";

const INPUT = "w-full rounded border border-border bg-surface p-2 text-xs text-text-body";
const CONFIG_FIELDS = [
  { key: "retain_mission", label: "记忆提取重点" }, { key: "observations_instructions", label: "归纳补充说明" }, { key: "reflect_mission", label: "反思重点" },
] as const;
interface EditorProps { frame: TemplateFrame; draft: MemoryTemplatePreviewParams; locked: boolean; edit(value: MemoryTemplatePreviewParams): void; resourceEditing(value: boolean): void }

export function TemplateEditor({ frame, draft, locked, edit, resourceEditing }: EditorProps) {
  const choices = templateUserChoices(frame, draft);
  const setChoices = (userChoices: MemoryTemplateUserChoices) => {
    if (draft.target.kind === "bank") edit({ ...draft, target: { ...draft.target, userChoices } });
  };
  return <fieldset disabled={locked} className="flex min-w-0 flex-col gap-3">
    <TemplateVersions frame={frame} draft={draft} edit={edit} />
    {draft.refresh.length > 0 && <p className="text-xs text-text-secondary">切换模板版本会清除本次生成请求，请在新预览中重新选择需要生成的模型。</p>}
    <label className="text-xs text-text-body">接管方式
      <select aria-label="接管方式" className={INPUT} value={draft.enrollment} onChange={(event) => edit({ ...draft, enrollment: event.target.value === "reviewed-existing" ? "reviewed-existing" : "fresh" })}>
        <option value="fresh">常规预览（不自动接管已有资源）</option><option value="reviewed-existing">核对已有配置后接管 / 重新协调</option>
      </select>
    </label>
    {draft.target.kind === "bank" && <>
      <p className="text-xs text-text-secondary">用户设置优先于 Taki 模板。自定义值即使与模板相同，也保留为独立选择；移除模板不会清除这些选择。</p>
      {CONFIG_FIELDS.map((field) => <ConfigChoice key={field.key} field={field} choices={choices} change={setChoices} />)}
      <TemplateResourceEditor choices={choices} change={setChoices} editing={resourceEditing} />
    </>}
    {draft.target.kind === "defaults" && <p className="text-xs text-text-secondary">更新会覆盖 Core 列出的现有 Bank，并设置以后新 Bank 的模板版本；各 Bank 的用户定制独立保留。</p>}
  </fieldset>;
}

function TemplateVersions({ frame, draft, edit }: Pick<EditorProps, "frame" | "draft" | "edit">) {
  const target = draft.target;
  if (target.kind === "bank") return <VersionSelect label="此 Bank 的 Taki 模板" scope={frame.template.bank?.scope ?? "global"}
    value={target.templateRevision} frame={frame} change={(templateRevision) => edit({ ...draft, refresh: [], target: { ...target, templateRevision } })} />;
  return <div className="grid gap-3 sm:grid-cols-2">
    <VersionSelect label="全局模板默认版本" scope="global" value={target.globalTemplateRevision} frame={frame}
      change={(globalTemplateRevision) => edit({ ...draft, refresh: [], target: { ...target, globalTemplateRevision } })} />
    <VersionSelect label="角色模板默认版本" scope="character" value={target.characterTemplateRevision} frame={frame}
      change={(characterTemplateRevision) => edit({ ...draft, refresh: [], target: { ...target, characterTemplateRevision } })} />
  </div>;
}
function VersionSelect({ label, scope, value, frame, change }: { label: string; scope: "global" | "character"; value: string; frame: TemplateFrame; change(value: string): void }) {
  const versions = [...new Set(frame.template.catalogs.filter((item) => item.scope === scope).map((item) => item.revision))];
  if (value && value !== "none" && !versions.includes(value)) versions.push(value);
  return <label className="text-xs text-text-body">{label}<select aria-label={label} className={INPUT} value={value} onChange={(event) => change(event.target.value)}>
    {!value && <option value="">请选择版本</option>}{versions.map((version) => <option key={version} value={version}>{version}</option>)}
    <option value="none">移除 Taki 模板（保留用户设置和 Hindsight）</option>
  </select></label>;
}

function ConfigChoice({ field, choices, change }: { field: typeof CONFIG_FIELDS[number]; choices: MemoryTemplateUserChoices; change(value: MemoryTemplateUserChoices): void }) {
  const current = choices.config.find((item) => item.key === field.key)?.choice ?? { mode: "inherit" as const };
  const update = (choice: MemoryTemplateUserChoices["config"][number]["choice"]) => change({ ...choices,
    config: [...choices.config.filter((item) => item.key !== field.key), { key: field.key, choice }] });
  return <div className="rounded border border-border-subtle p-3">
    <label className="text-xs text-text-body">{field.label}<select aria-label={`${field.label}模式`} className={INPUT} value={current.mode}
      onChange={(event) => update(event.target.value === "value" ? { mode: "value", value: current.mode === "value" ? current.value : "" }
        : event.target.value === "suppress" ? { mode: "suppress" } : { mode: "inherit" })}>
      <option value="inherit">继承当前模板 / 原有设置</option><option value="value">独立自定义值</option><option value="suppress">明确停用此项</option>
    </select></label>
    {current.mode === "value" && <textarea aria-label={`${field.label}自定义值`} className={`${INPUT} mt-2 min-h-20`} value={current.value} onChange={(event) => update({ mode: "value", value: event.target.value })} />}
    {current.mode === "suppress" && <p className="mt-1 text-xs text-text-secondary">该项已明确停用；切回继承才能恢复模板或原有配置。</p>}
    {current.mode !== "inherit" && <ActionButton tone="link" onClick={() => update({ mode: "inherit" })}>重置为继承</ActionButton>}
  </div>;
}

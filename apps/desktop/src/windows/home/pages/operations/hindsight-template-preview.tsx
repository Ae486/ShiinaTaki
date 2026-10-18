/**
 * INPUT:  a genuine complete Core preview and operator acknowledgements
 * OUTPUT: per-Bank changes/deletion/provider consequences and one explicit confirmation
 * POS:    ui/operations — detail or consent gaps never become an executable confirmation
 */
import { useEffect, useRef, useState } from "react";
import { MemoryTemplateUserChoicesSchema, type MemoryTemplateDetail, type MemoryTemplateUserChoices, type HindsightTemplateChanges,
  type HindsightTemplateModelDefinition, type HindsightTemplateDirectiveDefinition, type HindsightTemplateSnapshot } from "@taki/shared";
import { ActionButton } from "../../action-button.tsx";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import type { TemplatesController, TemplatesState, TemplateAcknowledgements } from "./hindsight-template-controller.ts";
import { TEMPLATE_ERROR_LABEL, templateUserChoices } from "./hindsight-template-state.ts";

export function TemplatePreview({ state, controller }: { state: TemplatesState; controller: TemplatesController }) {
  const preview = state.preview;
  if (state.previewError) return <FeedbackLine tone="warn">{state.previewError}</FeedbackLine>;
  if (!preview) return state.previewLoading ? <p role="status" className="text-xs text-text-secondary">正在读取预览…</p> : null;
  if (preview.state === "refused") return <TemplateConflict state={state} controller={controller} />;
  return <div className="rounded-lg border border-border p-3" role="region" aria-label="模板变更预览"
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); controller.dismiss(); } }}>
    <p className="mb-2 text-sm font-semibold text-text-strong">本次预览 · {preview.banks.length} 个 Bank</p>
    {state.previewLoading ? <p role="status" className="text-xs text-text-secondary">正在读取所有 Bank 的完整后果，暂不能确认…</p>
      : state.details.map((detail) => <BankConsequences key={detail.bank.target.bank_id} detail={detail} state={state} controller={controller} />)}
    <TemplateConfirmation key={preview.previewId} state={state} controller={controller} />
  </div>;
}

function TemplateConfirmation({ state, controller }: { state: TemplatesState; controller: TemplatesController }) {
  const [ack, setAck] = useState<TemplateAcknowledgements>({ deletion: false, provider: false, enrollment: false });
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus(); return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  const deletion = state.details.some((item) => item.deletions.length > 0);
  const provider = state.details.some((item) => item.refresh.length > 0);
  const enrollment = state.draft?.enrollment === "reviewed-existing";
  const locked = state.previewLoading || state.busyKey !== null || state.loading || !!state.error || state.draftStale || state.editorPending
    || deletion && !ack.deletion || provider && !ack.provider || enrollment && !ack.enrollment;
  return <div className="mt-3 flex flex-col gap-2">
    {deletion && <label className="text-xs text-text-body"><input type="checkbox" checked={ack.deletion} onChange={(event) => setAck({ ...ack, deletion: event.target.checked })} /> 我已核对每项删除及其内容、历史和依赖损失</label>}
    {provider && <label className="text-xs text-text-body"><input type="checkbox" checked={ack.provider} onChange={(event) => setAck({ ...ack, provider: event.target.checked })} /> 我同意本次列出的生成任务可能调用模型 / 嵌入并产生费用，外部调用重试不保证只计费一次</label>}
    {enrollment && <label className="text-xs text-text-body"><input type="checkbox" checked={ack.enrollment} onChange={(event) => setAck({ ...ack, enrollment: event.target.checked })} /> 我已核对现有值和资源身份，同意按此预览接管或重新协调</label>}
    <div className="flex gap-2"><ActionButton tone="primary" disabled={locked} onClick={() => void controller.confirm(ack)}>确认应用模板变更</ActionButton>
      <button ref={cancel} type="button" className="rounded px-3 py-2 text-xs text-text-body" onClick={() => controller.dismiss()}>取消预览</button></div>
    <p className="text-xs text-text-secondary">确认只提交此预览。中断后请观察原计划；不会自动重新应用。</p>
  </div>;
}

function BankConsequences({ detail, state, controller }: { detail: MemoryTemplateDetail; state: TemplatesState; controller: TemplatesController }) {
  const id = detail.bank.target.bank_id;
  return <article className="mb-3 rounded border border-border-subtle p-3 text-xs text-text-body">
    <h3 className="mb-2 font-semibold">{detail.bank.scope === "global" ? "全局" : "角色"} · {id}</h3>
    <p>模板：{detail.bank.templateRevision === "none" ? "移除 Taki 贡献" : detail.bank.templateRevision} · 用户版本 {detail.bank.userRevision}</p>
    <p className="mb-2">配置 {detail.bank.configChanges} 项 · 模型 {detail.bank.modelChanges} 项 · 指令 {detail.bank.directiveChanges} 项</p>
    {detail.changes.config.map((item) => <div key={item.key} className="my-2">
      <p className="font-medium">{CONFIG_LABEL[item.key]}</p><ConfigValue value={item} />
    </div>)}
    {detail.changes.models.filter((item) => item.kind === "upsert").map((item) => <div key={item.definition.id} className="my-2">
      <p className="font-medium">记忆模型：{item.definition.name}（{item.definition.id}）</p>
      <ModelDefinition value={item.definition} />
      <ActionButton tone="link" onClick={() => requestRefresh(state, controller, { bankId: id, modelId: item.definition.id })}>将此模型加入生成预览</ActionButton>
      {state.draft?.target.kind === "bank" && <ActionButton tone="link" onClick={() => copyUserResource(state, controller, { family: "models", resource: { id: item.definition.id, choice: { mode: "value", value: item.definition } } })}>将模型定义用作独立定制</ActionButton>}
    </div>)}
    {detail.changes.directives.filter((item) => item.kind === "upsert").map((item) => <div key={item.definition.id} className="my-2">
      <p className="font-medium break-all">指令：{item.definition.name}（{item.definition.id}）</p>
      <DirectiveDefinition value={item.definition} />
      {state.draft?.target.kind === "bank" && <ActionButton tone="link" onClick={() => copyUserResource(state, controller, { family: "directives", resource: { id: item.definition.id, name: item.definition.name, choice: { mode: "value", value: item.definition } } })}>将指令定义用作独立定制</ActionButton>}
    </div>)}
    <details className="my-2"><summary>核对原有配置与资源</summary><BeforeImages snapshot={detail.before} /></details>
    {detail.before.models.filter((item) => item.definition !== null && !detail.deletions.some((deletion) => deletion.kind === "model" && deletion.id === item.id)).map((item) => <ActionButton key={item.id} tone="link"
      onClick={() => requestRefresh(state, controller, { bankId: id, modelId: item.id })}>请求生成已有模型：{item.definition?.name}</ActionButton>)}
    {detail.deletions.map((item) => <p key={`${item.kind}:${item.id}`} className="my-2 break-all text-danger">删除{item.kind === "model" ? "记忆模型" : "指令"} {item.id}：历史 {item.historyCount} 条，依赖 {item.dependencyCount} 项，{item.hasGeneratedContent ? "包含已生成内容" : "无已生成内容"}。</p>)}
    {detail.refresh.length > 0 ? <p>将请求生成：{detail.refresh.map((item) => item.modelId).join("、")}。可能使用模型与嵌入；定义应用成功不等于生成成功。</p>
      : <p>本次不请求生成内容。仅安装 / 更新定义不代表模型已有可检索内容。</p>}
  </article>;
}

const CONFIG_LABEL = { retain_mission: "记忆提取重点", observations_instructions: "归纳补充说明", reflect_mission: "反思重点", entity_labels: "分类标签组" } as const;
function ConfigValue({ value }: { value: HindsightTemplateChanges["config"][number] }) {
  return <p className="whitespace-pre-wrap break-all">{value.stored.kind === "absent" ? "恢复继承原生配置" : value.stored.kind === "null_tombstone" ? "明确清除 Bank 覆盖值"
    : typeof value.stored.value === "string" ? value.stored.value : JSON.stringify(value.stored.value, null, 2)}</p>;
}
function ModelDefinition({ value }: { value: HindsightTemplateModelDefinition }) {
  return <><p className="whitespace-pre-wrap break-words">查询：{value.source_query}</p><p>上限 {value.max_tokens} · 标签 {value.tags.join("、") || "无"}</p>
    {value.trigger ? <details><summary>完整刷新条件</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(value.trigger, null, 2)}</pre></details>
      : <p>没有自动刷新条件。</p>}</>;
}
function DirectiveDefinition({ value }: { value: HindsightTemplateDirectiveDefinition }) {
  return <><p>优先级 {value.priority} · {value.is_active ? "启用" : "停用"}</p>
    <p className="whitespace-pre-wrap break-words">{value.content}</p><p>标签：{value.tags.join("、") || "无"}</p></>;
}
function BeforeImages({ snapshot }: { snapshot: HindsightTemplateSnapshot }) {
  return <div className="mt-2 flex flex-col gap-2">
    {snapshot.config.map((item) => <div key={item.key}><p>{CONFIG_LABEL[item.key]} · {item.stored.kind === "absent" ? "原先继承" : item.stored.kind === "null_tombstone" ? "原先明确清除" : "原先存在覆盖"}</p>
      <ConfigValue value={item} /><p className="whitespace-pre-wrap break-all">上层值：{typeof item.inherited === "string" ? item.inherited : JSON.stringify(item.inherited)}</p></div>)}
    {snapshot.models.map((item) => <div key={item.id}><p className="break-all">原有模型：{item.definition?.name ?? item.id}（{item.id}）</p>
      {item.definition ? <ModelDefinition value={item.definition} /> : <p>原先不存在。</p>}</div>)}
    {snapshot.directives.map((item) => <div key={item.id}><p className="break-all">原有指令：{item.name}（{item.id}）</p>
      {item.definition ? <DirectiveDefinition value={item.definition} /> : <p>此标识原先不存在。</p>}</div>)}
  </div>;
}

function requestRefresh(state: TemplatesState, controller: TemplatesController, input: { bankId: string; modelId: string }): void {
  const { bankId, modelId } = input;
  const draft = state.draft; if (!draft) return;
  const prior = draft.refresh.find((item) => item.bankId === bankId)?.modelIds ?? [];
  controller.edit({ ...draft, refresh: [...draft.refresh.filter((item) => item.bankId !== bankId), { bankId, modelIds: [...new Set([...prior, modelId])] }] });
}
function copyUserResource(state: TemplatesState, controller: TemplatesController,
  input: { family: "models" | "directives"; resource: MemoryTemplateUserChoices["models" | "directives"][number] }): void {
  const { family, resource } = input;
  const draft = state.draft; if (draft?.target.kind !== "bank") return;
  const choices = templateUserChoices(state.frame, draft);
  const userChoices = MemoryTemplateUserChoicesSchema.parse({ ...choices, [family]: [...choices[family].filter((item) => item.id !== resource.id), resource] });
  controller.edit({ ...draft, target: { ...draft.target, userChoices } });
}

function TemplateConflict({ state, controller }: { state: TemplatesState; controller: TemplatesController }) {
  const preview = state.preview; if (preview?.state !== "refused") return null;
  const choose = (id: string, name: string) => {
    const draft = state.draft; const bankId = preview.review?.target.bank_id; if (!draft || !bankId) return;
    const previous = draft.directives.find((item) => item.bankId === bankId)?.items ?? [];
    controller.edit({ ...draft, enrollment: "reviewed-existing", directives: [...draft.directives.filter((item) => item.bankId !== bankId),
      { bankId, items: [...previous.filter((item) => item.name !== name), { id, name }] }] });
  };
  return <div className="rounded border border-border p-3 text-xs text-text-body">
    <FeedbackLine tone="warn">{TEMPLATE_ERROR_LABEL[preview.reason]}</FeedbackLine>
    {preview.review && <><p className="my-2">现有资源需要核对后重新预览；不会自动接管或删除。多个同名资源必须先解决歧义。</p>
      <BeforeImages snapshot={preview.review} />
      {preview.review.directives.map((item) => <div key={item.id}><p>指令：{item.name} · 同名候选 {item.name_matches.length} 个</p>
        {item.name_matches.map((id) => <div key={id} className="my-1 break-all">{id} {item.name_matches.length === 1
          && <ActionButton tone="link" onClick={() => choose(id, item.name)}>选择此现有指令并重新核对</ActionButton>}</div>)}</div>)}
      <ActionButton onClick={() => { if (state.draft) controller.edit({ ...state.draft, enrollment: "reviewed-existing" }); }}>核对后改用已有配置接管预览</ActionButton>
    </>}
  </div>;
}

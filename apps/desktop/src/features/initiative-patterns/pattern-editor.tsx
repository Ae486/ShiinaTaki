/**
 * INPUT: captured editing base, latest server snapshot and explicit proposal/close actions.
 * OUTPUT: stable manual authoring editor with deliberate conflict rebase and preserved drafts.
 * POS: reusable Desktop editor; saving creates a proposal only, never activation.
 */
import type { InitiativeSetupStatus, InteractionPatternDefinition, InteractionPatternView } from "@taki/shared";
import { ActionButton } from "@/windows/home/action-button.js";
import { Field, FIELD_CONTROL } from "@/components/ui/field.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { PatternConditionEditor } from "./pattern-condition-editor.tsx";
import { PatternOptionsEditor } from "./pattern-options-editor.tsx";
import { PatternDefinitionView } from "./pattern-definition-view.tsx";
import { usePatternEditor } from "./use-pattern-editor.ts";

export type PatternEditorProps = {
  initial: InteractionPatternView | null;
  latest: InteractionPatternView | null;
  disabled: boolean;
  completions?: InitiativeSetupStatus["completions"];
  submit(base: InteractionPatternView | null, definition: InteractionPatternDefinition): Promise<boolean>;
  close(): void;
};

export function PatternEditor(props: PatternEditorProps) {
  const editor = usePatternEditor(props);
  const conflict = editor.base !== null && props.latest?.version !== editor.base.version;
  const latestDefinition = props.latest?.candidateRevision?.definition ?? props.latest?.effectiveRevision?.definition;
  return <section className="space-y-4 rounded-xl border border-accent-border bg-surface p-4">
    <h2 className="text-sm font-semibold">{editor.base ? "修改互动规则" : "新建互动规则"}</h2>
    <p className="text-xs text-text-secondary">保存后会生成待确认提案。已生效内容在新提案确认前保持原样。</p>
    <Field label="名称"><input className={FIELD_CONTROL} maxLength={120} value={editor.draft.title} onChange={(e) => editor.patch({ title: e.target.value })} /></Field>
    <Field label="互动目的" hint="描述希望在何时关心什么，不必写固定台词。"><textarea className={FIELD_CONTROL} maxLength={1000} rows={3} value={editor.draft.purpose} onChange={(e) => editor.patch({ purpose: e.target.value })} /></Field>
    <PatternConditionEditor conditions={editor.draft.conditions.all} completions={props.completions} onChange={(all) => editor.patch({ conditions: { all } })} />
    <PatternOptionsEditor draft={editor.draft} patch={editor.patch} />
    {conflict && <div className="space-y-3">
      <FeedbackLine tone="warn">当前内容已更新，你的草稿已保留。查看最新内容后，可保留草稿重新提案。</FeedbackLine>
      {props.latest && <details><summary className="cursor-pointer text-sm">查看最新内容</summary>
        {latestDefinition && <PatternDefinitionView definition={latestDefinition} />}
      </details>}
      <ActionButton disabled={props.disabled || !props.latest || props.latest.state === "retired"} onClick={() => editor.useLatestBase(props.latest)}>已核对最新内容，保留草稿继续</ActionButton>
    </div>}
    {editor.error && <FeedbackLine tone="danger">{editor.error}</FeedbackLine>}
    <div className="flex justify-end gap-2">
      <ActionButton onClick={props.close}>取消编辑</ActionButton>
      <ActionButton tone="primary" disabled={props.disabled || conflict} onClick={() => void editor.save()}>保存为待确认提案</ActionButton>
    </div>
  </section>;
}

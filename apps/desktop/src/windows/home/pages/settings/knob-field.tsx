/**
 * INPUT:  latest config metadata, connection readiness and typed local save outcomes.
 * OUTPUT: a stable knob row with retained draft, composition/focus ownership and deliberate conflict actions.
 * POS:    Home Settings presentation — useKnobDraft owns editing; config remains Core-owned and secrets stay read-only.
 */

import type { ConfigEntry, ConfigValue } from "@taki/shared";
import { Badge, type BadgeTone } from "../../badge.tsx";
import { CARD_ROW } from "../../page-card.tsx";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { PendingIndicator } from "@/components/ui/pending-indicator.js";
import { editorFor } from "./knob-editor.ts";
import { KnobInput } from "./knob-input.tsx";
import { ActionButton } from "../../action-button.tsx";
import { useKnobDraft } from "./use-knob-draft.ts";
import type { ConfigSaveOutcome } from "./config-save-controller.ts";
import { configHintOf } from "./config-groups.ts";

export interface KnobFieldProps {
  entry: ConfigEntry;
  /** Client-side Chinese label from config-groups; undefined = unknown key renders the raw key primary. */
  chineseLabel?: string;
  connectionReady: boolean;
  onSave: (key: string, value: ConfigValue | null) => Promise<ConfigSaveOutcome>;
}

function badgesFor(entry: ConfigEntry): Array<{ label: string; tone: BadgeTone }> {
  const badges: Array<{ label: string; tone: BadgeTone }> = [];
  if (entry.envLocked) badges.push({ label: "env 锁定", tone: "neutral" });
  if (entry.apply === "restart") badges.push({ label: "重启生效", tone: "warn" });
  if (entry.apply === "env-only") badges.push({ label: "仅环境变量", tone: "neutral" });
  if (entry.secret) badges.push({ label: "密钥", tone: "neutral" });
  if (entry.stored) badges.push({ label: "已自定义", tone: "ok" });
  return badges;
}

export function KnobField({ entry, chineseLabel, connectionReady, onSave }: KnobFieldProps) {
  const editor = editorFor(entry);
  const availableEditor = connectionReady || editor.disabled ? editor : { ...editor, disabled: true };
  const draft = useKnobDraft({ entry, connectionReady, onSave });

  return (
    <div className={`flex flex-col gap-1.5 transition-colors hover:bg-surface-muted/60 ${CARD_ROW}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          {chineseLabel === undefined ? (
            <code className="text-xs font-semibold text-text-body">{entry.key}</code>
          ) : (
            <>
              <span className="block text-xs font-semibold text-text-body">{chineseLabel}</span>
              <code className="block truncate text-xs font-normal text-text-secondary">{entry.key}</code>
            </>
          )}
        </div>
        <span className="flex flex-wrap items-center justify-end gap-1" aria-busy={draft.state.saving}>
          <PendingIndicator active={draft.state.saving} label="正在保存配置" />
          {badgesFor(entry).map((badge) => (
            <Badge key={badge.label} tone={badge.tone}>
              {badge.label}
            </Badge>
          ))}
        </span>
      </div>
      <p className="text-xs leading-snug text-text-secondary">{entry.description}</p>
      {configHintOf(entry.key) && <p className="text-xs leading-snug text-text-secondary">{configHintOf(entry.key)}</p>}
      <KnobInput entry={entry} editor={availableEditor} draft={draft.state.draft} events={draft.events} />
      {editor.disabledReason && <p className="text-xs text-text-secondary">{editor.disabledReason}</p>}
      <DraftFeedback draft={draft} disabled={availableEditor.disabled} />
    </div>
  );
}

function DraftFeedback({ draft, disabled }: { draft: ReturnType<typeof useKnobDraft>; disabled: boolean }) {
  const state = draft.state;
  return (
    <div className="min-h-5">
      {state.error && <FeedbackLine tone="danger">{state.error}</FeedbackLine>}
      {draft.conflicted && <FeedbackLine tone="warn">此项已在别处修改。最新值：{state.latest || "（未设置）"}</FeedbackLine>}
      {state.dirty && (
        <div className="flex flex-wrap items-center gap-2">
          {draft.conflicted && <ActionButton disabled={state.composing || state.saving} onClick={draft.useLatest}>使用最新值</ActionButton>}
          <ActionButton disabled={disabled || state.composing || state.saving} onClick={draft.save}>
            {draft.conflicted ? "确认覆盖保存" : "保存未保存的修改"}
          </ActionButton>
        </div>
      )}
    </div>
  );
}

/**
 * INPUT:  one config.list entry + the page's save callback and last-save notice.
 * OUTPUT: <KnobField> — the row for one knob: description, badges (env 锁定 / 重启生效 / 密钥), the editor its
 *         metadata prescribes (rendered by knob-input), and the save outcome (FeedbackLine).
 * POS:    ui/windows/home/pages/settings — presentational; the metadata→editor decision lives in knob-editor.ts.
 *         Row padding rides the shared CARD_ROW step (batch-2 §1).
 */

import { useEffect, useState } from "react";
import type { ConfigEntry, ConfigValue } from "@taki/shared";
import { Badge, type BadgeTone } from "../../badge.tsx";
import { CARD_ROW } from "../../page-card.tsx";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { editorFor, parseKnobInput } from "./knob-editor.ts";
import { KnobInput } from "./knob-input.tsx";

export interface KnobFieldProps {
  entry: ConfigEntry;
  connectionReady: boolean;
  notice: { ok: boolean; message: string } | undefined;
  /** May return the in-flight save promise so the row can show its pending state (A6). */
  onSave: (key: string, value: ConfigValue | null) => Promise<void> | void;
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

export function KnobField({ entry, connectionReady, notice, onSave }: KnobFieldProps) {
  const editor = editorFor(entry);
  const availableEditor = connectionReady || editor.disabled ? editor : { ...editor, disabled: true };
  const [draft, setDraft] = useState(editor.display);
  const [localError, setLocalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A config.changed push (or an accepted save) rewrites the effective value — the field follows the server, not the
  // stale draft the operator abandoned.
  useEffect(() => setDraft(editor.display), [editor.display]);

  const commit = (raw: string | boolean) => {
    const parsed = parseKnobInput(entry, raw);
    setLocalError(parsed.ok ? null : parsed.message);
    if (!parsed.ok) return;
    // A6: the commit-on-blur write shows a visible pending line until the save settles.
    setSaving(true);
    void Promise.resolve(onSave(entry.key, parsed.value)).finally(() => setSaving(false));
  };

  return (
    <div className={`flex flex-col gap-1.5 transition-colors hover:bg-surface-muted/60 ${CARD_ROW}`}>
      <div className="flex items-baseline justify-between gap-3">
        <code className="text-xs font-semibold text-text-body">{entry.key}</code>
        <span className="flex flex-wrap justify-end gap-1">
          {badgesFor(entry).map((badge) => (
            <Badge key={badge.label} tone={badge.tone}>
              {badge.label}
            </Badge>
          ))}
        </span>
      </div>
      <p className="text-xs leading-snug text-text-secondary">{entry.description}</p>
      <KnobInput entry={entry} editor={availableEditor} draft={draft} onDraft={setDraft} onCommit={commit} />
      {editor.disabledReason && <p className="text-xs text-text-secondary">{editor.disabledReason}</p>}
      {saving && <FeedbackLine tone="info">保存中…</FeedbackLine>}
      {localError && <FeedbackLine tone="danger">{localError}</FeedbackLine>}
      {notice && <FeedbackLine tone={notice.ok ? "ok" : "danger"}>{notice.message}</FeedbackLine>}
    </div>
  );
}

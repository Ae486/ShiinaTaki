/**
 * INPUT:  one config.list entry + the page's save callback and last-save notice.
 * OUTPUT: <KnobField> — the row for one knob: description, badges (env 锁定 / 重启生效 / 密钥), the editor its
 *         metadata prescribes (rendered by knob-input), and the save outcome.
 * POS:    ui/windows/home/pages/settings — presentational; the metadata→editor decision lives in knob-editor.ts.
 */

import { useEffect, useState } from "react";
import type { ConfigEntry, ConfigValue } from "@taki/shared";
import { editorFor, parseKnobInput } from "./knob-editor.ts";
import { KnobInput } from "./knob-input.tsx";

export interface KnobFieldProps {
  entry: ConfigEntry;
  notice: { ok: boolean; message: string } | undefined;
  onSave: (key: string, value: ConfigValue | null) => void;
}

function Badges({ entry }: { entry: ConfigEntry }) {
  const badges: string[] = [];
  if (entry.envLocked) badges.push("env 锁定");
  if (entry.apply === "restart") badges.push("重启生效");
  if (entry.apply === "env-only") badges.push("仅环境变量");
  if (entry.secret) badges.push("密钥");
  if (entry.stored) badges.push("已自定义");
  return (
    <span className="flex flex-wrap gap-1">
      {badges.map((badge) => (
        <span key={badge} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
          {badge}
        </span>
      ))}
    </span>
  );
}

export function KnobField({ entry, notice, onSave }: KnobFieldProps) {
  const editor = editorFor(entry);
  const [draft, setDraft] = useState(editor.display);
  const [localError, setLocalError] = useState<string | null>(null);
  // A config.changed push (or an accepted save) rewrites the effective value — the field follows the server, not the
  // stale draft the operator abandoned.
  useEffect(() => setDraft(editor.display), [editor.display]);

  const commit = (raw: string | boolean) => {
    const parsed = parseKnobInput(entry, raw);
    setLocalError(parsed.ok ? null : parsed.message);
    if (parsed.ok) onSave(entry.key, parsed.value);
  };

  return (
    <div className="flex flex-col gap-1 border-b border-slate-100 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <code className="text-xs font-medium text-slate-700">{entry.key}</code>
        <Badges entry={entry} />
      </div>
      <p className="text-[11px] leading-snug text-slate-500">{entry.description}</p>
      <KnobInput entry={entry} editor={editor} draft={draft} onDraft={setDraft} onCommit={commit} />
      {editor.disabledReason && <p className="text-[11px] text-slate-400">{editor.disabledReason}</p>}
      {localError && <p className="text-[11px] text-rose-600">{localError}</p>}
      {notice && <p className={`text-[11px] ${notice.ok ? "text-emerald-700" : "text-rose-600"}`}>{notice.message}</p>}
    </div>
  );
}

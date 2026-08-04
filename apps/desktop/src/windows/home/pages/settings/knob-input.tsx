/**
 * INPUT:  one config entry's editor descriptor + the current draft and the commit callback.
 * OUTPUT: <KnobInput> — the editor the metadata prescribes (checkbox / select / text / number), or the secret's
 *         set-not-set readout.
 * POS:    ui/windows/home/pages/settings — the editor half of a knob row, split out so the row itself stays a card of
 *         description + badges + outcome.
 */

import type { ConfigEntry } from "@taki/shared";
import { Badge } from "../../badge.tsx";
import type { KnobEditor } from "./knob-editor.ts";

const FIELD_CLASS =
  "w-56 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none transition" +
  " focus:border-rose-300 focus:ring-2 focus:ring-rose-100 disabled:bg-slate-50 disabled:text-slate-400";

export interface KnobInputProps {
  entry: ConfigEntry;
  editor: KnobEditor;
  draft: string;
  onDraft: (value: string) => void;
  onCommit: (raw: string | boolean) => void;
}

function BooleanField({ on, disabled, onCommit }: { on: boolean; disabled: boolean; onCommit: (raw: boolean) => void }) {
  return (
    <label className="flex w-fit items-center gap-2 text-xs text-slate-600">
      <input
        type="checkbox"
        checked={on}
        disabled={disabled}
        onChange={(e) => onCommit(e.target.checked)}
        className="h-3.5 w-3.5 accent-rose-500"
      />
      {on ? "开启" : "关闭"}
    </label>
  );
}

export function KnobInput({ entry, editor, draft, onDraft, onCommit }: KnobInputProps) {
  if (editor.kind === "secret") {
    return (
      <span className="flex">
        <Badge tone={entry.secretSet ? "ok" : "muted"}>{editor.display}</Badge>
      </span>
    );
  }

  if (editor.kind === "boolean") {
    return <BooleanField on={draft === "true"} disabled={editor.disabled} onCommit={onCommit} />;
  }

  if (editor.kind === "enum") {
    return (
      <select
        value={draft}
        disabled={editor.disabled}
        onChange={(e) => {
          onDraft(e.target.value);
          onCommit(e.target.value);
        }}
        className={FIELD_CLASS}
      >
        {editor.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={editor.kind === "string" ? "text" : "number"}
      value={draft}
      disabled={editor.disabled}
      placeholder={entry.default === null ? "未设置" : String(entry.default)}
      onChange={(e) => onDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      className={FIELD_CLASS}
    />
  );
}

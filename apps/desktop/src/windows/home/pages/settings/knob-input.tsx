/**
 * INPUT:  config editor metadata, retained draft and explicit edit/focus/composition/commit handlers.
 * OUTPUT: accessible typed controls or the existing secret-presence display.
 * POS:    Home Settings input leaf — forwards interaction facts; never decides persistence or submits composing blur.
 */

import type { ConfigEntry } from "@taki/shared";
import { Badge } from "../../badge.tsx";
import type { KnobEditor } from "./knob-editor.ts";
import type { useKnobDraft } from "./use-knob-draft.ts";

// The knob key/description header is the row's visible label; this class only styles the control.
const FIELD_CLASS =
  "w-56 rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-text-body transition" +
  " focus:border-accent-border-strong disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-faint";

export interface KnobInputProps {
  entry: ConfigEntry;
  editor: KnobEditor;
  draft: string;
  events: ReturnType<typeof useKnobDraft>["events"];
}

function BooleanField({ on, disabled, onCommit }: { on: boolean; disabled: boolean; onCommit: (raw: boolean) => void }) {
  return (
    <label className="flex w-fit items-center gap-2 text-xs text-text-body">
      <input
        type="checkbox"
        checked={on}
        disabled={disabled}
        onChange={(e) => onCommit(e.target.checked)}
        className="h-3.5 w-3.5 accent-accent"
      />
      {on ? "开启" : "关闭"}
    </label>
  );
}

export function KnobInput({ entry, editor, draft, events }: KnobInputProps) {
  if (editor.kind === "secret") {
    return (
      <span className="flex">
        <Badge tone={entry.secretSet ? "ok" : "muted"}>{editor.display}</Badge>
      </span>
    );
  }

  if (editor.kind === "boolean") {
    return <BooleanField on={draft === "true"} disabled={editor.disabled} onCommit={(value) => { events.change(String(value)); events.commit(); }} />;
  }

  if (editor.kind === "enum") {
    return (
      <select
        value={draft}
        disabled={editor.disabled}
        aria-label={entry.key}
        onChange={(e) => {
          events.change(e.target.value);
          events.commit();
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
      aria-label={entry.key}
      placeholder={entry.default === null ? "未设置" : String(entry.default)}
      onChange={(e) => events.change(e.target.value)}
      onFocus={events.focus}
      onBlur={events.blur}
      onCompositionStart={events.compositionStart}
      onCompositionEnd={(event) => events.compositionEnd(event.currentTarget.value)}
      className={FIELD_CLASS}
    />
  );
}

/**
 * INPUT:  one config.list entry (its input.kind metadata, provenance flags and effective value).
 * OUTPUT: editorFor(entry) -> the editor descriptor the field component renders; parseKnobInput(entry, raw) -> the
 *         typed value to send, or a refusal message.
 * POS:    ui/windows/home/pages/settings — the metadata→editor mapping, kept pure so it is node-testable. The panel
 *         NEVER derives a knob's shape from its key: everything here comes off the server-sent metadata.
 */

import type { ConfigEntry, ConfigValue } from "@taki/shared";

export type EditorKind = "boolean" | "int" | "number" | "string" | "enum" | "secret";

export interface KnobEditor {
  kind: EditorKind;
  /** Only bootstrap and secret settings are read-only; ordinary environment values are editable fallbacks. */
  disabled: boolean;
  /** Why the editor is disabled, or null when it is editable. */
  disabledReason: string | null;
  options: string[];
  min: number | null;
  max: number | null;
  /** What the row shows: the effective value, or set/not-set for a secret (invariant 5 — no secret value exists here). */
  display: string;
}

export function editorFor(entry: ConfigEntry): KnobEditor {
  const kind: EditorKind = entry.secret ? "secret" : entry.input.kind;
  const disabledReason = entry.secret
    ? "密钥存于系统凭据管理器"
    : entry.apply === "env-only"
        ? "启动前读取，仅环境变量"
      : null;
  return {
    kind,
    disabled: disabledReason !== null,
    disabledReason,
    options: entry.input.options ?? [],
    min: entry.input.min ?? null,
    max: entry.input.max ?? null,
    display: entry.secret ? (entry.secretSet ? "已设置" : "未设置") : entry.value === null ? "" : String(entry.value),
  };
}

export type ParseResult = { ok: true; value: ConfigValue | null } | { ok: false; message: string };

/**
 * Text/checkbox input → the typed value config.set expects. An empty string means "reset to env/default" (null), which
 * is the only way the panel clears a stored row. The server re-validates with the knob's zod schema regardless.
 */
export function parseKnobInput(entry: ConfigEntry, raw: string | boolean): ParseResult {
  if (typeof raw === "boolean") return { ok: true, value: raw };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (entry.input.kind === "int" || entry.input.kind === "number") {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return { ok: false, message: "请输入一个数字" };
    if (entry.input.kind === "int" && !Number.isInteger(parsed)) return { ok: false, message: "请输入一个整数" };
    if (entry.input.min !== undefined && parsed < entry.input.min) return { ok: false, message: `不得小于 ${entry.input.min}` };
    if (entry.input.max !== undefined && parsed > entry.input.max) return { ok: false, message: `不得大于 ${entry.input.max}` };
    return { ok: true, value: parsed };
  }
  return { ok: true, value: trimmed };
}

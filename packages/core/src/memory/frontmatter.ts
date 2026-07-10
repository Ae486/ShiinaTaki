/**
 * INPUT:  memory-file text (parse) or a flat scalar record + body (serialize)
 * OUTPUT: parseFrontmatter(text) -> {data, body}; serializeFrontmatter(data, body) -> text
 * POS:    core/memory — zero-dep YAML-frontmatter SUBSET (flat scalars only, research/frontmatter-and-budget.md); writes come only from serialize
 */

/** The only value shapes the subset accepts — flat scalars, no nesting, no multiline. */
export type FrontmatterValue = string | number | boolean;
export type FrontmatterData = Record<string, FrontmatterValue>;

const FENCE = "---";
// Hyphens are allowed so hyphenated keys (SKILL.md's `allowed-tools`) don't invalidate a whole file.
// Memory keys are all hyphen-free lowercase, so this relaxation is a no-op for them (skills-loader research).
const KEY_RE = /^[a-z][a-z0-9_-]*$/;

export interface ParsedFrontmatter {
  data: FrontmatterData;
  body: string;
}

/** Parse our fenced frontmatter. Tolerant on the value side (files are user-editable truth); structure is strict. */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const lines = text.split("\n");
  if ((lines[0] ?? "").trimEnd() !== FENCE) throw new Error("frontmatter: missing opening --- fence");
  const close = lines.findIndex((line, i) => i > 0 && line.trimEnd() === FENCE);
  if (close === -1) throw new Error("frontmatter: missing closing --- fence");

  const data: FrontmatterData = {};
  for (const raw of lines.slice(1, close)) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "") continue;
    const colon = line.indexOf(":");
    if (colon === -1) throw new Error(`frontmatter: line without a colon: ${line}`);
    const key = line.slice(0, colon).trim();
    if (!KEY_RE.test(key)) throw new Error(`frontmatter: invalid key: ${key}`);
    if (key in data) throw new Error(`frontmatter: duplicate key: ${key}`);
    data[key] = parseScalar(line.slice(colon + 1).trim());
  }
  return { data, body: lines.slice(close + 1).join("\n") };
}

/** Serialize a scalar record + body. The one write path — every string is JSON-quoted so YAML footguns are impossible. */
export function serializeFrontmatter(data: FrontmatterData, body: string): string {
  const lines = [FENCE];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (!KEY_RE.test(key)) throw new Error(`frontmatter: invalid key: ${key}`);
    lines.push(`${key}: ${serializeScalar(value)}`);
  }
  lines.push(FENCE);
  return `${lines.join("\n")}\n${body}`;
}

function parseScalar(raw: string): FrontmatterValue {
  if (raw.startsWith('"')) {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error(`frontmatter: invalid quoted value: ${raw}`);
    }
    if (typeof value !== "string") throw new Error(`frontmatter: quoted value is not a string: ${raw}`);
    return value;
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw; // tolerant literal string (covers hand-edited unquoted CJK)
}

function serializeScalar(value: FrontmatterValue): string {
  if (typeof value === "string") {
    if (/[\r\n]/.test(value)) throw new Error("frontmatter: newlines are not allowed in a value");
    return JSON.stringify(value); // handles :, quotes, backslashes, edge spaces; leaves CJK/emoji raw
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`frontmatter: non-finite number: ${value}`);
    return String(value);
  }
  return String(value); // boolean
}

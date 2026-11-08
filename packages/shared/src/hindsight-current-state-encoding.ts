/**
 * INPUT:  exact snake_case D78 JSON-domain values
 * OUTPUT: tagged canonical JSON with unsigned UTF-8 keys and binary64 number bytes
 * POS:    shared protocol codec — matches native current_state_bytes; never changes G1 or Local hashes
 */
import { HINDSIGHT_CURRENT_STATE_ENCODING } from "./hindsight-current-state-schema.ts";

export function hindsightCurrentStateJson(value: unknown): string {
  return JSON.stringify([HINDSIGHT_CURRENT_STATE_ENCODING, tagged(value)]);
}

function tagged(value: unknown): unknown[] {
  if (value === null) return ["null"];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "string") { assertUnicode(value); return ["string", value]; }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("HINDSIGHT_CURRENT_VALUE_UNSUPPORTED");
    const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value === 0 ? 0 : value, false);
    return ["number", [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")];
  }
  if (Array.isArray(value)) return ["array", Array.from(value, tagged)];
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>; const keys = Object.keys(object);
    keys.forEach(assertUnicode); keys.sort(compareUtf8);
    return ["object", keys.map((key) => [key, tagged(object[key])])];
  }
  throw new Error("HINDSIGHT_CURRENT_VALUE_UNSUPPORTED");
}

function assertUnicode(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    const next = value.charCodeAt(++index);
    if (unit > 0xdbff || !(next >= 0xdc00 && next <= 0xdfff)) throw new Error("HINDSIGHT_CURRENT_VALUE_UNSUPPORTED");
  }
}

function compareUtf8(left: string, right: string): number {
  // Keys have already passed Unicode validation. UTF-8 preserves scalar order,
  // so compare code points without re-encoding both keys on every sort comparison.
  // UTF-16 code-unit order would put supplementary characters before U+E000.
  let a = 0; let b = 0;
  while (a < left.length && b < right.length) {
    const x = left.codePointAt(a) ?? 0; const y = right.codePointAt(b) ?? 0;
    if (x !== y) return x - y;
    a += x > 0xffff ? 2 : 1;
    b += y > 0xffff ? 2 : 1;
  }
  return (left.length - a) - (right.length - b);
}

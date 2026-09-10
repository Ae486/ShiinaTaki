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
  if (Array.from(value).some((character) => {
    const point = character.codePointAt(0) ?? 0; return point >= 0xd800 && point <= 0xdfff;
  })) throw new Error("HINDSIGHT_CURRENT_VALUE_UNSUPPORTED");
}

function compareUtf8(left: string, right: string): number {
  const encoder = new TextEncoder(); const a = encoder.encode(left); const b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0); if (difference) return difference;
  }
  return a.length - b.length;
}

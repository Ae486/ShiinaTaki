/**
 * INPUT:  complete D77 JSON values, Bank namespace and a named digest domain
 * OUTPUT: iterative tagged binary64 JSON matching native application_state/codec.py
 * POS:    shared application-state identity — byte checksums and frozen G1/D78 hashes remain distinct
 */
import type { JsonValue } from "./memory-provider-domain-schema.ts";
import { TakiApplicationJsonValueSchema } from "./hindsight-application-json.ts";
import { TakiApplicationNamespaceSchema, TakiApplicationIdSchema, type TakiApplicationNamespace } from "./hindsight-application-primitives-schema.ts";

export const HINDSIGHT_APPLICATION_ENCODING = "taki-application-state/tagged-json-binary64-v1";
export const HINDSIGHT_APPLICATION_NATIVE_ENCODING = "taki-current-state/tagged-json-binary64-v1";
export type HindsightApplicationDigestDomain = "body" | "part" | "request" | "record" | "page" | "pages"
  | "snapshot" | "event" | "receipt" | "source-evidence" | "transition-source-evidence";
type TaggedFrame = { kind: "value"; value: JsonValue } | { kind: "text"; text: string };

export function hindsightApplicationDigestJson(input: {
  domain: HindsightApplicationDigestDomain; namespace: TakiApplicationNamespace; bankId: string; value: unknown;
}): string {
  return hindsightApplicationTaggedJson({ domain: `application-state-${input.domain}.v1`,
    namespace: TakiApplicationNamespaceSchema.parse(input.namespace), bank_id: TakiApplicationIdSchema.parse(input.bankId), value: input.value });
}

export function hindsightApplicationTaggedJson(raw: unknown, encoding = HINDSIGHT_APPLICATION_ENCODING): string {
  const value = TakiApplicationJsonValueSchema.parse(raw);
  if (encoding === HINDSIGHT_APPLICATION_NATIVE_ENCODING) assertNativeUnicode(value);
  const chunks = [`[${JSON.stringify(encoding)},`];
  const stack: TaggedFrame[] = [{ kind: "text", text: "]" }, { kind: "value", value }];
  while (stack.length) {
    const item = stack.pop(); if (!item) throw new Error("HINDSIGHT_APPLICATION_JSON_INVALID");
    if (item.kind === "text") { chunks.push(item.text); continue; }
    const current = item.value;
    if (current === null) chunks.push('["null"]');
    else if (typeof current === "boolean") chunks.push(`["boolean",${current}]`);
    else if (typeof current === "string") chunks.push(`["string",${JSON.stringify(current)}]`);
    else if (typeof current === "number") chunks.push(`["number","${binary64(current)}"]`);
    else if (Array.isArray(current)) pushArray(stack, chunks, current);
    else pushObject(stack, chunks, current);
  }
  return chunks.join("");
}

function pushArray(stack: TaggedFrame[], chunks: string[], value: JsonValue[]): void {
  chunks.push('["array",['); stack.push({ kind: "text", text: "]]" });
  for (let index = value.length - 1; index >= 0; index--) {
    stack.push({ kind: "value", value: value[index] ?? null });
    if (index) stack.push({ kind: "text", text: "," });
  }
}

function pushObject(stack: TaggedFrame[], chunks: string[], value: Record<string, JsonValue>): void {
  const keys = Object.keys(value).sort(compareUtf8);
  chunks.push('["object",['); stack.push({ kind: "text", text: "]]" });
  for (let index = keys.length - 1; index >= 0; index--) {
    const key = keys[index]; if (key === undefined) throw new Error("HINDSIGHT_APPLICATION_JSON_INVALID");
    stack.push({ kind: "text", text: "]" }, { kind: "value", value: value[key] ?? null },
      { kind: "text", text: `[${JSON.stringify(key)},` });
    if (index) stack.push({ kind: "text", text: "," });
  }
}

function binary64(value: number): string {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value === 0 ? 0 : value, false);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function compareUtf8(left: string, right: string): number {
  // Code-point order equals unsigned UTF-8/WTF-8 order. Iterators merge valid
  // surrogate pairs while preserving lone code units in original JSON keys.
  const a = left[Symbol.iterator](); const b = right[Symbol.iterator]();
  while (true) {
    const x = a.next(); const y = b.next();
    if (x.done || y.done) return x.done ? (y.done ? 0 : -1) : 1;
    const difference = (x.value.codePointAt(0) ?? 0) - (y.value.codePointAt(0) ?? 0);
    if (difference) return difference;
  }
}

function assertNativeUnicode(value: JsonValue): void {
  const stack: JsonValue[] = [value];
  while (stack.length) {
    const current = stack.pop();
    if (typeof current === "string") {
      for (const character of current) {
        const point = character.codePointAt(0) ?? 0;
        if (point >= 0xd800 && point <= 0xdfff) throw new Error("HINDSIGHT_CURRENT_VALUE_UNSUPPORTED");
      }
    } else if (current !== null && typeof current === "object") {
      if (Array.isArray(current)) { for (const item of current) stack.push(item); }
      else { for (const [key, item] of Object.entries(current)) stack.push(key, item); }
    }
  }
}

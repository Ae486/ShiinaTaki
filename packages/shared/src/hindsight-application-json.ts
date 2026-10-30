/**
 * INPUT:  full D77 JSON bodies, including deeply nested provider metadata and encoded evidence
 * OUTPUT: lossless JSON validation and iterative wire serialization without an inherited depth quota
 * POS:    shared application-state codec — Canonical field quotas and HTTP byte limits belong to their own boundaries
 */
import { z } from "zod";
import type { JsonValue } from "./memory-provider-domain-schema.ts";

export const TakiApplicationJsonValueSchema = z.custom<JsonValue>(isApplicationJson, "invalid application JSON value");
export const TakiApplicationJsonObjectSchema = z.custom<Record<string, JsonValue>>(
  (value) => isApplicationObject(value) && isApplicationJson(value), "invalid application JSON object",
);

export function isApplicationObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isApplicationJson(value: unknown): value is JsonValue {
  const stack: Array<{ value: unknown; exit?: boolean }> = [{ value }];
  const ancestors = new Set<object>();
  while (stack.length) {
    const item = stack.pop(); if (!item) return false;
    const current = item.value;
    if (item.exit && current !== null && typeof current === "object") { ancestors.delete(current); continue; }
    if (current === null || typeof current === "boolean") continue;
    if (typeof current === "string") continue;
    if (typeof current === "number") { if (!Number.isFinite(current)) return false; continue; }
    if (typeof current !== "object" || (!Array.isArray(current) && !isApplicationObject(current)) || ancestors.has(current)) return false;
    const keys = Object.keys(current);
    if (Object.getOwnPropertySymbols(current).length) return false;
    if (Object.getOwnPropertyNames(current).length !== keys.length + (Array.isArray(current) ? 1 : 0)) return false;
    if (Array.isArray(current) && (keys.length !== current.length || keys.some((key, index) => key !== String(index)))) return false;
    ancestors.add(current); stack.push({ value: current, exit: true });
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor)) return false;
      stack.push({ value: descriptor.value });
    }
  }
  return true;
}

type JsonFrame = { kind: "value"; value: JsonValue } | { kind: "text"; text: string };

/** Ordinary JSON bytes are transport evidence; only the separate tagged encoder defines semantic identity. */
export function hindsightApplicationWireJson(raw: unknown): string {
  const value = TakiApplicationJsonValueSchema.parse(raw);
  const stack: JsonFrame[] = [{ kind: "value", value }]; const chunks: string[] = [];
  while (stack.length) {
    const item = stack.pop(); if (!item) throw new Error("HINDSIGHT_APPLICATION_JSON_INVALID");
    if (item.kind === "text") { chunks.push(item.text); continue; }
    const current = item.value;
    if (current === null || typeof current !== "object") { chunks.push(JSON.stringify(current)); continue; }
    if (Array.isArray(current)) {
      chunks.push("["); stack.push({ kind: "text", text: "]" });
      for (let index = current.length - 1; index >= 0; index--) {
        stack.push({ kind: "value", value: current[index] ?? null });
        if (index) stack.push({ kind: "text", text: "," });
      }
    } else pushObject(stack, chunks, current);
  }
  return chunks.join("");
}

function pushObject(stack: JsonFrame[], chunks: string[], value: Record<string, JsonValue>): void {
  chunks.push("{"); stack.push({ kind: "text", text: "}" });
  const keys = Object.keys(value);
  for (let index = keys.length - 1; index >= 0; index--) {
    const key = keys[index]; if (key === undefined) throw new Error("HINDSIGHT_APPLICATION_JSON_INVALID");
    stack.push({ kind: "value", value: value[key] ?? null });
    stack.push({ kind: "text", text: `${JSON.stringify(key)}:` });
    if (index) stack.push({ kind: "text", text: "," });
  }
}

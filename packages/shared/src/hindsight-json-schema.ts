/**
 * INPUT:  JSON-domain values with own keys, including __proto__ and constructor
 * OUTPUT: bounded validating schemas that preserve every JSON key without assigning to object prototypes
 * POS:    shared Hindsight data boundary — new D78/snapshot fields; legacy frozen codecs are unchanged
 */
import { z } from "zod";
import type { JsonValue } from "./memory-provider-domain-schema.ts";

export function createHindsightJsonSchemas(maxStringLength: number) {
  return {
    value: z.custom<JsonValue>((value) => validJson(value, maxStringLength), "invalid bounded JSON value"),
    object: z.custom<Record<string, JsonValue>>((value) => jsonObject(value) && validJson(value, maxStringLength), "invalid bounded JSON object"),
  };
}

function validJson(value: unknown, maxStringLength: number): boolean {
  const stack: Array<{ value: unknown; exit?: boolean }> = [{ value }]; const ancestors = new Set<object>();
  while (stack.length) {
    const frame = stack.pop(); if (!frame) return false;
    const current = frame.value;
    if (frame.exit && current !== null && typeof current === "object") { ancestors.delete(current); continue; }
    if (current === null || typeof current === "boolean") continue;
    if (typeof current === "string") { if (current.length > maxStringLength) return false; continue; }
    if (typeof current === "number") { if (!Number.isFinite(current)) return false; continue; }
    if (typeof current !== "object" || !Array.isArray(current) && !jsonObject(current) || ancestors.has(current)) return false;
    const keys = Object.keys(current);
    if (keys.length > 256 || Object.getOwnPropertySymbols(current).length) return false;
    if (Object.getOwnPropertyNames(current).length !== keys.length + (Array.isArray(current) ? 1 : 0)) return false;
    if (Array.isArray(current)) {
      if (current.length > 256 || keys.length !== current.length || keys.some((key, index) => key !== String(index))) return false;
    } else if (keys.some((key) => key.length < 1 || key.length > 128)) return false;
    ancestors.add(current); stack.push({ value: current, exit: true });
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor)) return false;
      stack.push({ value: descriptor.value });
    }
  }
  return true;
}

function jsonObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

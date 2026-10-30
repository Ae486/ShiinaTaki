/**
 * INPUT:  decoded UTF-8 D77 body text
 * OUTPUT: strict JSON values with duplicate-key refusal and no container-recursion limit
 * POS:    shared application-state decoding — strings remain strings and prototype-shaped keys remain inert data
 */
import type { JsonValue } from "./memory-provider-domain-schema.ts";

type JsonContainer = JsonValue[] | Record<string, JsonValue>;
type ParseState = "object-first" | "object-key" | "colon" | "object-value" | "object-next"
  | "array-first" | "array-value" | "array-next";
interface Frame { value: JsonContainer; state: ParseState; key?: string }
interface Reader { text: string; index: number; frames: Frame[]; root: JsonValue; hasRoot: boolean }
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

export function parseHindsightApplicationJson(text: string): JsonValue {
  const reader: Reader = { text, index: 0, frames: [], root: null, hasRoot: false };
  while (true) {
    skipWhitespace(reader);
    if (reader.index >= text.length) {
      if (reader.frames.length || !reader.hasRoot) invalid();
      return reader.root;
    }
    if (reader.hasRoot && reader.frames.length === 0) invalid();
    const frame = reader.frames.at(-1);
    if (frame && consumeSyntax(reader, frame)) continue;
    const token = text[reader.index];
    let value: JsonValue; let next: Frame | undefined;
    if (token === "{") { value = {}; next = { value, state: "object-first" }; reader.index++; }
    else if (token === "[") { value = []; next = { value, state: "array-first" }; reader.index++; }
    else if (token === '"') value = readString(reader);
    else value = readPrimitive(reader);
    appendValue(reader, frame, value);
    if (next) reader.frames.push(next);
  }
}

function consumeSyntax(reader: Reader, frame: Frame): boolean {
  const token = reader.text[reader.index];
  if (frame.state === "object-first" || frame.state === "object-key") {
    if (token === "}" && frame.state === "object-first") { reader.frames.pop(); reader.index++; return true; }
    if (token !== '"') invalid();
    const key = readString(reader);
    if (Object.hasOwn(frame.value, key)) invalid();
    frame.key = key; frame.state = "colon"; return true;
  }
  if (frame.state === "colon") {
    if (token !== ":") invalid();
    frame.state = "object-value"; reader.index++; return true;
  }
  if (frame.state === "object-next" || frame.state === "array-next") {
    const closing = frame.state === "object-next" ? "}" : "]";
    if (token === closing) reader.frames.pop();
    else if (token === ",") frame.state = closing === "}" ? "object-key" : "array-value";
    else invalid();
    reader.index++; return true;
  }
  if (frame.state === "array-first" && token === "]") { reader.frames.pop(); reader.index++; return true; }
  return false;
}

function appendValue(reader: Reader, frame: Frame | undefined, value: JsonValue): void {
  if (!frame) { reader.root = value; reader.hasRoot = true; return; }
  if (Array.isArray(frame.value)) {
    frame.value.push(value); frame.state = "array-next"; return;
  }
  if (frame.key === undefined) invalid();
  Object.defineProperty(frame.value, frame.key, { value, enumerable: true, configurable: true, writable: true });
  frame.key = undefined; frame.state = "object-next";
}

function readString(reader: Reader): string {
  const start = reader.index++;
  while (reader.index < reader.text.length) {
    const token = reader.text[reader.index++];
    if (token === "\\") { reader.index++; continue; }
    if (token === '"') {
      const value: unknown = JSON.parse(reader.text.slice(start, reader.index));
      if (typeof value !== "string") invalid();
      return value;
    }
  }
  return invalid();
}

function readPrimitive(reader: Reader): null | boolean | number {
  for (const [token, value] of [["null", null], ["true", true], ["false", false]] as const) {
    if (reader.text.startsWith(token, reader.index)) { reader.index += token.length; return value; }
  }
  NUMBER.lastIndex = reader.index;
  const match = NUMBER.exec(reader.text);
  if (!match) invalid();
  const value = Number(match[0]);
  if (!Number.isFinite(value)) invalid();
  reader.index = NUMBER.lastIndex;
  return value === 0 ? 0 : value;
}

function skipWhitespace(reader: Reader): void {
  while (reader.index < reader.text.length && " \t\r\n".includes(reader.text[reader.index] ?? "\0")) reader.index++;
}
function invalid(): never { throw new Error("HINDSIGHT_APPLICATION_JSON_INVALID"); }

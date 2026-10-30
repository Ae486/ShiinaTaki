import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TakiApplicationJsonValueSchema, hindsightApplicationWireJson } from "./hindsight-application-json.ts";
import { parseHindsightApplicationJson } from "./hindsight-application-json-reader.ts";
import { hindsightApplicationDigestJson, hindsightApplicationTaggedJson, HINDSIGHT_APPLICATION_NATIVE_ENCODING } from "./hindsight-application-encoding.ts";
import { TakiApplicationBodyRefSchema, TakiApplicationNativeVersionSchema } from "./hindsight-application-primitives-schema.ts";
import { hindsightCurrentStateJson } from "./hindsight-current-state-encoding.ts";

const namespace = { provider_lineage: "11111111-1111-4111-8111-111111111111",
  bank_generation: "22222222-2222-4222-8222-222222222222", application_id: "taki" as const };
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

describe("D77 tagged encoding and lossless JSON boundary", () => {
  it("matches the actual Python application_state.codec golden across binary64, NUL and surrogate evidence", () => {
    const value = JSON.parse('{"__proto__":{"constructor":[null,"",false,1.5,-0.0]},"\\u0000":"\\ud800","😀":"typed","\\ue000":1000}');
    const tagged = hindsightApplicationTaggedJson(value);
    const scoped = hindsightApplicationDigestJson({ domain: "body", namespace, bankId: "bank-a", value });
    // Produced by the real native codec, not by the TypeScript implementation under test.
    expect(new TextEncoder().encode(tagged).byteLength).toBe(316);
    expect(new TextEncoder().encode(scoped).byteLength).toBe(626);
    expect(sha(scoped)).toBe("7739784abd893848e96eba550d083fc36df14cd465953b6da58d7bb2ff496ca5");
    expect(tagged).toContain('"3ff8000000000000"');
    expect(tagged).toContain('"408f400000000000"');
    expect(tagged).toContain('"\\ud800"');
  });

  it("orders lone-surrogate keys by WTF-8 while preserving ordinary Unicode ordering", () => {
    const value = Object.fromEntries(["😀", "\ufffd", "\ue000", "\udc00", "\ud800", "\ud7ff"].map((key) => [key, key]));
    const parsed = JSON.parse(hindsightApplicationTaggedJson(value));
    expect(parsed[1][1].map((entry: [string, unknown]) => entry[0])).toEqual(["\ud7ff", "\ud800", "\udc00", "\ue000", "\ufffd", "😀"]);
  });

  it("keeps the native witness equal to frozen D78 for its supported domain", () => {
    const value = { metadata: { "😀": [1e-300, Number.MAX_VALUE, -0, "literal {\"x\":1}"] }, text: "零\0空", empty: {} };
    expect(hindsightApplicationTaggedJson(value, HINDSIGHT_APPLICATION_NATIVE_ENCODING)).toBe(hindsightCurrentStateJson(value));
    expect(() => hindsightApplicationTaggedJson({ "\ud800": "kept by APP only" }, HINDSIGHT_APPLICATION_NATIVE_ENCODING)).toThrow();
    expect(() => hindsightApplicationTaggedJson(["\udc00"], HINDSIGHT_APPLICATION_NATIVE_ENCODING)).toThrow();
  });

  it("binds semantic hashes to namespace, Bank and domain without conflating null, absent and strings", () => {
    const digest = (value: unknown, bankId = "bank-a") => sha(hindsightApplicationDigestJson({ domain: "body", namespace, bankId, value }));
    expect(new Set([digest({}), digest({ x: null }), digest({ x: "null" }), digest({ x: "" }), digest({ x: [] })]).size).toBe(5);
    expect(digest({ x: 1 })).not.toBe(digest({ x: 1 }, "bank-b"));
    expect(digest({ x: 1 })).not.toBe(sha(hindsightApplicationDigestJson({ domain: "record", namespace, bankId: "bank-a", value: { x: 1 } })));
    expect(digest({ x: 1 })).not.toBe(sha(hindsightApplicationDigestJson({ domain: "body", namespace: { ...namespace,
      bank_generation: "33333333-3333-4333-8333-333333333333" }, bankId: "bank-a", value: { x: 1 } })));
  });

  it("round-trips a depth beyond JSON1 and recursive encoders without altering opaque strings", () => {
    let value: unknown = { literal: '{"__proto__":null}', "\ud800": "\udc00", nul: "\0" };
    for (let depth = 0; depth < 4000; depth++) value = { next: value };
    expect(TakiApplicationJsonValueSchema.safeParse(value).success).toBe(true);
    const wire = hindsightApplicationWireJson(value);
    const read = parseHindsightApplicationJson(wire);
    expect(sha(hindsightApplicationTaggedJson(read))).toBe(sha(hindsightApplicationTaggedJson(value)));
    let leaf = read;
    for (let depth = 0; depth < 4000; depth++) leaf = (leaf as Record<string, typeof read>).next!;
    expect(leaf).toEqual({ literal: '{"__proto__":null}', "\ud800": "\udc00", nul: "\0" });
  });

  it("preserves special own keys and shared subtrees without executing accessors", () => {
    const data = parseHindsightApplicationJson('{"__proto__":{"polluted":true},"constructor":{"prototype":null}}');
    expect(Object.hasOwn(data as object, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(parseHindsightApplicationJson(hindsightApplicationWireJson(data))).toEqual(data);
    const shared = { a: 1 }; expect(TakiApplicationJsonValueSchema.safeParse([shared, shared]).success).toBe(true);
    let called = false; const accessor = Object.defineProperty({}, "x", { enumerable: true, get() { called = true; return 1; } });
    expect(TakiApplicationJsonValueSchema.safeParse(accessor).success).toBe(false);
    expect(called).toBe(false);
  });

  it.each(["", "{}{}", "[1,]", '{"x":1,}', '{"x":1,"x":2}', '{"__proto__":0,"__proto__":1}',
    '{"nested":{"a":1,"a":2}}', '{"\\u0061":1,"a":2}', "[true false]", "01", "1e400", "NaN", "\ufeff{}",
    '"bad\nstring"', '{/*no*/"x":1}'])("rejects invalid or ambiguous JSON: %s", (wire) => {
    expect(() => parseHindsightApplicationJson(wire)).toThrow();
  });

  it.each([undefined, NaN, Infinity, [undefined], { value: undefined }, new Date(), new Uint8Array(1), Array(2)])(
    "rejects non-JSON values before serialization", (value) => {
      expect(TakiApplicationJsonValueSchema.safeParse(value).success).toBe(false);
      expect(() => hindsightApplicationWireJson(value)).toThrow();
    });

  it("refuses cycles while allowing null-prototype JSON", () => {
    const cycle: { next?: unknown } = {}; cycle.next = cycle;
    expect(TakiApplicationJsonValueSchema.safeParse(cycle).success).toBe(false);
    const clean = Object.assign(Object.create(null), { a: null });
    expect(hindsightApplicationWireJson(clean)).toBe('{"a":null}');
  });

  it("keeps count/version safety and complete multipart descriptors at the wire boundary", () => {
    const ref = { body_id: "33333333-3333-4333-8333-333333333333", body_schema: "application-block.v1",
      payload_hash: "a".repeat(64), bytes_sha256: "b".repeat(64), total_bytes: 262145, part_bytes: 262144, total_parts: 2 };
    expect(TakiApplicationBodyRefSchema.safeParse(ref).success).toBe(true);
    expect(TakiApplicationBodyRefSchema.safeParse({ ...ref, total_parts: 1 }).success).toBe(false);
    expect(TakiApplicationBodyRefSchema.safeParse({ ...ref, total_bytes: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
    expect(TakiApplicationNativeVersionSchema.safeParse({ object_kind: "memory_unit", object_id: "unit", object_revision: true,
      payload_hash: "a".repeat(64), native_cursor: null }).success).toBe(false);
  });
});

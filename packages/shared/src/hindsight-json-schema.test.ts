import { describe, expect, it } from "vitest";
import { createHindsightJsonSchemas } from "./hindsight-json-schema.ts";
import { hindsightCurrentStateJson } from "./hindsight-current-state-encoding.ts";

const schema = createHindsightJsonSchemas(16_384);

describe("Hindsight own-key JSON validation", () => {
  it("preserves legal prototype-shaped keys as inert data at every depth", () => {
    const value: unknown = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"nested":"data"}},"array":[{"__proto__":1,"constructor":"ordinary"}]}');
    const parsed = schema.object.parse(value);
    expect(parsed).toEqual(value); expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    expect(hindsightCurrentStateJson(parsed)).toBe(hindsightCurrentStateJson(value));
  });

  it("retains Canonical JSON bounds and rejects cycles, accessors and non-JSON prototypes", () => {
    const cycle: Record<string, unknown> = {}; cycle.child = cycle;
    const accessor = Object.defineProperty({}, "key", { enumerable: true, get() { throw new Error("getter must not execute"); } });
    for (const value of [cycle, accessor, new Date(), Object.create({ inherited: 1 }),
      { text: "x".repeat(16_385) }, Array(1), Array(257).fill(null), { ["x".repeat(129)]: 1 },
      Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`key${index}`, index])), { value: undefined }, { value: NaN }]) {
      expect(schema.value.safeParse(value).success).toBe(false);
    }
    const alias = { nested: true };
    expect(schema.object.parse({ left: alias, right: alias })).toEqual({ left: alias, right: alias });
  });
});

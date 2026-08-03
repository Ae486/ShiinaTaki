import { describe, expect, it } from "vitest";
import {
  CONFIG_METHODS,
  ConfigChangedSchema,
  ConfigEntrySchema,
  ConfigRefusalReasonSchema,
  ConfigSetParamsSchema,
  ConfigValueSchema,
} from "./config-schema.ts";

const entry = {
  key: "TAKI_MAX_STEPS",
  value: 10,
  stored: false,
  envLocked: false,
  default: 10,
  apply: "restart" as const,
  secret: false,
  secretSet: false,
  input: { kind: "int" as const, min: 1, max: 50 },
  description: "tool-loop step cap per turn",
};

describe("config-schema", () => {
  it("names the four config methods under the config. namespace", () => {
    expect(CONFIG_METHODS).toEqual({
      list: "config.list",
      set: "config.set",
      subscribe: "config.subscribe",
      changed: "config.changed",
    });
  });

  it("accepts the three JSON primitives as values and rejects composites", () => {
    for (const value of ["a", 1, true]) expect(ConfigValueSchema.parse(value)).toEqual(value);
    expect(ConfigValueSchema.safeParse({ a: 1 }).success).toBe(false);
    expect(ConfigValueSchema.safeParse([1]).success).toBe(false);
    expect(ConfigValueSchema.safeParse(null).success).toBe(false);
  });

  it("round-trips a knob entry and requires the provenance flags", () => {
    expect(ConfigEntrySchema.parse(entry)).toEqual(entry);
    const { stored, ...withoutStored } = entry;
    expect(stored).toBe(false);
    expect(ConfigEntrySchema.safeParse(withoutStored).success).toBe(false);
  });

  it("a secret entry carries presence only — value stays null", () => {
    const secret = { ...entry, key: "TAKI_PROVIDER_API_KEY", value: null, default: null, secret: true, secretSet: true };
    expect(ConfigEntrySchema.parse(secret).value).toBeNull();
  });

  it("set params allow null (reset) but never an empty key", () => {
    expect(ConfigSetParamsSchema.parse({ key: "TAKI_MAX_STEPS", value: null }).value).toBeNull();
    expect(ConfigSetParamsSchema.safeParse({ key: "", value: 1 }).success).toBe(false);
  });

  it("pins the five refusal reasons", () => {
    expect(ConfigRefusalReasonSchema.options).toEqual([
      "unknown-key",
      "invalid-value",
      "env-locked",
      "secret",
      "env-only",
    ]);
  });

  it("a changed push carries key + value only", () => {
    expect(ConfigChangedSchema.parse({ key: "TAKI_MAX_STEPS", value: 12, extra: "x" })).toEqual({
      key: "TAKI_MAX_STEPS",
      value: 12,
    });
  });
});

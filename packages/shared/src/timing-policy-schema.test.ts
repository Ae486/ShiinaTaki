import { describe, expect, it } from "vitest";
import {
  TIMING_CONFIG_KEYS,
  TIMING_POLICY_DEVELOPMENT_DEFAULTS,
  TimingPolicySchema,
  isTimingConfigKey,
  timingPolicyCandidate,
} from "./timing-policy-schema.ts";

describe("TimingPolicySchema", () => {
  it("defines the complete unique D59/D61 key family and approved development profile", () => {
    const keys = Object.values(TIMING_CONFIG_KEYS);
    expect(keys).toHaveLength(10);
    expect(new Set(keys).size).toBe(keys.length);
    expect(TIMING_POLICY_DEVELOPMENT_DEFAULTS).toEqual({
      reconnectBaseMs: 500,
      reconnectCapMs: 10_000,
      reconnectStabilityResetMs: 10_000,
      openAuthMs: 10_000,
      interactiveRpcMs: 15_000,
      longRpcMs: 120_000,
      chatAckMs: 15_000,
      petCostumeTotalMs: 40_000,
      rendererLoadMs: 30_000,
      homeResultMs: 45_000,
    });
  });

  it("projects config rows into the shared typed policy", () => {
    const entries = Object.entries(TIMING_CONFIG_KEYS).map(([field, key]) => ({
      key,
      value: TIMING_POLICY_DEVELOPMENT_DEFAULTS[field as keyof typeof TIMING_CONFIG_KEYS],
    }));
    expect(TimingPolicySchema.parse(timingPolicyCandidate(entries))).toEqual(TIMING_POLICY_DEVELOPMENT_DEFAULTS);
    expect(isTimingConfigKey(TIMING_CONFIG_KEYS.chatAckMs)).toBe(true);
    expect(isTimingConfigKey("TAKI_LOG_LEVEL")).toBe(false);
  });

  it.each([
    [{ reconnectBaseMs: 10_001 }, "reconnectBaseMs"],
    [{ rendererLoadMs: 40_000 }, "rendererLoadMs"],
    [{ petCostumeTotalMs: 45_000 }, "petCostumeTotalMs"],
    [{ interactiveRpcMs: 0 }, "interactiveRpcMs"],
  ] as const)("rejects an invalid or inconsistent policy %#", (override, path) => {
    const result = TimingPolicySchema.safeParse({ ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, ...override });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path.includes(path))).toBe(true);
  });

  it("rejects a config refresh with a missing timing row", () => {
    const candidate = timingPolicyCandidate([]);
    expect(TimingPolicySchema.safeParse(candidate).success).toBe(false);
  });
});

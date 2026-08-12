import { describe, expect, it } from "vitest";
import {
  TIMING_CONFIG_KEYS,
  TIMING_POLICY_DEVELOPMENT_DEFAULTS,
  type ConfigEntry,
  type TimingPolicy,
  type TimingPolicyField,
} from "@taki/shared";
import { createTimingPolicyStore } from "./timing-policy.ts";

const FIELDS: TimingPolicyField[] = [
  "reconnectBaseMs",
  "reconnectCapMs",
  "reconnectStabilityResetMs",
  "openAuthMs",
  "interactiveRpcMs",
  "longRpcMs",
  "chatAckMs",
  "petCostumeTotalMs",
  "rendererLoadMs",
  "homeResultMs",
];

function entries(policy: TimingPolicy): ConfigEntry[] {
  return FIELDS.map((field) => ({
    key: TIMING_CONFIG_KEYS[field],
    value: policy[field],
    stored: false,
    envLocked: false,
    default: policy[field],
    apply: "live",
    secret: false,
    secretSet: false,
    input: { kind: "int", min: 1 },
    description: field,
  }));
}

describe("createTimingPolicyStore", () => {
  it("boots from the typed development fallback and atomically applies a valid Core refresh", () => {
    const store = createTimingPolicyStore();
    expect(store.current()).toEqual(TIMING_POLICY_DEVELOPMENT_DEFAULTS);
    const next = { ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, interactiveRpcMs: 17_000 };
    expect(store.apply(entries(next))).toEqual({ ok: true, policy: next });
    expect(store.current()).toEqual(next);
  });

  it("keeps last-good values when a refresh is missing a row or violates relationships", () => {
    const lastGood = { ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, interactiveRpcMs: 17_000 };
    const store = createTimingPolicyStore(lastGood);
    const missing = entries(TIMING_POLICY_DEVELOPMENT_DEFAULTS).slice(1);
    const missingResult = store.apply(missing);
    expect(missingResult).toMatchObject({ ok: false });
    expect(store.current()).toEqual(lastGood);

    const invalid = entries({ ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, homeResultMs: 35_000 });
    const invalidResult = store.apply(invalid);
    expect(invalidResult).toMatchObject({ ok: false });
    if (!invalidResult.ok) expect(invalidResult.diagnostic).toContain("petCostumeTotalMs");
    expect(store.current()).toEqual(lastGood);
  });
});

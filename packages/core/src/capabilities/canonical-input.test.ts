import { describe, expect, it } from "vitest";
import { canonicalCapabilityInput, capabilityInputDigest } from "./canonical-input.ts";

describe("canonical capability input", () => {
  it("sorts object keys while preserving array order", () => {
    expect(canonicalCapabilityInput("x", { b: 2, a: [3, 1] })).toBe('{"capabilityId":"x","input":{"a":[3,1],"b":2}}');
  });

  it("produces a lowercase SHA-256 digest bound to capability identity", () => {
    const digest = capabilityInputDigest("screenshot", {});
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toBe(capabilityInputDigest("exec", {}));
  });
});

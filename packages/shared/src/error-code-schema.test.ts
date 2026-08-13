import { describe, expect, it } from "vitest";
import { ErrorCodeSchema } from "./error-code-schema.ts";

describe("ErrorCodeSchema", () => {
  it.each([
    "PROVIDER_ERROR",
    "INTERNAL_ERROR",
    "PAIRING_REQUIRED",
    "AUTH_FAILED",
    "NOT_AUTHENTICATED",
    "ALREADY_CONNECTED",
    "FORBIDDEN",
    "CONFIG_REFUSED",
    "POLICY_CONFLICT",
    "GOVERNANCE_REFUSED",
    "GOVERNANCE_DENIED",
    "APPROVAL_REQUIRED",
  ])("accepts the %s code", (code) => {
    expect(ErrorCodeSchema.safeParse(code).success).toBe(true);
  });

  it("rejects an unknown code", () => {
    expect(ErrorCodeSchema.safeParse("NOPE").success).toBe(false);
  });
});

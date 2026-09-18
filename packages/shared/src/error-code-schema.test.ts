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
    "MCP_REFUSED",
    "MCP_CONFIG_CONFLICT",
    "SECRET_REFUSED",
    "SKILL_REFUSED",
    "SKILL_CONFIG_CONFLICT",
    "SCHEDULE_REFUSED",
    "SCHEDULE_CONFLICT",
    "HINDSIGHT_REFUSED",
    "MEMORY_OPERATION_REFUSED",
    "GOVERNANCE_DENIED",
    "APPROVAL_REQUIRED",
  ])("accepts the %s code", (code) => {
    expect(ErrorCodeSchema.safeParse(code).success).toBe(true);
  });

  it("rejects an unknown code", () => {
    expect(ErrorCodeSchema.safeParse("NOPE").success).toBe(false);
  });
});

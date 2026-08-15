import { describe, expect, it } from "vitest";
import {
  CAPABILITY_METHODS,
  CapabilityErrorCodeSchema,
  CapabilityRequestSchema,
  CapabilityRespondParamsSchema,
  CapabilityRespondResultSchema,
} from "./capability-schema.ts";

const UUID = "11111111-1111-4111-8111-111111111111";
const CONTROL = {
  runId: "22222222-2222-4222-8222-222222222222",
  operationId: "33333333-3333-4333-8333-333333333333",
  attemptId: "44444444-4444-4444-8444-444444444444",
  targetHostId: UUID,
  connectionGeneration: 1,
  catalogGeneration: 1,
  policyGeneration: 1,
  governanceProjection: { registryRevision: 1, descriptorRevision: 1, classifierRevision: 1, cells: [{ key: "screenshot", posture: "auto" as const }], digest: "a".repeat(64) },
  approvalGeneration: 1,
  capabilityId: "screenshot",
  inputDigest: "a".repeat(64),
  idempotencyKey: "55555555-5555-4555-8555-555555555555",
  dispatchedAt: "2026-08-12T00:00:00.000Z",
  deadlineAt: "2026-08-12T00:01:00.000Z",
};

describe("capability schema", () => {
  it("names the request/cancel/respond methods", () => {
    expect(CAPABILITY_METHODS.request).toBe("capability.request");
    expect(CAPABILITY_METHODS.cancel).toBe("capability.cancel");
    expect(CAPABILITY_METHODS.respond).toBe("capability.respond");
  });

  it("requires the sealed control tuple on requests", () => {
    expect(CapabilityRequestSchema.safeParse({ requestId: UUID, control: CONTROL, input: {} }).success).toBe(true);
    expect(CapabilityRequestSchema.safeParse({ requestId: UUID, capability: "screenshot", input: {} }).success).toBe(false);
  });

  it("parses completed and failed terminal arms", () => {
    expect(
      CapabilityRespondParamsSchema.safeParse({ requestId: UUID, control: CONTROL, state: "completed", output: {}, governance: { descriptorRevision: 1, classifierRevision: 1, cellKey: "screenshot", effectivePosture: "auto", constraint: "none" } }).success,
    ).toBe(true);
    expect(
      CapabilityRespondParamsSchema.safeParse({
        requestId: UUID,
        control: CONTROL,
        state: "failed",
        error: { code: "DENIED", message: "user denied" },
        governance: { descriptorRevision: 1, classifierRevision: 1, cellKey: "screenshot", effectivePosture: "deny", constraint: "local" },
      }).success,
    ).toBe(true);
  });

  it("keeps the execution-error wire union closed", () => {
    expect(CapabilityErrorCodeSchema.options).toEqual(["DENIED", "APPROVAL_REQUIRED", "EXEC_FAILED", "UNSUPPORTED_CAPABILITY"]);
  });

  it("parses structured accepted and rejected acknowledgements", () => {
    expect(CapabilityRespondResultSchema.parse({ accepted: true })).toEqual({ accepted: true });
    expect(CapabilityRespondResultSchema.parse({ accepted: false, reason: "stale_generation" })).toEqual({
      accepted: false,
      reason: "stale_generation",
    });
  });
});

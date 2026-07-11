import { describe, expect, it } from "vitest";
import {
  CAPABILITY_METHODS,
  CapabilityErrorCodeSchema,
  CapabilityRequestSchema,
  CapabilityRespondParamsSchema,
  CapabilityRespondResultSchema,
} from "./capability-schema.ts";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("capability schema (T1)", () => {
  it("names the two channel methods", () => {
    expect(CAPABILITY_METHODS.request).toBe("capability.request");
    expect(CAPABILITY_METHODS.respond).toBe("capability.respond");
  });

  it("parses a screenshot request and rejects a missing requestId / non-uuid", () => {
    expect(CapabilityRequestSchema.safeParse({ requestId: UUID, capability: "screenshot", input: {} }).success).toBe(
      true,
    );
    expect(CapabilityRequestSchema.safeParse({ capability: "screenshot", input: {} }).success).toBe(false);
    expect(CapabilityRequestSchema.safeParse({ requestId: "nope", capability: "screenshot", input: {} }).success).toBe(
      false,
    );
  });

  it("rejects a request carrying an unknown key (strictObject parity with serde deny_unknown_fields)", () => {
    expect(
      CapabilityRequestSchema.safeParse({ requestId: UUID, capability: "screenshot", input: {}, extra: 1 }).success,
    ).toBe(false);
  });

  it("parses the success arm with an OPAQUE output payload (Option A) and requires the output key", () => {
    // The channel no longer validates the output shape (each capability owns its schema in capability-outputs.ts);
    // it accepts any payload but still requires the key present so an arm-less respond is rejected.
    expect(
      CapabilityRespondParamsSchema.safeParse({
        requestId: UUID,
        ok: true,
        output: { anything: "goes", n: 1 },
      }).success,
    ).toBe(true);
    expect(CapabilityRespondParamsSchema.safeParse({ requestId: UUID, ok: true }).success).toBe(false);
  });

  it("parses the failure arm over the closed error union and rejects an unknown code", () => {
    expect(
      CapabilityRespondParamsSchema.safeParse({
        requestId: UUID,
        ok: false,
        error: { code: "DENIED", message: "user denied" },
      }).success,
    ).toBe(true);
    expect(
      CapabilityRespondParamsSchema.safeParse({
        requestId: UUID,
        ok: false,
        error: { code: "NOPE", message: "x" },
      }).success,
    ).toBe(false);
  });

  it("rejects a respond that mixes arms (ok:true with an error)", () => {
    expect(
      CapabilityRespondParamsSchema.safeParse({ requestId: UUID, ok: true, error: { code: "DENIED", message: "x" } })
        .success,
    ).toBe(false);
  });

  it("closes the wire error union at exactly three codes", () => {
    expect(CapabilityErrorCodeSchema.options).toEqual(["DENIED", "EXEC_FAILED", "UNSUPPORTED_CAPABILITY"]);
  });

  it("parses the accepted result", () => {
    expect(CapabilityRespondResultSchema.parse({ accepted: true })).toEqual({ accepted: true });
  });
});

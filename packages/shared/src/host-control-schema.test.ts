import { describe, expect, it } from "vitest";
import {
  HOST_CONTROL_METHODS,
  CapabilityErrorCodeSchema,
  CapabilityCancelSchema,
  CapabilityRespondParamsSchema,
  HostCatalogPublishParamsSchema,
  HostOperationControlSchema,
  HostProtocolRangeSchema,
} from "./host-control-schema.ts";

const HOST_ID = "11111111-1111-4111-8111-111111111111";
const CONTROL = {
  runId: "22222222-2222-4222-8222-222222222222",
  operationId: "33333333-3333-4333-8333-333333333333",
  attemptId: "44444444-4444-4444-8444-444444444444",
  targetHostId: HOST_ID,
  connectionGeneration: 2,
  catalogGeneration: 3,
  policyGeneration: 1,
  governanceProjection: { registryRevision: 1, descriptorRevision: 1, classifierRevision: 1, cells: [{ key: "screenshot", posture: "auto" as const }], digest: "a".repeat(64) },
  approvalGeneration: 1,
  capabilityId: "screenshot",
  inputDigest: "a".repeat(64),
  idempotencyKey: "55555555-5555-4555-8555-555555555555",
  dispatchedAt: "2026-08-12T00:00:00.000Z",
  deadlineAt: "2026-08-12T00:01:00.000Z",
};

describe("Host-control schemas", () => {
  it("freezes all six method names", () => {
    expect(HOST_CONTROL_METHODS).toEqual({
      catalogPublish: "host.catalogPublish",
      request: "capability.request",
      challenge: "capability.challenge",
      resume: "capability.resume",
      cancel: "capability.cancel",
      respond: "capability.respond",
    });
  });

  it("distinguishes fail-closed ask from an outright Host denial", () => {
    expect(CapabilityErrorCodeSchema.options).toEqual([
      "DENIED",
      "APPROVAL_REQUIRED",
      "EXEC_FAILED",
      "UNSUPPORTED_CAPABILITY",
    ]);
  });

  it("accepts only ordered positive protocol ranges", () => {
    expect(HostProtocolRangeSchema.safeParse({ min: 1, max: 2 }).success).toBe(true);
    expect(HostProtocolRangeSchema.safeParse({ min: 2, max: 1 }).success).toBe(false);
    expect(HostProtocolRangeSchema.safeParse({ min: 0, max: 1 }).success).toBe(false);
  });

  it("validates a complete catalog without Core-owned connection facts", () => {
    const catalog = {
      hostId: HOST_ID,
      label: "Desktop",
      protocolVersion: 2,
      catalogSchemaVersion: 2,
      connectionGeneration: 2,
      catalogGeneration: 3,
      publishedAt: "2026-08-12T00:00:00.000Z",
      readiness: "ready",
      capabilities: [{ capabilityId: "screenshot", execution: "read", cancellation: "cooperative", governance: { descriptorRevision: 1, classifierId: "fixed-risk", classifierRevision: 1 } }],
      workspaces: [],
      skills: [],
      mcpServers: [],
    };
    expect(HostCatalogPublishParamsSchema.safeParse(catalog).success).toBe(true);
    expect(HostCatalogPublishParamsSchema.safeParse({ ...catalog, connected: true }).success).toBe(false);
  });

  it("rejects control tuples with a non-SHA256 digest", () => {
    expect(HostOperationControlSchema.safeParse(CONTROL).success).toBe(true);
    expect(HostOperationControlSchema.safeParse({ ...CONTROL, inputDigest: "nope" }).success).toBe(false);
  });

  it("binds cancel and every terminal response to the full control tuple", () => {
    expect(CapabilityCancelSchema.safeParse({ requestId: HOST_ID, control: CONTROL, reason: "deadline_exceeded" }).success).toBe(true);
    expect(
      CapabilityRespondParamsSchema.safeParse({ requestId: HOST_ID, control: CONTROL, state: "completed", output: {}, governance: { descriptorRevision: 1, classifierRevision: 1, cellKey: "screenshot", effectivePosture: "auto", constraint: "none" } })
        .success,
    ).toBe(true);
    expect(CapabilityRespondParamsSchema.safeParse({ requestId: HOST_ID, state: "cancelled" }).success).toBe(false);
  });

  it("requires a rejection reason and forbids one on accepted acknowledgements", async () => {
    const { HostFrameAckSchema } = await import("./host-control-schema.ts");
    expect(HostFrameAckSchema.safeParse({ accepted: true }).success).toBe(true);
    expect(HostFrameAckSchema.safeParse({ accepted: true, reason: "late" }).success).toBe(false);
    expect(HostFrameAckSchema.safeParse({ accepted: false }).success).toBe(false);
  });

  it("pins the canonical projection digest shared with Rust", async () => {
    const projection = { registryRevision: 1, descriptorRevision: 1, classifierRevision: 1, cells: [{ key: "screenshot", posture: "auto" }] };
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(JSON.stringify(projection)).digest("hex")).toBe("f30ef0476cc356181b289cb892004ef9e1250257b9a2fd60bddefddf9b171210");
  });
});

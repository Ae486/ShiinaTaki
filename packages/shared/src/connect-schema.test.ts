import { describe, expect, it } from "vitest";
import { CONNECT_METHOD, ConnectParamsSchema, ConnectResultSchema, RoleSchema } from "./connect-schema.ts";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("CONNECT_METHOD", () => {
  it("is the connect method name", () => {
    expect(CONNECT_METHOD).toBe("connect");
  });
});

describe("RoleSchema", () => {
  it.each(["operator", "node"])("accepts the %s role", (role) => {
    expect(RoleSchema.safeParse(role).success).toBe(true);
  });

  it("rejects an unknown role", () => {
    expect(RoleSchema.safeParse("admin").success).toBe(false);
  });
});

describe("ConnectParamsSchema", () => {
  const base = { deviceId: VALID_UUID, deviceName: "laptop", role: "operator" as const };

  it("accepts a minimal operator connect and defaults capabilities to []", () => {
    const parsed = ConnectParamsSchema.parse(base);
    expect(parsed.capabilities).toEqual([]);
    expect(parsed.token).toBeUndefined();
    expect(parsed.pairingCode).toBeUndefined();
  });

  it("rejects a non-uuid deviceId", () => {
    expect(ConnectParamsSchema.safeParse({ ...base, deviceId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects an empty deviceName", () => {
    expect(ConnectParamsSchema.safeParse({ ...base, deviceName: "" }).success).toBe(false);
  });

  it("rejects an operator declaring capabilities", () => {
    expect(ConnectParamsSchema.safeParse({ ...base, capabilities: ["screenshot"] }).success).toBe(false);
  });

  it("accepts a node declaring capabilities", () => {
    const parsed = ConnectParamsSchema.parse({
      ...base,
      role: "node",
      capabilities: ["screenshot"],
      host: { protocol: { min: 1, max: 1 }, catalogSchemaVersions: [1] },
    });
    expect(parsed.capabilities).toEqual(["screenshot"]);
  });

  it("requires Host negotiation from nodes and forbids it on operators", () => {
    expect(ConnectParamsSchema.safeParse({ ...base, role: "node", capabilities: ["screenshot"] }).success).toBe(false);
    expect(
      ConnectParamsSchema.safeParse({
        ...base,
        host: { protocol: { min: 1, max: 1 }, catalogSchemaVersions: [1] },
      }).success,
    ).toBe(false);
  });

  it("accepts an optional reconnect token", () => {
    expect(ConnectParamsSchema.safeParse({ ...base, token: "tok" }).success).toBe(true);
  });

  it("accepts an optional pairing code", () => {
    expect(ConnectParamsSchema.safeParse({ ...base, pairingCode: "123456" }).success).toBe(true);
  });
});

describe("ConnectResultSchema", () => {
  it("accepts ok without a token (reconnect)", () => {
    expect(ConnectResultSchema.safeParse({ status: "ok" }).success).toBe(true);
  });

  it("accepts ok carrying a token (pairing just completed)", () => {
    expect(ConnectResultSchema.safeParse({ status: "ok", token: "tok" }).success).toBe(true);
  });

  it("accepts the selected Host versions and Core-assigned generation", () => {
    expect(
      ConnectResultSchema.safeParse({
        status: "ok",
        host: { hostId: VALID_UUID, protocolVersion: 1, catalogSchemaVersion: 1, connectionGeneration: 1 },
      }).success,
    ).toBe(true);
  });

  it("rejects a non-ok status", () => {
    expect(ConnectResultSchema.safeParse({ status: "denied" }).success).toBe(false);
  });
});

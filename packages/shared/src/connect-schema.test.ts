import { describe, expect, it } from "vitest";
import {
  HOST_CATALOG_SCHEMA_VERSION,
  HOST_CONTROL_PROTOCOL_VERSION,
} from "./host-control-schema.ts";
import { CONNECT_METHOD, ConnectParamsSchema, ConnectResultSchema, RoleSchema, LocalAuthChallengeSchema, localAuthTranscript } from "./connect-schema.ts";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("native local connect contract", () => {
  const base = { deviceId: VALID_UUID, deviceName: "Home", role: "operator" as const };
  it("begin carries no reusable credentials and every proof has bounded canonical hex", () => {
    const begin = { kind: "begin", clientNonce: "01".repeat(32) };
    expect(ConnectParamsSchema.safeParse({ ...base, localAuth: begin }).success).toBe(true);
    for (const extra of [{ token: "old" }, { pairingCode: "123456" }]) {
      expect(ConnectParamsSchema.safeParse({ ...base, localAuth: begin, ...extra }).success).toBe(false);
    }
    const proof = { kind: "proof", nonce: "01".repeat(32), proof: "02".repeat(32) };
    expect(ConnectParamsSchema.safeParse({ ...base, localAuth: proof, token: "old" }).success).toBe(true);
    expect(ConnectParamsSchema.safeParse({ ...base, localAuth: { ...proof, proof: "FF".repeat(32) } }).success).toBe(false);
    expect(ConnectParamsSchema.safeParse({ ...base, localAuth: { ...proof, arbitraryAccount: "secret" } }).success).toBe(false);
  });
  it("defines distinct purpose domains over the exact endpoint, instance and identity tuple", () => {
    const value = LocalAuthChallengeSchema.parse({ version: 1, coreId: VALID_UUID, instanceId: VALID_UUID,
      endpoint: "ws://127.0.0.1:8974", nonce: "01".repeat(32), clientNonce: "02".repeat(32), deviceId: VALID_UUID,
      role: "operator", expiresAt: 30001, serverProof: "03".repeat(32) });
    expect(localAuthTranscript("server", value)).toBe(`taki-local-auth-v1:server\n${JSON.stringify([1, VALID_UUID, VALID_UUID,
      value.endpoint, value.nonce, value.clientNonce, VALID_UUID, "operator", 30001])}`);
    expect(localAuthTranscript("client", value)).not.toBe(localAuthTranscript("server", value));
    expect(LocalAuthChallengeSchema.safeParse({ ...value, key: "forbidden" }).success).toBe(false);
  });
});

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
      host: {
        protocol: { min: HOST_CONTROL_PROTOCOL_VERSION, max: HOST_CONTROL_PROTOCOL_VERSION },
        catalogSchemaVersions: [HOST_CATALOG_SCHEMA_VERSION],
      },
    });
    expect(parsed.capabilities).toEqual(["screenshot"]);
  });

  it("requires Host negotiation from nodes and forbids it on operators", () => {
    expect(ConnectParamsSchema.safeParse({ ...base, role: "node", capabilities: ["screenshot"] }).success).toBe(false);
    expect(
      ConnectParamsSchema.safeParse({
        ...base,
        host: {
          protocol: { min: HOST_CONTROL_PROTOCOL_VERSION, max: HOST_CONTROL_PROTOCOL_VERSION },
          catalogSchemaVersions: [HOST_CATALOG_SCHEMA_VERSION],
        },
      }).success,
    ).toBe(false);
  });

  it("accepts an optional reconnect token", () => {
    expect(ConnectParamsSchema.safeParse({ ...base, token: "tok" }).success).toBe(true);
  });

  it("accepts an optional pairing code", () => {
    expect(ConnectParamsSchema.safeParse({ ...base, pairingCode: "123456" }).success).toBe(true);
  });

  it("negotiates command display only for operators without adding execution capabilities", () => {
    expect(ConnectParamsSchema.parse({ ...base, approvalCommandDisclosureRevision: 1 }))
      .toMatchObject({ capabilities: [], approvalCommandDisclosureRevision: 1 });
    expect(ConnectParamsSchema.parse(base)).not.toHaveProperty("approvalCommandDisclosureRevision");
    expect(ConnectParamsSchema.safeParse({ ...base, approvalCommandDisclosureRevision: 2 }).success).toBe(false);
    expect(ConnectParamsSchema.safeParse({ ...base, role: "node", approvalCommandDisclosureRevision: 1,
      host: { protocol: { min: HOST_CONTROL_PROTOCOL_VERSION, max: HOST_CONTROL_PROTOCOL_VERSION }, catalogSchemaVersions: [HOST_CATALOG_SCHEMA_VERSION] },
    }).success).toBe(false);
    expect(ConnectResultSchema.parse({ status: "ok", approvalCommandDisclosureRevision: 1 }))
      .toEqual({ status: "ok", approvalCommandDisclosureRevision: 1 });
    expect(ConnectResultSchema.parse({ status: "ok" })).not.toHaveProperty("approvalCommandDisclosureRevision");
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
        host: {
          hostId: VALID_UUID,
          protocolVersion: HOST_CONTROL_PROTOCOL_VERSION,
          catalogSchemaVersion: HOST_CATALOG_SCHEMA_VERSION,
          connectionGeneration: 1,
        },
      }).success,
    ).toBe(true);
  });

  it("rejects a non-ok status", () => {
    expect(ConnectResultSchema.safeParse({ status: "denied" }).success).toBe(false);
  });
});

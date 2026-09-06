import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JSONRPCErrorException } from "json-rpc-2.0";
import {
  HOST_CATALOG_SCHEMA_VERSION,
  HOST_CONTROL_PROTOCOL_VERSION,
  ConnectResultSchema,
  type ConnectParams,
  type Role,
} from "@taki/shared";
import { createDeviceRegistry, type DeviceRegistry } from "../../devices/device-registry.ts";
import { createPairedDeviceStore } from "../../devices/paired-device-store.ts";
import { createConnectionRegistry, type Connection, type ConnectionRegistry } from "../connection-registry.ts";
import type { MethodContext, MethodDefinition } from "../method-registry.ts";
import { connectMethod, type AutoTrustInfo, type PairingCodeInfo } from "./connect.ts";

// Handler-level tests for the connect method's loopback auto-trust branch (P3). The full pairing/token
// handshake over a real socket is covered in ws-server.test.ts; here we drive handleConnect directly so
// the peer address and the config flag can be varied precisely.

const OPERATOR_ID = "550e8400-e29b-41d4-a716-446655440000";
const NODE_ID = "550e8400-e29b-41d4-a716-446655440001";

const dirs: string[] = [];
function storePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "taki-connect-"));
  dirs.push(dir);
  return join(dir, "devices.json");
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

interface Harness {
  deviceRegistry: DeviceRegistry;
  connectionRegistry: ConnectionRegistry;
  codes: PairingCodeInfo[];
  trusts: AutoTrustInfo[];
  def: MethodDefinition<ConnectParams>;
  path: string;
}

function boot(trustLoopbackOperator: boolean, path = storePath()): Harness {
  const deviceRegistry = createDeviceRegistry({ store: createPairedDeviceStore(path) });
  const connectionRegistry = createConnectionRegistry();
  const codes: PairingCodeInfo[] = [];
  const trusts: AutoTrustInfo[] = [];
  const def = connectMethod({
    deviceRegistry,
    connectionRegistry,
    trustLoopbackOperator,
    onPairingCode: (info) => codes.push(info),
    onAutoTrust: (info) => trusts.push(info),
  });
  return { deviceRegistry, connectionRegistry, codes, trusts, def, path };
}

interface ConnectInput {
  deviceId: string;
  role: Role;
  capabilities?: string[];
  token?: string;
  pairingCode?: string;
  host?: ConnectParams["host"];
  approvalCommandDisclosureRevision?: ConnectParams["approvalCommandDisclosureRevision"];
}

interface Attempt {
  result: unknown;
  error: unknown;
  connection: Connection;
  closed: boolean;
}

function callConnect(h: Harness, input: ConnectInput, remoteAddress: string | undefined): Attempt {
  const connection = h.connectionRegistry.create(undefined, remoteAddress);
  let closed = false;
  const ctx: MethodContext = { notify: () => {}, connection, close: () => (closed = true), onClose: () => {} };
  const params: ConnectParams = {
    deviceId: input.deviceId,
    deviceName: "test",
    role: input.role,
    capabilities: input.capabilities ?? [],
    token: input.token,
    pairingCode: input.pairingCode,
    approvalCommandDisclosureRevision: input.approvalCommandDisclosureRevision,
    host: input.host ?? (input.role === "node"
      ? {
          protocol: { min: HOST_CONTROL_PROTOCOL_VERSION, max: HOST_CONTROL_PROTOCOL_VERSION },
          catalogSchemaVersions: [HOST_CATALOG_SCHEMA_VERSION],
        }
      : undefined),
  };
  try {
    return { result: h.def.handler(params, ctx), error: undefined, connection, closed };
  } catch (error) {
    return { result: undefined, error, connection, closed };
  }
}

function appErrorCode(error: unknown): string {
  expect(error).toBeInstanceOf(JSONRPCErrorException);
  return ((error as JSONRPCErrorException).data as { code: string }).code;
}

describe("connect loopback auto-trust (P3)", () => {
  it("stores and echoes display support on loopback, token and pairing paths only when offered", () => {
    const h = boot(true);
    const identity = { deviceId: OPERATOR_ID, role: "operator" as const, approvalCommandDisclosureRevision: 1 as const };
    const local = callConnect(h, identity, "127.0.0.1");
    const token = ConnectResultSchema.parse(local.result).token;
    const resumed = callConnect(h, { ...identity, token }, "203.0.113.1");
    const remoteIdentity = { ...identity, deviceId: NODE_ID };
    callConnect(h, remoteIdentity, "203.0.113.1");
    const paired = callConnect(h, { ...remoteIdentity, pairingCode: h.codes[0]!.code }, "203.0.113.1");
    for (const attempt of [local, resumed, paired]) {
      expect(attempt.error).toBeUndefined();
      expect(attempt.result).toMatchObject({ status: "ok", approvalCommandDisclosureRevision: 1 });
      expect(attempt.connection.state).toMatchObject({ status: "authenticated", role: "operator", capabilities: [], approvalCommandDisclosureRevision: 1 });
    }
    const legacy = callConnect(h, { deviceId: OPERATOR_ID, role: "operator", token }, "203.0.113.1");
    expect(legacy.result).not.toHaveProperty("approvalCommandDisclosureRevision");
    expect(legacy.connection.state.status === "authenticated" && legacy.connection.state.approvalCommandDisclosureRevision).toBeUndefined();
  });
  it("auto-trusts a loopback operator with no credential when the flag is on", () => {
    const h = boot(true);
    const attempt = callConnect(h, { deviceId: OPERATOR_ID, role: "operator" }, "127.0.0.1");

    const result = ConnectResultSchema.parse(attempt.result);
    expect(result.status).toBe("ok");
    expect(result.token?.length ?? 0).toBeGreaterThan(0);
    expect(attempt.connection.state.status).toBe("authenticated");
    expect(attempt.closed).toBe(false);
    expect(h.codes).toHaveLength(0); // no pairing code is ever emitted on the auto-trust path
    // The auto-trust issuance is audited (with the peer address) — a token minted with no human in the loop leaves a trace.
    expect(h.trusts).toEqual([{ deviceId: OPERATOR_ID, deviceName: "test", remoteAddress: "127.0.0.1" }]);
  });

  it("accepts the IPv6 loopback forms ::1 and ::ffff:127.0.0.1", () => {
    for (const address of ["::1", "::ffff:127.0.0.1"]) {
      const h = boot(true);
      const attempt = callConnect(h, { deviceId: OPERATOR_ID, role: "operator" }, address);
      expect(ConnectResultSchema.parse(attempt.result).status).toBe("ok");
      expect(attempt.connection.state.status).toBe("authenticated");
    }
  });

  it("never auto-trusts a node (capabilities → Permission Gate → must pair) even on loopback", () => {
    const h = boot(true);
    const attempt = callConnect(h, { deviceId: NODE_ID, role: "node", capabilities: ["screenshot"] }, "127.0.0.1");

    expect(attempt.result).toBeUndefined();
    expect(appErrorCode(attempt.error)).toBe("PAIRING_REQUIRED");
    expect(attempt.connection.state.status).toBe("awaiting");
    expect(h.codes).toHaveLength(1); // fell through to the pairing path
    expect(h.trusts).toHaveLength(0); // a node is NEVER auto-trusted, so nothing is audited
  });

  it("does not auto-trust a non-loopback operator (falls through to pairing)", () => {
    const h = boot(true);
    const attempt = callConnect(h, { deviceId: OPERATOR_ID, role: "operator" }, "203.0.113.7");

    expect(appErrorCode(attempt.error)).toBe("PAIRING_REQUIRED");
    expect(attempt.connection.state.status).toBe("awaiting");
  });

  it("fail-closed: an unknown peer address is never auto-trusted", () => {
    const h = boot(true);
    const attempt = callConnect(h, { deviceId: OPERATOR_ID, role: "operator" }, undefined);

    expect(appErrorCode(attempt.error)).toBe("PAIRING_REQUIRED");
    expect(attempt.connection.state.status).toBe("awaiting");
  });

  it("with the flag off, even a loopback operator must pair (public/VPS Core)", () => {
    const h = boot(false);
    const attempt = callConnect(h, { deviceId: OPERATOR_ID, role: "operator" }, "127.0.0.1");

    expect(appErrorCode(attempt.error)).toBe("PAIRING_REQUIRED");
    expect(attempt.connection.state.status).toBe("awaiting");
    expect(h.codes).toHaveLength(1);
  });

  it("the auto-trust token still authenticates after the flag is turned off (reconnect survives)", () => {
    const first = boot(true);
    const issued = ConnectResultSchema.parse(
      callConnect(first, { deviceId: OPERATOR_ID, role: "operator" }, "127.0.0.1").result,
    );
    expect(issued.token?.length ?? 0).toBeGreaterThan(0);

    // A public Core (flag off) over the SAME device store: the normal token path authenticates, no pairing.
    const later = boot(false, first.path);
    const reconnect = callConnect(later, { deviceId: OPERATOR_ID, role: "operator", token: issued.token }, "127.0.0.1");
    expect(ConnectResultSchema.parse(reconnect.result)).toEqual({ status: "ok" }); // no token re-issued
    expect(reconnect.connection.state.status).toBe("authenticated");
  });
});

describe("connect existing credential paths (regression — unchanged by auto-trust)", () => {
  it("rejects unsupported Host negotiation before pairing can persist a credential", () => {
    const h = boot(false);
    callConnect(h, { deviceId: NODE_ID, role: "node" }, "127.0.0.1");
    const code = h.codes.at(-1)?.code ?? "";
    const attempt = callConnect(h, {
      deviceId: NODE_ID,
      role: "node",
      pairingCode: code,
      host: {
        protocol: { min: HOST_CONTROL_PROTOCOL_VERSION + 1, max: HOST_CONTROL_PROTOCOL_VERSION + 1 },
        catalogSchemaVersions: [HOST_CATALOG_SCHEMA_VERSION],
      },
    }, "127.0.0.1");

    expect(appErrorCode(attempt.error)).toBe("AUTH_FAILED");
    expect(attempt.connection.state.status).toBe("awaiting");
    expect(existsSync(h.path)).toBe(false);
  });

  it("a presented WRONG token fails closed with AUTH_FAILED — never auto-trusted despite loopback+flag", () => {
    const h = boot(true);
    const attempt = callConnect(h, { deviceId: OPERATOR_ID, role: "operator", token: "not-the-real-token" }, "127.0.0.1");

    expect(appErrorCode(attempt.error)).toBe("AUTH_FAILED");
    expect(attempt.connection.state.status).toBe("awaiting");
    expect(attempt.closed).toBe(true); // fail-closed: the socket is asked to close
  });

  it("a valid token authenticates without re-issuing a token", () => {
    const h = boot(false);
    const token = h.deviceRegistry.trustDevice(OPERATOR_ID, { deviceName: "test", role: "operator" });
    const attempt = callConnect(h, { deviceId: OPERATOR_ID, role: "operator", token }, "127.0.0.1");

    expect(ConnectResultSchema.parse(attempt.result)).toEqual({ status: "ok" });
    expect(attempt.connection.state.status).toBe("authenticated");
  });

  it("the pairing handshake still completes and authenticates (flag off)", () => {
    const h = boot(false);
    callConnect(h, { deviceId: OPERATOR_ID, role: "operator" }, "127.0.0.1"); // begin → PAIRING_REQUIRED
    const code = h.codes.at(-1)?.code ?? "";
    expect(code).toMatch(/^\d{6}$/);

    const attempt = callConnect(h, { deviceId: OPERATOR_ID, role: "operator", pairingCode: code }, "127.0.0.1");
    const result = ConnectResultSchema.parse(attempt.result);
    expect(result.status).toBe("ok");
    expect(result.token?.length ?? 0).toBeGreaterThan(0);
    expect(attempt.connection.state.status).toBe("authenticated");
  });
});

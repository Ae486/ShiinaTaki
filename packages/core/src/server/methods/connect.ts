/**
 * INPUT:  ConnectParams from a dispatched pre-auth connect request + injected registries, code/audit sinks, the loopback-trust flag
 * OUTPUT: connectMethod(deps) -> MethodDefinition; authenticates the socket (token / pairing / loopback auto-trust) or drives pairing (prd §3/§6, P3)
 * POS:    core/server/methods — the ONLY pre-auth method; thin delegation to device-registry + connection-registry
 */
import {
  CONNECT_METHOD,
  HOST_CATALOG_SCHEMA_VERSION,
  HOST_CONTROL_PROTOCOL_VERSION,
  ConnectParamsSchema,
  ErrorCodeSchema,
  RoleSchema,
  type ConnectParams,
  type ConnectResult,
  type Role,
} from "@taki/shared";
import { PairingError, type DeviceRegistry } from "../../devices/device-registry.ts";
import { appException } from "../app-error.ts";
import type { ConnectionRegistry } from "../connection-registry.ts";
import type { MethodContext, MethodDefinition } from "../method-registry.ts";

/** Emitted to the operator console (main wires it to pino.info) — the trust anchor for first pairing. */
export interface PairingCodeInfo {
  deviceId: string;
  deviceName: string;
  code: string;
}

/** Audit record for loopback auto-trust (P3) — a credential is minted with no human in the loop, so it must leave a trace. */
export interface AutoTrustInfo {
  deviceId: string;
  deviceName: string;
  remoteAddress: string;
}

export interface ConnectMethodDeps {
  deviceRegistry: DeviceRegistry;
  connectionRegistry: ConnectionRegistry;
  onPairingCode: (info: PairingCodeInfo) => void;
  /** Audit sink: fired on every auto-trust issuance (never receives the token itself). */
  onAutoTrust: (info: AutoTrustInfo) => void;
  /**
   * When true, a loopback OPERATOR presenting no credential is auto-trusted without pairing (P3): on a local
   * Core the machine boundary IS the trust boundary. A public/VPS Core sets this false to force pairing.
   */
  trustLoopbackOperator: boolean;
}

// Peer addresses that count as loopback. `::ffff:127.0.0.1` is the IPv4-mapped form seen when the server
// binds IPv6 but the client connects over IPv4; an unknown/absent address is never loopback (fail-closed).
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function isLoopback(address: string | undefined): address is string {
  return address !== undefined && LOOPBACK_ADDRESSES.has(address);
}

export function connectMethod(deps: ConnectMethodDeps): MethodDefinition<ConnectParams> {
  return {
    method: CONNECT_METHOD,
    // Any role may attempt the handshake; the role is established here, so it is not gated before it.
    roles: [RoleSchema.enum.operator, RoleSchema.enum.node],
    paramsSchema: ConnectParamsSchema,
    handler: (params, ctx) => handleConnect(deps, params, ctx),
  };
}

function handleConnect(deps: ConnectMethodDeps, params: ConnectParams, ctx: MethodContext): ConnectResult {
  const { deviceRegistry, connectionRegistry, onPairingCode, onAutoTrust, trustLoopbackOperator } = deps;
  const { deviceId, deviceName, role, capabilities, token, pairingCode } = params;

  if (ctx.connection.state.status === "authenticated") {
    // App-level refusal (not envelope INVALID_REQUEST): the frame is well-formed; re-handshake
    // is a protocol-state violation the Rust Shell will mirror via the same closed union.
    throw appException(ErrorCodeSchema.enum.ALREADY_CONNECTED, "already connected: re-handshake is not allowed");
  }

  // Host compatibility is validated before pairing can mint durable credentials. A protocol mismatch is not
  // allowed to leave a newly trusted device record behind and then fail later during connection registration.
  const identity = authenticatedIdentity(params);

  if (token !== undefined) {
    if (!deviceRegistry.verifyToken(deviceId, token, role)) {
      ctx.close(); // fail-closed: a wrong token or role mismatch is not a retryable state
      throw appException(ErrorCodeSchema.enum.AUTH_FAILED, "authentication failed");
    }
    return connectedResult(params, connectionRegistry.authenticate(ctx.connection, identity));
  }

  if (pairingCode !== undefined) {
    const issued = completePairing(deviceRegistry, deviceId, { pairingCode, deviceName, role });
    return connectedResult(params, connectionRegistry.authenticate(ctx.connection, identity), issued);
  }

  // Loopback auto-trust (P3): no token, no pairing code, but a local operator on the trusted machine boundary.
  // Operator-only (nodes carry capabilities → Permission Gate → must still pair) and fail-closed on a
  // non-loopback/unknown peer. A token is still issued so reconnects work even if the flag is later turned off.
  const { remoteAddress } = ctx.connection;
  if (trustLoopbackOperator && role === RoleSchema.enum.operator && isLoopback(remoteAddress)) {
    const issued = deviceRegistry.trustDevice(deviceId, { deviceName, role });
    connectionRegistry.authenticate(ctx.connection, { deviceId, role, capabilities });
    onAutoTrust({ deviceId, deviceName, remoteAddress });
    return { status: "ok", token: issued };
  }

  const code = deviceRegistry.beginPairing(deviceId);
  onPairingCode({ deviceId, deviceName, code });
  throw appException(ErrorCodeSchema.enum.PAIRING_REQUIRED, "pairing required");
}

function authenticatedIdentity(params: ConnectParams) {
  const host = params.host ? negotiateHost(params.host) : undefined;
  return { deviceId: params.deviceId, role: params.role, capabilities: params.capabilities, host };
}

function negotiateHost(host: NonNullable<ConnectParams["host"]>) {
  const protocolVersion = selectVersion(host.protocol.min, host.protocol.max, HOST_CONTROL_PROTOCOL_VERSION);
  const catalogSchemaVersion = host.catalogSchemaVersions.includes(HOST_CATALOG_SCHEMA_VERSION)
    ? HOST_CATALOG_SCHEMA_VERSION
    : undefined;
  if (!protocolVersion || !catalogSchemaVersion) {
    throw appException(ErrorCodeSchema.enum.AUTH_FAILED, "Host protocol versions are not supported");
  }
  return { protocolVersion, catalogSchemaVersion };
}

function selectVersion(min: number, max: number, supported: number): number | undefined {
  return supported >= min && supported <= max ? supported : undefined;
}

function connectedResult(
  params: ConnectParams,
  host: ReturnType<ConnectionRegistry["authenticate"]>,
  token?: string,
): ConnectResult {
  return { status: "ok", token, host: params.role === "node" ? host : undefined };
}

interface PairingInput {
  pairingCode: string;
  deviceName: string;
  role: Role;
}

// A wrong/expired code is a normal outcome, not a crash: map it to AUTH_FAILED and let the
// device-registry account the attempt. The socket stays open so retries burn the 3-attempt budget.
function completePairing(deviceRegistry: DeviceRegistry, deviceId: string, input: PairingInput): string {
  try {
    return deviceRegistry.completePairing(deviceId, input.pairingCode, {
      deviceName: input.deviceName,
      role: input.role,
    });
  } catch (error) {
    if (error instanceof PairingError) throw appException(ErrorCodeSchema.enum.AUTH_FAILED, error.message);
    throw error;
  }
}

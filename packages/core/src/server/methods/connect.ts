/**
 * INPUT:  ConnectParams from a dispatched pre-auth connect request + injected registries and a code sink
 * OUTPUT: connectMethod(deps) -> MethodDefinition; authenticates the socket or drives pairing (prd §3/§6)
 * POS:    core/server/methods — the ONLY pre-auth method; thin delegation to device-registry + connection-registry
 */
import {
  CONNECT_METHOD,
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

export interface ConnectMethodDeps {
  deviceRegistry: DeviceRegistry;
  connectionRegistry: ConnectionRegistry;
  onPairingCode: (info: PairingCodeInfo) => void;
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
  const { deviceRegistry, connectionRegistry, onPairingCode } = deps;
  const { deviceId, deviceName, role, capabilities, token, pairingCode } = params;

  if (ctx.connection.state.status === "authenticated") {
    // App-level refusal (not envelope INVALID_REQUEST): the frame is well-formed; re-handshake
    // is a protocol-state violation the Rust Shell will mirror via the same closed union.
    throw appException(ErrorCodeSchema.enum.ALREADY_CONNECTED, "already connected: re-handshake is not allowed");
  }

  if (token !== undefined) {
    if (!deviceRegistry.verifyToken(deviceId, token, role)) {
      ctx.close(); // fail-closed: a wrong token or role mismatch is not a retryable state
      throw appException(ErrorCodeSchema.enum.AUTH_FAILED, "authentication failed");
    }
    connectionRegistry.authenticate(ctx.connection, { deviceId, role, capabilities });
    return { status: "ok" };
  }

  if (pairingCode !== undefined) {
    const issued = completePairing(deviceRegistry, deviceId, { pairingCode, deviceName, role });
    connectionRegistry.authenticate(ctx.connection, { deviceId, role, capabilities });
    return { status: "ok", token: issued };
  }

  const code = deviceRegistry.beginPairing(deviceId);
  onPairingCode({ deviceId, deviceName, code });
  throw appException(ErrorCodeSchema.enum.PAIRING_REQUIRED, "pairing required");
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

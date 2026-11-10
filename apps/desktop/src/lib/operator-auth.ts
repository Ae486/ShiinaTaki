/**
 * INPUT:  one candidate WsClient, its owner-specific device name, and the same-origin operator credential storage.
 * OUTPUT: authenticateOperator() — offers complete command display, uses current credentials, saves only accepted tokens.
 * POS:    ui/lib — shared authentication seam for the independent Pet, Home, and Chat connection owners.
 */

import { APPROVAL_COMMAND_DISCLOSURE_REVISION, type ConnectParams } from "@taki/shared";
import { nativeLocalAuth, type NativeLocalAuth } from "./native-local-auth.ts";
import { clearToken, loadOrCreateIdentity, saveToken, type IdentityStorage } from "./device-identity.ts";
import type { WsClient } from "./ws-client.ts";
import type { ConnectOutcome } from "./ws-client-methods.ts";

export interface OperatorAuthInput {
  client: Pick<WsClient, "connect">;
  deviceName: string;
  storage: IdentityStorage;
  native?: NativeLocalAuth;
}

const acceptedIdentities = new WeakMap<object, string>();

/** Reporting follows the identity accepted on this physical client, including native profile adoption. */
export function authenticatedOperatorDeviceId(client: object): string | null {
  return acceptedIdentities.get(client) ?? null;
}

/** Clears only this operator surface's persisted reconnect token after Core rejects it. */
export function recoverOperatorAuth(storage: IdentityStorage): boolean {
  return clearToken(storage);
}

export async function authenticateOperator(input: OperatorAuthInput): Promise<ConnectOutcome> {
  const native = input.native ?? nativeLocalAuth();
  if (native) return authenticateNativeOperator(input, native);
  const identity = loadOrCreateIdentity(input.storage);
  const base = {
    deviceId: identity.deviceId,
    deviceName: input.deviceName,
    role: "operator" as const,
    capabilities: [],
    approvalCommandDisclosureRevision: APPROVAL_COMMAND_DISCLOSURE_REVISION,
  } satisfies ConnectParams;
  const outcome = await input.client.connect(identity.token ? { ...base, token: identity.token } : base);
  if (outcome.ok) acceptedIdentities.set(input.client, identity.deviceId);
  if (outcome.ok && outcome.token) saveToken(outcome.token, input.storage);
  return outcome;
}

async function authenticateNativeOperator(input: OperatorAuthInput, native: NativeLocalAuth): Promise<ConnectOutcome> {
  const deviceId = await native.identity();
  const tokenKey = `taki.native-operator-token.${deviceId}`;
  const base = { deviceId, deviceName: input.deviceName, role: "operator" as const, capabilities: [],
    approvalCommandDisclosureRevision: APPROVAL_COMMAND_DISCLOSURE_REVISION } satisfies ConnectParams;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const clientNonce = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const begin = await input.client.connect({ ...base, localAuth: { kind: "begin", clientNonce } });
  if (begin.ok) throw new Error("本地服务未提供身份验证");
  if (begin.code === "LOCAL_AUTH_UNAVAILABLE") throw new Error("本地服务身份暂不可用，正在重试");
  if (begin.code !== "LOCAL_AUTH_REQUIRED" || !begin.challenge) return begin;
  const challenge = begin.challenge;
  if (challenge.deviceId !== deviceId || challenge.role !== "operator" || challenge.clientNonce !== clientNonce) {
    return { ok: false, code: "LOCAL_AUTH_FAILED", message: "无法验证本地服务身份" };
  }
  const proof = await native.proof(challenge);
  const token = input.storage.getItem(tokenKey) ?? undefined;
  const result = await input.client.connect({ ...base, token, localAuth: { kind: "proof", nonce: challenge.nonce, proof } });
  if (result.ok) acceptedIdentities.set(input.client, deviceId);
  if (result.ok && result.token) input.storage.setItem(tokenKey, result.token);
  if (!result.ok && result.code === "LOCAL_AUTH_UNAVAILABLE") throw new Error("本地服务暂不可用，正在重试");
  return result;
}

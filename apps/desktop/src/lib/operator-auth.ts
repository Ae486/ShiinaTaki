/**
 * INPUT:  one candidate WsClient, its owner-specific device name, and the same-origin operator credential storage.
 * OUTPUT: authenticateOperator() — offers complete command display, uses current credentials, saves only accepted tokens.
 * POS:    ui/lib — shared authentication seam for the independent Pet, Home, and Chat connection owners.
 */

import { APPROVAL_COMMAND_DISCLOSURE_REVISION, type ConnectParams } from "@taki/shared";
import { clearToken, loadOrCreateIdentity, saveToken, type IdentityStorage } from "./device-identity.ts";
import type { WsClient } from "./ws-client.ts";
import type { ConnectOutcome } from "./ws-client-methods.ts";

export interface OperatorAuthInput {
  client: Pick<WsClient, "connect">;
  deviceName: string;
  storage: IdentityStorage;
}

/** Clears only this operator surface's persisted reconnect token after Core rejects it. */
export function recoverOperatorAuth(storage: IdentityStorage): boolean {
  return clearToken(storage);
}

export async function authenticateOperator(input: OperatorAuthInput): Promise<ConnectOutcome> {
  const identity = loadOrCreateIdentity(input.storage);
  const base = {
    deviceId: identity.deviceId,
    deviceName: input.deviceName,
    role: "operator" as const,
    capabilities: [],
    approvalCommandDisclosureRevision: APPROVAL_COMMAND_DISCLOSURE_REVISION,
  } satisfies ConnectParams;
  const outcome = await input.client.connect(identity.token ? { ...base, token: identity.token } : base);
  if (outcome.ok && outcome.token) saveToken(outcome.token, input.storage);
  return outcome;
}

/**
 * INPUT:  a locally-persisted operator device identity (shared with the pet window via same-origin localStorage).
 * OUTPUT: useChatConnection() -> { client, status } — the chat window's OWN operator WS to the Core.
 * POS:    ui/windows/chat — the chat window's connection seam. A disposable client: it dies with the window; the Core
 *         allows concurrent same-device sockets (research r4), so this coexists with the pet window's socket.
 */

import { useEffect, useState } from "react";
import { DEFAULT_WS_HOST, DEFAULT_WS_PORT, ErrorCodeSchema } from "@taki/shared";
import { loadOrCreateIdentity, saveToken, type OperatorIdentity } from "@/lib/device-identity.js";
import { createWsClient, type WsClient } from "@/lib/ws-client.js";
import { createBrowserTransport } from "@/lib/ws-transport.js";
import type { ConnectionStatus } from "@/stores/connection-store.js";

const WS_URL = `ws://${DEFAULT_WS_HOST}:${DEFAULT_WS_PORT}`;
const DEVICE_NAME = "taki-chat";

// Mirrors the pet window's connectOperator (use-core-connection): reuse a stored token; surface PAIRING_REQUIRED as
// its own status. Sharing the pet's identity means the chat window auto-authenticates once the pet has paired.
async function connectOperator(client: WsClient, identity: OperatorIdentity): Promise<ConnectionStatus> {
  const base = { deviceId: identity.deviceId, deviceName: DEVICE_NAME, role: "operator" as const, capabilities: [] };
  const outcome = await client.connect(identity.token ? { ...base, token: identity.token } : base);
  if (outcome.ok) {
    if (outcome.token) saveToken(outcome.token, localStorage);
    return { kind: "connected" };
  }
  if (outcome.code === ErrorCodeSchema.enum.PAIRING_REQUIRED) return { kind: "pairing-required" };
  return { kind: "error", code: outcome.code, message: outcome.message };
}

export interface ChatConnection {
  client: WsClient | null;
  status: ConnectionStatus;
}

export function useChatConnection(): ChatConnection {
  const [client, setClient] = useState<WsClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>({ kind: "connecting" });

  useEffect(() => {
    const created = createWsClient({ transport: createBrowserTransport(WS_URL) });
    let cancelled = false;
    setClient(created);
    created.onClose(() => cancelled || setStatus({ kind: "disconnected" }));
    void connectOperator(created, loadOrCreateIdentity(localStorage))
      .then((next) => cancelled || setStatus(next))
      .catch((error: unknown) => cancelled || setStatus({ kind: "error", code: null, message: String(error) }));
    return () => {
      cancelled = true;
      created.close();
      setClient(null);
    };
  }, []);

  return { client, status };
}

/**
 * INPUT:  a locally-persisted operator device identity (shared with the pet window via same-origin localStorage).
 * OUTPUT: useHomeConnection() -> { client, status } — the home shell's OWN operator WS, provided to every page that
 *         is not the chat page (chat keeps its own socket; its streaming turn state must not share a client).
 * POS:    ui/windows/home — the settings pages' connection seam. A disposable client (invariant 4): it dies with the
 *         window; the Core accepts concurrent same-device sockets.
 */

import { useEffect, useState } from "react";
import { DEFAULT_WS_HOST, DEFAULT_WS_PORT, ErrorCodeSchema } from "@taki/shared";
import { loadOrCreateIdentity, saveToken, type OperatorIdentity } from "@/lib/device-identity.js";
import { createWsClient, type WsClient } from "@/lib/ws-client.js";
import { createBrowserTransport } from "@/lib/ws-transport.js";
import type { ConnectionStatus } from "@/stores/connection-store.js";

const WS_URL = `ws://${DEFAULT_WS_HOST}:${DEFAULT_WS_PORT}`;
const DEVICE_NAME = "taki-home";

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

export interface HomeConnection {
  client: WsClient | null;
  status: ConnectionStatus;
}

export function useHomeConnection(): HomeConnection {
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

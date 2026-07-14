/**
 * INPUT:  the loaded PetScene (nullable while the model loads); a locally-persisted operator device identity.
 * OUTPUT: useCoreConnection(scene) — opens the operator WS to the Core, reports the model vocabulary, subscribes to
 *         avatar commands, and applies each through the shared presentation gate. Publishes status to the store.
 * POS:    ui/windows/pet — the ws-client ↔ renderer bridge (renderer stays framework-free; the WS lives here). The
 *         bubble feature reads the same client from the connection store.
 */

import { useEffect } from "react";
import { DEFAULT_WS_HOST, DEFAULT_WS_PORT, ErrorCodeSchema } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { loadOrCreateIdentity, saveToken, type OperatorIdentity } from "@/lib/device-identity.js";
import { sharedPresentationGate } from "@/lib/presentation-gate.js";
import { createWsClient, type WsClient } from "@/lib/ws-client.js";
import { createBrowserTransport } from "@/lib/ws-transport.js";
import type { PetScene } from "@/renderer/pet-scene.js";
import { useConnectionStore, type ConnectionStatus } from "@/stores/connection-store.js";

const WS_URL = `ws://${DEFAULT_WS_HOST}:${DEFAULT_WS_PORT}`;
const DEVICE_NAME = "taki-pet";

// Localhost = auto-trust is the intended P3 behavior, but the Core still requires a one-time pairing (no loopback
// trust in connect.ts yet). So: reuse a stored token; surface PAIRING_REQUIRED as its own status. See the report.
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

export function useCoreConnection(scene: PetScene | null): void {
  const setClient = useConnectionStore((s) => s.setClient);
  const setStatus = useConnectionStore((s) => s.setStatus);
  const client = useConnectionStore((s) => s.client);
  const status = useConnectionStore((s) => s.status);

  useEffect(() => {
    const created = createWsClient({ transport: createBrowserTransport(WS_URL) });
    let cancelled = false;
    setClient(created);
    setStatus({ kind: "connecting" });
    created.onClose(() => cancelled || setStatus({ kind: "disconnected" }));
    void connectOperator(created, loadOrCreateIdentity(localStorage))
      .then((next) => cancelled || setStatus(next))
      .catch((error: unknown) => cancelled || setStatus({ kind: "error", code: null, message: String(error) }));
    return () => {
      cancelled = true;
      created.close();
      setClient(null);
    };
  }, [setClient, setStatus]);

  // Model loaded + authenticated ⇒ report the manifest vocabulary (Option A), subscribe, and route commands through
  // the shared gate so an expression surfaces with the reply bubble. Re-runs only when scene/client/status flip.
  useEffect(() => {
    if (!scene || !client || status.kind !== "connected") return;
    client.onAvatarCommand((command) => sharedPresentationGate.present(() => scene.applyAvatarCommand(command)));
    void client.reportAvatar({ characterId: ACTIVE_CHARACTER_ID, ...scene.reportVocabulary() });
    void client.subscribeAvatar(ACTIVE_CHARACTER_ID);
  }, [scene, client, status.kind]);
}

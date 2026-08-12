/**
 * INPUT:  a locally-persisted operator device identity (shared with the pet window via same-origin localStorage).
 * OUTPUT: useHomeConnection() -> the shared settings-family owner's current restored client + persistent status.
 * POS:    ui/windows/home — independent Home lifecycle adapter; Chat and Pet retain separate controllers/sockets.
 */

import { useOperatorConnection } from "@/hooks/use-operator-connection.js";
import type { TimingPolicy } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import type { ConnectionStatus } from "@/stores/connection-store.js";

const DEVICE_NAME = "taki-home";

export interface HomeConnection {
  client: WsClient | null;
  status: ConnectionStatus;
  currentTimingPolicy: () => TimingPolicy;
}

export function useHomeConnection(): HomeConnection {
  return useOperatorConnection({ deviceName: DEVICE_NAME, lifecycleKey: DEVICE_NAME });
}

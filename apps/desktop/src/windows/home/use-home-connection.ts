/**
 * INPUT:  a locally-persisted operator device identity (shared with the pet window via same-origin localStorage).
 * OUTPUT: useHomeConnection() -> the shared settings-family owner's current restored client + persistent status.
 * POS:    ui/windows/home — independent Home lifecycle adapter; Chat and Pet retain separate controllers/sockets.
 */

import { useOperatorConnection } from "@/hooks/use-operator-connection.js";
import type { TimingPolicy } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import type { ConnectionStatus } from "@/stores/connection-store.js";
import { useHomeTimezone } from "@/features/presence/use-home-timezone.js";
import type { UserTimezoneController } from "@/features/presence/user-timezone-controller.js";
import { useSurfacePresence } from "@/features/presence/use-surface-presence.js";

const DEVICE_NAME = "taki-home";

export interface HomeConnection {
  client: WsClient | null;
  status: ConnectionStatus;
  currentTimingPolicy: () => TimingPolicy;
  timezone: UserTimezoneController | null;
}

export function useHomeConnection(): HomeConnection {
  const connection = useOperatorConnection({ deviceName: DEVICE_NAME, lifecycleKey: DEVICE_NAME });
  const timezone = useHomeTimezone(connection.client);
  useSurfacePresence(connection.client, "home");
  return { ...connection, timezone };
}

/**
 * INPUT:  a locally-persisted operator device identity (shared with the pet window via same-origin localStorage).
 * OUTPUT: useChatConnection() -> Chat's independent restored client + status; timeline restoration gates connected.
 * POS:    ui/windows/home/pages/chat — disposable Chat lifecycle owner; never shares Home settings/Pet clients.
 */

import { useOperatorConnection } from "@/hooks/use-operator-connection.js";
import type { WsClient } from "@/lib/ws-client.js";
import type { ConnectionStatus } from "@/stores/connection-store.js";
import { restoreChatTimeline } from "./restore-chat-timeline.ts";

const DEVICE_NAME = "taki-chat";

export interface ChatConnection {
  client: WsClient | null;
  status: ConnectionStatus;
}

export function useChatConnection(): ChatConnection {
  return useOperatorConnection({
    deviceName: DEVICE_NAME,
    lifecycleKey: DEVICE_NAME,
    restore: restoreChatTimeline,
  });
}

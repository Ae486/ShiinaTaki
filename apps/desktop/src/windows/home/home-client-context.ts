/**
 * INPUT:  the home shell's WsClient, connection status, and window-owned last-good timing-policy accessor.
 * OUTPUT: HomeClientContext + useHomeClient() — the connection handle every settings page reads.
 * POS:    ui/windows/home — a thin React context so a page never opens its own socket (the chat page predates this and
 *         keeps its own). Client is null until the connection exists; pages render a disabled state instead of throwing.
 */

import { createContext, useContext } from "react";
import { TIMING_POLICY_DEVELOPMENT_DEFAULTS, type TimingPolicy } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import type { ConnectionStatus } from "@/stores/connection-store.js";

export interface HomeClient {
  client: WsClient | null;
  status: ConnectionStatus;
  currentTimingPolicy: () => TimingPolicy;
}

export const HomeClientContext = createContext<HomeClient>({
  client: null,
  status: { kind: "connecting" },
  currentTimingPolicy: () => TIMING_POLICY_DEVELOPMENT_DEFAULTS,
});

export function useHomeClient(): HomeClient {
  return useContext(HomeClientContext);
}

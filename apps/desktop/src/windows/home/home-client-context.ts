/**
 * INPUT:  the home shell's WsClient + connection status (created once at the window root).
 * OUTPUT: HomeClientContext + useHomeClient() — the client handle every settings page reads.
 * POS:    ui/windows/home — a thin React context so a page never opens its own socket (the chat page predates this and
 *         keeps its own). Client is null until the connection exists; pages render a disabled state instead of throwing.
 */

import { createContext, useContext } from "react";
import type { WsClient } from "@/lib/ws-client.js";
import type { ConnectionStatus } from "@/stores/connection-store.js";

export interface HomeClient {
  client: WsClient | null;
  status: ConnectionStatus;
}

export const HomeClientContext = createContext<HomeClient>({ client: null, status: { kind: "connecting" } });

export function useHomeClient(): HomeClient {
  return useContext(HomeClientContext);
}

/**
 * INPUT:  connection lifecycle updates from the core-connection hook (handshake outcome, socket close).
 * OUTPUT: the operator connection's status (discriminated union) + the shared WsClient handle for consumer hooks.
 * POS:    ui/stores — the pet window's connection domain (one store per domain). Hooks read the client + status;
 *         components never touch the client directly (hook-guidelines). Windows do not share this JS memory.
 */

import { create } from "zustand";
import type { ErrorCode } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";

// Discriminated union (no boolean-flag combos, type-safety spec). `pairing-required` is surfaced when the core has
// not yet trusted this operator device — localhost auto-trust (P3) is a backend concern; see the hook for the flag.
export type ConnectionStatus =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "pairing-required" }
  | { kind: "disconnected" }
  | { kind: "error"; code: ErrorCode | null; message: string };

type ConnectionStore = {
  status: ConnectionStatus;
  client: WsClient | null;
  setStatus: (status: ConnectionStatus) => void;
  setClient: (client: WsClient | null) => void;
};

export const useConnectionStore = create<ConnectionStore>()((set) => ({
  status: { kind: "connecting" },
  client: null,
  setStatus: (status) => set({ status }),
  setClient: (client) => set({ client }),
}));

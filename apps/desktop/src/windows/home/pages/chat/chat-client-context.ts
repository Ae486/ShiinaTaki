/**
 * INPUT:  the chat page's WsClient (provided at the ChatPage root once its connection is created).
 * OUTPUT: ChatClientContext + useChatClient() — the client handle for deep consumers (image parts fetch bytes lazily).
 * POS:    ui/windows/home/pages/chat — a thin React context so image-attachment can call media.get without prop-drilling the
 *         client through every timeline row. Null until the connection exists.
 */

import { createContext, useContext } from "react";
import type { WsClient } from "@/lib/ws-client.js";

export const ChatClientContext = createContext<WsClient | null>(null);

export function useChatClient(): WsClient | null {
  return useContext(ChatClientContext);
}

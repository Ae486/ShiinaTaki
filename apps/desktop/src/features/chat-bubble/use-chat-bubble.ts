/**
 * INPUT:  user submit + the shared WsClient (from the connection store); the streamed chat.* events it yields.
 * OUTPUT: useChatBubble() -> { isOpen, reply, isPending, error, open, close, send } for the bubble component.
 * POS:    ui/features/chat-bubble — the ONLY touchpoint between the bubble UI and ws-client/stores (hook-guidelines).
 *         Routes deltas through the shared presentation gate so reply text surfaces with the avatar command (F3/D21).
 */

import { useCallback, useState } from "react";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { sharedPresentationGate } from "@/lib/presentation-gate.js";
import type { WsClient } from "@/lib/ws-client.js";
import { useConnectionStore } from "@/stores/connection-store.js";
import { useInteractionStore } from "@/stores/interaction-store.js";
import { useChatBubbleStore, type BubbleReply } from "./chat-bubble-store.ts";

// One chat turn: deltas append into the store THROUGH the shared gate (v1 immediate; #31 holds them for audio-ready).
function streamReply(client: WsClient, message: string): Promise<void> {
  const store = useChatBubbleStore.getState();
  store.startReply();
  return client.chat(
    { characterId: ACTIVE_CHARACTER_ID, message },
    {
      onDelta: (delta) => sharedPresentationGate.present(() => useChatBubbleStore.getState().appendDelta(delta)),
      onComplete: () => useChatBubbleStore.getState().finishReply(),
      onError: (_code, reason) => useChatBubbleStore.getState().failReply(reason),
    },
  );
}

export interface ChatBubble {
  isOpen: boolean;
  reply: BubbleReply;
  isPending: boolean;
  connectionReady: boolean;
  error: string | null;
  open: () => void;
  close: () => void;
  send: (message: string) => Promise<void>;
}

export function useChatBubble(): ChatBubble {
  const client = useConnectionStore((s) => s.client);
  const isOpen = useInteractionStore((s) => s.bubbleOpen);
  const setBubbleOpen = useInteractionStore((s) => s.setBubbleOpen);
  const reply = useChatBubbleStore((s) => s.reply);
  const [isPending, setPending] = useState(false);

  const open = useCallback(() => {
    useChatBubbleStore.getState().reset();
    setBubbleOpen(true);
  }, [setBubbleOpen]);
  const close = useCallback(() => setBubbleOpen(false), [setBubbleOpen]);

  const send = useCallback(
    async (message: string) => {
      if (!client) return useChatBubbleStore.getState().failReply("Not connected to the agent core yet.");
      setPending(true);
      try {
        await streamReply(client, message);
      } catch (error) {
        useChatBubbleStore.getState().failReply(error instanceof Error ? error.message : String(error));
      } finally {
        setPending(false);
      }
    },
    [client],
  );

  return {
    isOpen,
    reply,
    isPending,
    connectionReady: client !== null,
    error: reply.kind === "error" ? reply.message : null,
    open,
    close,
    send,
  };
}

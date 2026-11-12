/**
 * INPUT:  explicit bubble visibility, the restored Pet client and narrow reply/transcript selectors
 * OUTPUT: segmented presentation, guarded local send/draft recovery and open/close actions
 * POS:    ui/chat-bubble — component-facing hook; observing activity never opens the overlay
 */

import { useCallback } from "react";
import { useConnectionStore } from "@/stores/connection-store.js";
import { useInteractionStore } from "@/stores/interaction-store.js";
import { useBubbleTranscript } from "./use-bubble-transcript.ts";
import { useBubbleSend } from "./use-bubble-send.ts";
import type { BubbleTranscript } from "./bubble-transcript.ts";

export interface ChatBubble {
  isOpen: boolean;
  transcript: BubbleTranscript;
  presentationVersion: number;
  isPending: boolean;
  connectionReady: boolean;
  error: string | null;
  open: () => void;
  close: () => void;
  send: (message: string) => Promise<void>;
  retractedDraft: string | null;
  consumeRetractedDraft: () => void;
}

export function useChatBubble(): ChatBubble {
  const client = useConnectionStore((s) => s.client);
  const isOpen = useInteractionStore((s) => s.bubbleOpen);
  const setBubbleOpen = useInteractionStore((s) => s.setBubbleOpen);
  const view = useBubbleTranscript();
  const sending = useBubbleSend(client);

  const open = useCallback(() => {
    setBubbleOpen(true);
  }, [setBubbleOpen]);
  const close = useCallback(() => setBubbleOpen(false), [setBubbleOpen]);
  const error = view.transcript.items.find((item) => item.kind === "error");

  return {
    isOpen, ...view, ...sending,
    connectionReady: client !== null,
    error: error?.kind === "error" ? error.text : null,
    open, close,
  };
}

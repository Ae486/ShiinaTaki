/**
 * INPUT:  the current Pet client and an explicit local text submission
 * OUTPUT: exact initiating-request pending/draft/error state with guarded legacy presentation fallback
 * POS:    ui/chat-bubble — local send hook; the shared activity observer independently owns modern reply content
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSendResult } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { sharedPresentationGate } from "@/lib/presentation-gate.js";
import type { WsClient } from "@/lib/ws-client.js";
import { useInteractionStore } from "@/stores/interaction-store.js";
import { bubbleActivityOwnsMessage } from "./bubble-activity-binding.ts";
import { useChatBubbleStore } from "./chat-bubble-store.ts";

export interface BubbleSendTicket {
  client: Pick<WsClient, "chat">;
  accepted?: ChatSendResult;
  current(): boolean;
}

function legacyDelta(ticket: BubbleSendTicket, messageId: string, delta: string): void {
  if (!ticket.current() || bubbleActivityOwnsMessage(messageId)) return;
  const version = useChatBubbleStore.getState().presentationVersion;
  sharedPresentationGate.present(() => {
    const store = useChatBubbleStore.getState();
    if (!ticket.current() || store.presentationVersion !== version || store.replyMessageId !== messageId
      || !useInteractionStore.getState().bubbleOpen || bubbleActivityOwnsMessage(messageId)) return;
    store.appendDelta(delta);
  });
}

export function runBubbleSend(ticket: BubbleSendTicket, message: string, retracted: (text: string) => void): Promise<void> {
  useChatBubbleStore.getState().startReply();
  return ticket.client.chat({ characterId: ACTIVE_CHARACTER_ID, message }, {
    onAccepted: (accepted) => {
      if (!ticket.current()) return;
      ticket.accepted = accepted;
      useChatBubbleStore.getState().identifyReply(accepted.messageId);
    },
    onDelta: (delta, messageId) => legacyDelta(ticket, messageId, delta),
    onComplete: () => { if (ticket.current()) useChatBubbleStore.getState().finishReply(); },
    onError: (code, reason, wasRetracted) => {
      if (!ticket.current()) return;
      const store = useChatBubbleStore.getState();
      if (wasRetracted) { store.clearReply(); retracted(message); return; }
      if (code === "INTERNAL_ERROR" || !ticket.accepted || !bubbleActivityOwnsMessage(ticket.accepted.messageId)) store.failReply(reason);
    },
  });
}

export function useBubbleSend(client: WsClient | null) {
  const currentClient = useRef(client);
  currentClient.current = client;
  const current = useRef<BubbleSendTicket | null>(null);
  const [isPending, setPending] = useState(false);
  const [retractedDraft, setRetractedDraft] = useState<string | null>(null);
  useEffect(() => {
    current.current = null; setPending(false);
    return () => { current.current = null; };
  }, [client]);
  const send = useCallback(async (message: string) => {
    if (!client) { useChatBubbleStore.getState().failReply("尚未连接到 Agent Core，请稍后重试。"); return; }
    if (current.current) return;
    const ticket: BubbleSendTicket = { client, current: () => current.current === ticket && currentClient.current === client };
    current.current = ticket; setPending(true);
    try { await runBubbleSend(ticket, message, setRetractedDraft); }
    catch (cause) {
      if (ticket.current()) {
        useChatBubbleStore.getState().failReply(cause instanceof Error ? cause.message : String(cause));
        if (!ticket.accepted) setRetractedDraft(message);
      }
    } finally { if (ticket.current()) { current.current = null; setPending(false); } }
  }, [client]);
  const consumeRetractedDraft = useCallback(() => setRetractedDraft(null), []);
  return { isPending, send, retractedDraft, consumeRetractedDraft };
}

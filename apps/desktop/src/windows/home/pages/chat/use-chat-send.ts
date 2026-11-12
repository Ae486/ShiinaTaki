/**
 * INPUT:  Chat's current physical client and explicit submit/cancel actions
 * OUTPUT: identity-guarded pending/draft recovery and exact-Run cancellation without stale callback effects
 * POS:    ui/chat — initiating-request hook; shared activity owns rendered output and ordinary history commits
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSendResult, ImageAttachment } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { activityMessageId } from "@/lib/chat-activity-state.js";
import type { WsClient } from "@/lib/ws-client.js";
import { pushToast } from "@/components/toast/toast-store.js";
import { recordDelta } from "./chat-delta-coalescer.ts";
import { useChatTimelineStore } from "./chat-timeline-store.ts";

export interface ChatSendTicket {
  client: Pick<WsClient, "chat" | "chatCancel">;
  accepted?: ChatSendResult;
  cancelRequested: boolean;
  cancelling: boolean;
  current(): boolean;
}

function activityOwns(messageId: string): boolean {
  const state = useChatTimelineStore.getState();
  return state.live.covered.has(messageId) || state.live.turns.some((turn) => activityMessageId(turn.view.snapshot) === messageId);
}

function clearLegacy(ticket: ChatSendTicket): void {
  const store = useChatTimelineStore.getState();
  if (store.inflight?.messageId === ticket.accepted?.messageId) store.clearInflight();
}

export function cancelChatSend(ticket: ChatSendTicket): void {
  ticket.cancelRequested = true;
  if (!ticket.current() || !ticket.accepted || ticket.cancelling) return;
  ticket.cancelling = true;
  void ticket.client.chatCancel(ACTIVE_CHARACTER_ID, ticket.accepted.runId).catch(() => {
    if (ticket.current()) pushToast("取消请求未能送达，请确认连接状态后重试。");
  }).finally(() => { ticket.cancelling = false; });
}

export function runChatSend(ticket: ChatSendTicket, input: { message: string; attachments: ImageAttachment[] }, onRetracted: (message: string) => void): Promise<void> {
  return ticket.client.chat({ characterId: ACTIVE_CHARACTER_ID, message: input.message,
    ...(input.attachments.length > 0 ? { attachments: input.attachments } : {}) }, {
    onAccepted: (accepted) => {
      if (!ticket.current()) return;
      ticket.accepted = accepted;
      if (ticket.cancelRequested) cancelChatSend(ticket);
    },
    onDelta: (delta, messageId) => {
      if (ticket.current() && !activityOwns(messageId)) recordDelta(messageId, delta);
    },
    onComplete: () => { if (ticket.current()) clearLegacy(ticket); },
    onError: (_code, reason, retracted) => {
      if (!ticket.current()) return;
      clearLegacy(ticket);
      if (retracted) onRetracted(input.message);
      else pushToast(reason);
    },
  });
}

export function useChatSend(client: WsClient | null) {
  const currentClient = useRef(client);
  currentClient.current = client;
  const ticketRef = useRef<ChatSendTicket | null>(null);
  const [isSending, setSending] = useState(false);
  const [retractedDraft, setRetractedDraft] = useState<string | null>(null);
  useEffect(() => {
    ticketRef.current = null;
    setSending(false);
    return () => { ticketRef.current = null; };
  }, [client]);
  const send = useCallback((message: string, attachments: ImageAttachment[]) => {
    if (!client || ticketRef.current) return;
    const ticket: ChatSendTicket = { client, cancelRequested: false, cancelling: false,
      current: () => ticketRef.current === ticket && currentClient.current === client };
    ticketRef.current = ticket;
    setSending(true);
    void runChatSend(ticket, { message, attachments }, setRetractedDraft)
      .catch((cause: unknown) => { if (ticket.current()) pushToast(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (ticket.current()) { ticketRef.current = null; setSending(false); } });
  }, [client]);
  const cancel = useCallback(() => { if (ticketRef.current) cancelChatSend(ticketRef.current); }, []);
  const consumeRetractedDraft = useCallback(() => setRetractedDraft(null), []);
  return { isSending, retractedDraft, consumeRetractedDraft, send, cancel };
}

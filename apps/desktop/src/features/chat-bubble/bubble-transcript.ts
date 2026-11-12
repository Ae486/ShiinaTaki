/**
 * INPUT:  one authoritative activity view, its gated text view and the legacy initiating-request fallback
 * OUTPUT: independent language bubbles, truthful transient tools and at most one terminal error explanation
 * POS:    ui/chat-bubble — pure Pet presentation filter; late results cannot reinsert retired tool identities
 */
import type { ChatActivityItem, ChatActivityReadResult, ChatActivityTerminal, ChatActivityToolStatus } from "@taki/shared";
import { activityItemKey, activityMessageId, type ChatActivityView } from "@/lib/chat-activity-state.js";
import type { BubbleReply } from "./chat-bubble-store.ts";
import type { CommittedTextTarget } from "@/features/presence/surface-presence.js";
import type { CommittedBubble } from "./bubble-committed-timeline.ts";

interface BubbleItemIdentity { key: string; order: number }
export type BubbleTranscriptItem = BubbleItemIdentity & (
  | { kind: "text"; text: string; committed?: CommittedTextTarget[] }
  | { kind: "tool"; toolName: string; displayName?: string; status: ChatActivityToolStatus; stale: boolean }
  | { kind: "error" | "notice"; text: string }
  | { kind: "waiting" }
);
export interface BubbleTranscript {
  key: string;
  items: BubbleTranscriptItem[];
}
export interface BubbleTranscriptInput {
  activitySource: ChatActivityView | null;
  activity: ChatActivityView | null;
  reply: BubbleReply;
  replyMessageId: string | null;
  legacyEpoch: number;
  committed?: CommittedBubble | null;
}

export function projectBubbleTranscript(input: BubbleTranscriptInput): BubbleTranscript {
  if (input.committed) return input.committed.transcript;
  const source = input.activitySource;
  if (!source || source.snapshot.status === "idle") return legacyTranscript(input);
  const messageId = source.snapshot.messageId;
  const displayed = input.activity && activityMessageId(input.activity.snapshot) === messageId ? input.activity.snapshot : null;
  const sourceItems = "items" in source.snapshot ? source.snapshot.items : [];
  const items = displayed && "items" in displayed ? visibleItems({ source, displayed: displayed.items, sourceItems }) : [];
  if (source.snapshot.status === "unavailable") items.push({ key: `unavailable:${messageId}`, order: Number.MAX_SAFE_INTEGER - 1,
    kind: "notice", text: "实时视图无法完整恢复，请在聊天页查看回复。" });
  else if (source.stale) items.push({ key: `stale:${messageId}`, order: Number.MAX_SAFE_INTEGER - 1,
    kind: "notice", text: "实时状态待恢复" });
  const requestError = localError(input, messageId);
  const error = input.replyMessageId === null ? requestError ?? terminalError(source.snapshot, sourceItems)
    : terminalError(source.snapshot, sourceItems) ?? requestError;
  if (error) items.push({ key: `error:${messageId}`, order: Number.MAX_SAFE_INTEGER, kind: "error", text: error });
  if (items.length === 0 && source.snapshot.status === "active") items.push({ key: `waiting:${messageId}`, order: 0, kind: "waiting" });
  return { key: messageId, items: items.sort((left, right) => left.order - right.order) };
}

function visibleItems(input: { source: ChatActivityView; displayed: ChatActivityItem[]; sourceItems: ChatActivityItem[] }): BubbleTranscriptItem[] {
  const snapshot = input.source.snapshot;
  if (snapshot.status === "idle") return [];
  const lastText = input.displayed.reduce((last, item) => item.kind === "text" ? Math.max(last, item.order) : last, -1);
  const ended = snapshot.status === "terminal" || (snapshot.status === "unavailable" && snapshot.terminal !== undefined);
  const facts = new Map(input.sourceItems.map((item) => [item.itemId, item]));
  return input.displayed.flatMap((item): BubbleTranscriptItem[] => {
    const base = { key: activityItemKey(snapshot.messageId, item.itemId), order: item.order };
    if (item.kind === "text") return item.text.length > 0 ? [{ ...base, kind: "text", text: item.text }] : [];
    if (ended || item.order < lastText) return [];
    const fact = facts.get(item.itemId);
    return [{ ...base, kind: "tool", toolName: item.toolName, displayName: item.displayName,
      status: fact?.kind === "tool" ? fact.status : item.status,
      stale: input.source.stale || snapshot.status === "unavailable" }];
  });
}

function terminalError(snapshot: ChatActivityReadResult, items: ChatActivityItem[]): string | null {
  const terminal: ChatActivityTerminal | undefined = snapshot.status === "terminal" ? snapshot
    : snapshot.status === "unavailable" ? snapshot.terminal : undefined;
  if (!terminal || terminal.outcome === "cancelled") return null;
  const lastText = items.reduce((last, item) => item.kind === "text" ? Math.max(last, item.order) : last, -1);
  const unhandled = items.findLast((item) => item.kind === "tool" && item.order > lastText && item.status.phase === "settled"
    && (item.status.outcome === "failed" || item.status.outcome === "outcome_unknown"));
  if (terminal.outcome === "completed" && !unhandled) return null;
  const toolMessage = unhandled?.kind === "tool" && unhandled.status.phase === "settled" ? unhandled.status.message : undefined;
  return terminal.message ?? toolMessage ?? (terminal.outcome === "outcome_unknown" ? "本轮回复的结果尚未确认" : "本轮回复未能完成");
}

function localError(input: BubbleTranscriptInput, messageId: string): string | null {
  if (input.reply.kind !== "error" || (input.replyMessageId !== null && input.replyMessageId !== messageId)) return null;
  return input.reply.message;
}

function legacyTranscript(input: BubbleTranscriptInput): BubbleTranscript {
  const key = `legacy:${input.legacyEpoch}`;
  const reply = input.reply;
  if (reply.kind === "empty") return { key, items: [] };
  const items: BubbleTranscriptItem[] = [];
  const text = "text" in reply ? reply.text : undefined;
  if (text) items.push({ key: `${key}:text`, order: 0, kind: "text", text });
  if (reply.kind === "error") items.push({ key: `${key}:error`, order: 1, kind: "error", text: reply.message });
  else if (reply.kind === "streaming" && items.length === 0) items.push({ key: `${key}:waiting`, order: 0, kind: "waiting" });
  return { key, items };
}

/**
 * INPUT: one private native-message entry and optional producer item references
 * OUTPUT: stable Chat text/tool rows without primary committed-exposure targets
 * POS: ui/subagents — private native-part projection; identities retain Run/Attempt scope
 */
import type { SubagentConversationEntry, TimelinePart, TimelineItemReference } from "@taki/shared";
import type { ChatTranscriptItem } from "@/windows/home/pages/chat/chat-transcript.js";
import { historicalToolStatus } from "@/windows/home/pages/chat/tool-result-display.js";
import { activityItemKey } from "@/lib/chat-activity-state.js";

type MessageEntry = Extract<SubagentConversationEntry, { kind: "message" }>;
type Base = Pick<ChatTranscriptItem, "seq" | "order" | "createdAt" | "workLabel" | "sender" | "readMore">;
type Projection = { items: Map<string, ChatTranscriptItem>; entry: MessageEntry; base: Base };

export function addPrivateMessage(items: Map<string, ChatTranscriptItem>, entry: MessageEntry, base: Base): void {
  if (entry.message.entryKind === "input") return;
  const row = entry.message;
  const parts: TimelinePart[] = row.parts?.length ? row.parts : [{ type: "text", text: row.content }];
  const projection = { items, entry, base };
  for (const [index, part] of parts.entries()) {
    const refs = entry.presentation?.references.filter((ref) => (ref.partIndex ?? 0) === index) ?? [];
    if (part.type === "text") addText(projection, { text: part.text, index, refs });
    else addPart(projection, { part, index, reference: refs[0] });
  }
  if (entry.body && ![...items.values()].some((item) => item.seq === entry.seq)) {
    const key = `private-body:${entry.seq}`;
    items.set(key, { ...base, key, kind: "notice", text: "这条工作记录较长，可读取完整正文。" });
  }
  if (row.entryKind === "partial") items.set(`partial:${row.seq}`, { ...base, key: `partial:${row.seq}`, order: parts.length,
    kind: "notice", text: "保留的部分输出；执行未确认完成。" });
}

function addText(projection: Projection, input: { text: string; index: number; refs: TimelineItemReference[] }): void {
  const { items, entry, base } = projection;
  const references = input.refs.filter((ref) => ref.kind === "text").sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const reference of references) {
    if (reference.kind !== "text" || !entry.presentation) continue;
    if (reference.start > cursor) addTextGap(projection, { index: input.index, start: cursor, text: input.text.slice(cursor, reference.start) });
    const text = input.text.slice(reference.start, reference.end);
    const key = activityItemKey(entry.presentation.messageId, reference.itemId);
    const previous = items.get(key);
    if (text) items.set(key, { ...base, key, seq: previous?.seq ?? base.seq, order: reference.order,
      kind: "text", role: "assistant", text: (previous?.kind === "text" ? previous.text : "") + text });
    cursor = reference.end;
  }
  if (cursor < input.text.length) addTextGap(projection, { index: input.index, start: cursor, text: input.text.slice(cursor) });
}

function addTextGap(projection: Projection, input: { index: number; start: number; text: string }): void {
  if (!input.text) return;
  const { entry, items, base } = projection;
  const key = `private:${entry.message.runId}:${entry.message.seq}:${input.index}:${input.start}`;
  items.set(key, { ...base, key, order: input.index, kind: "text", role: "assistant", text: input.text });
}

function addPart(projection: Projection, input: { part: Exclude<TimelinePart, { type: "text" }>; index: number; reference?: TimelineItemReference }): void {
  const { entry, items, base } = projection;
  const { part, index, reference } = input;
  if (part.type === "image") {
    const key = `private:${entry.message.runId}:${entry.message.seq}:${index}`;
    items.set(key, { ...base, key, order: index, kind: "image", role: "assistant", imageRef: part.ref });
    return;
  }
  const key = reference && entry.presentation ? activityItemKey(entry.presentation.messageId, reference.itemId)
    : `private-tool:${entry.message.runId}:${entry.message.attemptId}:${part.toolCallId}:${part.toolName}`;
  const previous = items.get(key);
  const output = part.type === "tool-result" ? part.output : previous?.kind === "tool" ? previous.output : undefined;
  const status = reference?.kind === "tool" && reference.outcome ? { phase: "settled" as const,
    outcome: reference.outcome, durationMs: reference.durationMs, message: reference.message } : historicalToolStatus(output);
  items.set(key, { ...base, key, order: reference?.order ?? index, ...(previous ? { seq: previous.seq, order: previous.order } : {}),
    kind: "tool", toolName: part.toolName, displayName: part.displayName, output, status });
}

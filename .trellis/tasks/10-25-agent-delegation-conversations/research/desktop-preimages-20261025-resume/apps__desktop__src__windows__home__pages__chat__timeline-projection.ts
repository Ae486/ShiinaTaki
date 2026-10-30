/**
 * INPUT:  chronological canonical Timeline rows with optional stable presentation references
 * OUTPUT: ordered text/images and one conservative invocation item per proved call/result pair
 * POS:    ui/chat — canonical-to-view adapter; legacy calls never imply an active execution
 */
import { sanitizeTimelinePresentations, type ChatActivityToolStatus, type TimelineEntry, type TimelinePart, type TimelinePresentation, type TimelineTextReference, type TimelineToolReference } from "@taki/shared";
import { activityItemKey } from "@/lib/chat-activity-state.js";
import type { ChatTranscriptItem } from "./chat-transcript.ts";
import { historicalToolStatus } from "./tool-result-display.ts";

type ToolPart = Extract<TimelinePart, { type: "tool-call" | "tool-result" }>;
type ToolItem = Extract<ChatTranscriptItem, { kind: "tool" }>;
interface Projection {
  items: Map<string, ChatTranscriptItem>;
  batches: Map<string, number>;
  pending: Map<string, ToolItem[]>;
}

export function projectCanonicalTimeline(entries: TimelineEntry[]): ChatTranscriptItem[] {
  const state: Projection = { items: new Map(), batches: new Map(), pending: new Map() };
  let batch: string | undefined;
  for (const entry of sanitizeTimelinePresentations(entries)) {
    const messageId = entry.presentation?.messageId;
    if (entry.role === "user" || batch !== messageId) state.pending.clear();
    batch = messageId;
    // Empty references retain only batch coverage. Canonical call/result pairing stays within that batch's scope.
    if (entry.presentation?.references.length) projectPresentedEntry(state, entry, entry.presentation);
    else projectLegacyEntry(state, entry);
  }
  return [...state.items.values()];
}

function projectPresentedEntry(state: Projection, entry: TimelineEntry, presentation: TimelinePresentation): void {
  state.pending.clear(); // Do not pair a legacy call across an explicitly scoped modern batch.
  const seq = state.batches.get(presentation.messageId) ?? entry.seq;
  state.batches.set(presentation.messageId, seq);
  const parts = entry.parts?.length ? entry.parts : [{ type: "text", text: entry.content } satisfies TimelinePart];
  for (const reference of presentation.references) {
    const index = reference.partIndex ?? 0;
    const part = parts[index];
    if (!part) continue;
    const key = activityItemKey(presentation.messageId, reference.itemId);
    const base = { key, seq, order: reference.order, createdAt: entry.createdAt };
    if (reference.kind === "tool" && (part.type === "tool-call" || part.type === "tool-result")) {
      projectPresentedTool(state, { part, reference, base });
    }
  }
  // Optional references need not cover non-streamed canonical content. Preserve it without inventing live identity.
  parts.forEach((part, index) => {
    const refs = presentation.references.filter((reference) => (reference.partIndex ?? 0) === index);
    if (part.type === "text" && refs.length > 0) {
      projectReferencedText(state, entry, { text: part.text, index, seq, messageId: presentation.messageId,
        refs: refs.filter((reference): reference is TimelineTextReference => reference.kind === "text").sort((left, right) => left.start - right.start) });
    } else if (refs.length === 0) projectLegacyPart(state, entry, { part, index });
  });
}

function projectReferencedText(state: Projection, entry: TimelineEntry, input: {
  text: string; index: number; seq: number; messageId: string; refs: TimelineTextReference[];
}): void {
  let cursor = 0;
  let previousRef: TimelineTextReference | undefined;
  for (const reference of input.refs) {
    const key = activityItemKey(input.messageId, reference.itemId);
    const gap = input.text.slice(cursor, reference.start);
    if (gap && previousRef?.itemId !== reference.itemId) {
      addTextGap(state, entry, { ...input, start: cursor, text: gap,
        order: previousRef ? (previousRef.order + reference.order) / 2 : reference.order - 0.5 });
    }
    const previous = state.items.get(key);
    const text = (previousRef?.itemId === reference.itemId ? gap : "") + input.text.slice(reference.start, reference.end);
    state.items.set(key, { key, seq: input.seq, order: reference.order, createdAt: entry.createdAt,
      kind: "text", role: "assistant", text: (previous?.kind === "text" ? previous.text : "") + text,
      committed: [...(previous?.kind === "text" ? previous.committed ?? [] : []), { characterId: entry.characterId, timelineSeq: entry.seq }] });
    cursor = reference.end;
    previousRef = reference;
  }
  if (cursor < input.text.length) addTextGap(state, entry, { ...input, start: cursor,
    text: input.text.slice(cursor), order: (previousRef?.order ?? input.index) + 0.5 });
}

function addTextGap(state: Projection, entry: TimelineEntry, input: {
  index: number; start: number; seq: number; order: number; text: string;
}): void {
  const key = `timeline:${entry.id}:${input.index}:text:${input.start}`;
  state.items.set(key, { key, seq: input.seq, order: input.order, createdAt: entry.createdAt,
    kind: "text", role: "assistant", text: input.text, committed: [{ characterId: entry.characterId, timelineSeq: entry.seq }] });
}

function projectPresentedTool(state: Projection, input: {
  part: ToolPart;
  reference: TimelineToolReference;
  base: Pick<ChatTranscriptItem, "key" | "seq" | "order" | "createdAt">;
}): void {
  const { part, reference, base } = input;
  const previous = state.items.get(base.key);
  const output = part.type === "tool-result" ? part.output : previous?.kind === "tool" ? previous.output : undefined;
  const status: ChatActivityToolStatus = reference.outcome ? { phase: "settled", outcome: reference.outcome,
    message: reference.message, durationMs: reference.durationMs } : historicalToolStatus(output);
  state.items.set(base.key, { ...base, kind: "tool", toolName: part.toolName,
    displayName: part.displayName ?? (previous?.kind === "tool" ? previous.displayName : undefined), status, output });
}

function projectLegacyEntry(state: Projection, entry: TimelineEntry): void {
  if (entry.role === "user") {
    const key = `timeline:${entry.id}`;
    state.items.set(key, { key, seq: entry.seq, order: 0, createdAt: entry.createdAt, kind: "user", entry });
    return;
  }
  const parts = entry.parts?.length ? entry.parts : [{ type: "text", text: entry.content } satisfies TimelinePart];
  if (entry.role === "assistant" && parts.some((part) => part.type === "text" && part.text.length > 0)) state.pending.clear();
  parts.forEach((part, index) => projectLegacyPart(state, entry, { part, index }));
}

function projectLegacyPart(state: Projection, entry: TimelineEntry, input: { part: TimelinePart; index: number }): void {
  const { part, index } = input;
  const base = { key: `timeline:${entry.id}:${index}`, seq: entry.seq, order: index, createdAt: entry.createdAt };
  const role: "user" | "assistant" = entry.role === "user" ? "user" : "assistant";
  if (part.type === "text") {
    if (part.text.length > 0) state.items.set(base.key, { ...base, kind: "text", role, text: part.text,
      ...(entry.role === "assistant" ? { committed: [{ characterId: entry.characterId, timelineSeq: entry.seq }] } : {}) });
  } else if (part.type === "image") state.items.set(base.key, { ...base, kind: "image", role, imageRef: part.ref });
  else {
    const identity = JSON.stringify([part.toolCallId, part.toolName]);
    const pending = state.pending.get(identity) ?? [];
    const call = pending[0];
    if (part.type === "tool-result" && pending.length === 1 && call) {
      state.items.set(call.key, { ...call, output: part.output, status: historicalToolStatus(part.output) });
      state.pending.delete(identity);
      return;
    }
    const output = part.type === "tool-result" ? part.output : undefined;
    const item: ToolItem = { ...base, kind: "tool", toolName: part.toolName, displayName: part.displayName,
      status: historicalToolStatus(output), output };
    state.items.set(item.key, item);
    if (part.type === "tool-call") state.pending.set(identity, [...pending, item]);
    else state.pending.delete(identity);
  }
}

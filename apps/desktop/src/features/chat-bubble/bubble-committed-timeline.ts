/**
 * INPUT: ordinary committed Timeline rows or complete presentation batches
 * OUTPUT: bounded latest canonical text bubbles with the existing stable presentation keys
 * POS: ui/chat-bubble — shares Chat's canonical projection; private activity never becomes committed evidence
 */
import type { TimelineEntry } from "@taki/shared";
import { projectCanonicalTimeline } from "@/windows/home/pages/chat/timeline-projection.js";
import type { BubbleTranscript } from "./bubble-transcript.ts";

export interface CommittedBubble {
  seq: number;
  messageId: string | null;
  transcript: BubbleTranscript;
}
export function projectCommittedBubble(entries: TimelineEntry[]): CommittedBubble | null {
  const ordered = entries.toSorted((left, right) => left.seq - right.seq);
  const latest = ordered.findLast((entry) => entry.role === "assistant" &&
    (entry.parts?.some((part) => part.type === "text" && part.text.trim()) ?? entry.content.trim().length > 0));
  if (!latest) return null;
  const presentation = latest.presentation;
  const rows = presentation ? ordered.filter((entry) => entry.presentation?.messageId === presentation.messageId) : [latest];
  if (presentation && (rows.length !== presentation.entryCount
    || rows.some((entry, index) => entry.presentation?.entryIndex !== index))) return null;
  const items = projectCanonicalTimeline(rows).flatMap((item) => item.kind === "text" && item.role === "assistant"
    ? [{ key: item.key, order: item.order, kind: "text" as const, text: item.text, committed: item.committed }] : []);
  return items.length ? { seq: Math.max(...rows.map((entry) => entry.seq)), messageId: presentation?.messageId ?? null,
    transcript: { key: presentation?.messageId ?? `timeline:${latest.id}`, items } } : null;
}

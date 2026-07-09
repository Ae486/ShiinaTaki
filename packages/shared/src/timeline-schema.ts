/**
 * INPUT:  candidate timeline.* params/event payloads (parsed WS frames + repo rows)
 * OUTPUT: TIMELINE_METHODS + TimelineEntry/History/Subscribe/Appended schemas (append-only conversation log)
 * POS:    shared/protocol — the timeline persistence contract (ADR 0005, invariants 3, 7); core repo + server + CLI
 */
import { z } from "zod";

export const TIMELINE_METHODS = {
  history: "timeline.history",
  subscribe: "timeline.subscribe",
  appended: "timeline.appended",
} as const;

/** A timeline row's authorship — deliberately distinct from the connect Role (operator|node). */
export const TimelineRoleSchema = z.enum(["user", "assistant"]);
export type TimelineRole = z.infer<typeof TimelineRoleSchema>;

// seq is the append order (INTEGER PRIMARY KEY AUTOINCREMENT), always >= 1; it is the paging cursor.
export const TimelineEntrySchema = z.object({
  seq: z.int().positive(),
  id: z.uuid(),
  characterId: z.string().min(1),
  role: TimelineRoleSchema,
  content: z.string(),
  createdAt: z.string().min(1),
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

export const TIMELINE_HISTORY_LIMIT_DEFAULT = 50;
export const TIMELINE_HISTORY_LIMIT_MAX = 200;

export const TimelineHistoryParamsSchema = z.object({
  characterId: z.string().min(1),
  // Exclusive seq cursor: return entries with seq < before. Omitted = newest page.
  before: z.int().positive().optional(),
  limit: z.int().min(1).max(TIMELINE_HISTORY_LIMIT_MAX).default(TIMELINE_HISTORY_LIMIT_DEFAULT),
});
export type TimelineHistoryParams = z.infer<typeof TimelineHistoryParamsSchema>;

export const TimelineHistoryResultSchema = z.object({
  // Newest-first page; nextBefore is the cursor for the next (older) page, or null at the end.
  entries: z.array(TimelineEntrySchema),
  nextBefore: z.int().positive().nullable(),
});
export type TimelineHistoryResult = z.infer<typeof TimelineHistoryResultSchema>;

export const TimelineSubscribeParamsSchema = z.object({
  characterId: z.string().min(1),
});
export type TimelineSubscribeParams = z.infer<typeof TimelineSubscribeParamsSchema>;

export const TimelineSubscribeResultSchema = z.object({
  status: z.literal("ok"),
});
export type TimelineSubscribeResult = z.infer<typeof TimelineSubscribeResultSchema>;

// The timeline.appended push payload is exactly the committed entry.
export const TimelineAppendedSchema = TimelineEntrySchema;
export type TimelineAppended = z.infer<typeof TimelineAppendedSchema>;

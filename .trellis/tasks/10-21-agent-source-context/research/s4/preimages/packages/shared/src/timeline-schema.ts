/**
 * INPUT:  candidate timeline.* params/event payloads (parsed WS frames + repo rows)
 * OUTPUT: canonical timeline rows, optional stable presentation references, and atomic turn-commit notifications
 * POS:    shared/protocol — the timeline persistence contract (ADR 0005, invariants 3, 7); core repo + server + CLI
 */
import { z } from "zod";
import { IMAGE_MEDIA_TYPES } from "./chat-schema.ts";
import { getValidToolDisplayName } from "./tool-presentation.ts";
import { readTimelinePresentation, sanitizeTimelinePresentations } from "./timeline-presentation-schema.ts";
import { ToolSourceMaterialSchema } from "./context-source-schema.ts";

export const TIMELINE_METHODS = {
  history: "timeline.history",
  subscribe: "timeline.subscribe",
  appended: "timeline.appended",
  removed: "timeline.removed",
  committed: "timeline.committed",
} as const;

/** A timeline row's authorship — deliberately distinct from the connect Role (operator|node). */
export const TimelineRoleSchema = z.enum(["user", "assistant", "tool"]);
export type TimelineRole = z.infer<typeof TimelineRoleSchema>;

// A tool-result's output, mirroring AI SDK v7 ToolResultOutput (a tagged union: json/text/execution-denied/...).
// Loose + optional value: variants like execution-denied carry `reason` and no `value`; every field must survive
// the DB round-trip for faithful model replay. `content` on the entry stays the readable text projection.
export const TimelineToolOutputSchema = z.looseObject({
  type: z.string().min(1),
  value: z.unknown().optional(),
});
export type TimelineToolOutput = z.infer<typeof TimelineToolOutputSchema>;

// Old rows and malformed optional labels remain readable; canonical tool identity/output still validate strictly.
const OptionalToolDisplayNameSchema = z.preprocess(getValidToolDisplayName, z.string().optional());

// Structured multi-part fidelity for model replay + the M4 chat-window tool cards. Mirrors AI SDK v7 part shapes
// (v7 field names: `input` on the call, `output` on the result). A row's `parts` replaces its text projection when
// replayed to the model; null/absent = a legacy text-only row (read via `content`).
export const TimelinePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    displayName: OptionalToolDisplayNameSchema,
    input: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("tool-result"),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    displayName: OptionalToolDisplayNameSchema,
    output: TimelineToolOutputSchema,
    sourceMaterials: z.array(ToolSourceMaterialSchema).max(200).refine(
      (items) => new Set(items.map((item) => item.key)).size === items.length, "material keys must be unique").optional(),
  }),
  // The image/file part (#17, advances D14): `ref` is a workspace-relative attachment path (attachments/<sha256>.<ext>),
  // never bytes — the model replays the row's TEXT projection; the chat window fetches bytes lazily via media.get.
  z.object({
    type: z.literal("image"),
    mediaType: z.enum(IMAGE_MEDIA_TYPES),
    ref: z.string().min(1),
  }),
]);
export type TimelinePart = z.infer<typeof TimelinePartSchema>;

// seq is the append order (INTEGER PRIMARY KEY AUTOINCREMENT), always >= 1; it is the paging cursor.
const TimelineRowSchema = z.object({
  seq: z.int().positive(),
  id: z.uuid(),
  characterId: z.string().min(1),
  role: TimelineRoleSchema,
  content: z.string(),
  // Additive, backward-compatible: absent on legacy text-only rows; present carries full model-replay fidelity.
  parts: z.array(TimelinePartSchema).optional(),
  createdAt: z.string().min(1),
  presentation: z.unknown().optional(),
});
export const TimelineEntrySchema = TimelineRowSchema.transform(({ presentation: candidate, ...row }) => {
  const presentation = readTimelinePresentation(candidate, row);
  return { ...row, ...(presentation ? { presentation } : {}) };
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

export const TimelineCommittedSchema = z.strictObject({
  characterId: z.string().min(1),
  messageId: z.string().min(1),
  activitySeq: z.int().nonnegative(),
  entries: z.array(TimelineEntrySchema),
}).superRefine((batch, ctx) => {
  const seqs = new Set<number>();
  for (const [index, entry] of batch.entries.entries()) {
    const view = "presentation" in entry ? entry.presentation : undefined;
    if (entry.characterId !== batch.characterId || seqs.has(entry.seq) || !view
      || view.messageId !== batch.messageId || view.activitySeq !== batch.activitySeq
      || view.entryCount !== batch.entries.length || view.entryIndex !== index) {
      ctx.addIssue({ code: "custom", message: "incomplete or inconsistent timeline batch" });
    }
    seqs.add(entry.seq);
  }
}).transform((batch) => ({ ...batch, entries: sanitizeTimelinePresentations(batch.entries) }));
export type TimelineCommitted = z.infer<typeof TimelineCommittedSchema>;

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
}).transform((page) => ({ ...page, entries: sanitizeTimelinePresentations(page.entries) }));
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

// The timeline.removed push (cancel-retract, M4 closeout): the coordinates of a row deleted from the log. The
// operator UI drops the entry with this seq. Operator-only push, no Rust mirror — sibling of timeline.appended.
export const TimelineRemovedSchema = z.object({
  characterId: z.string().min(1),
  seq: z.int().positive(),
});
export type TimelineRemoved = z.infer<typeof TimelineRemovedSchema>;

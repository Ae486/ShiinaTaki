/**
 * INPUT:  optional Timeline view metadata and the canonical row it references
 * OUTPUT: validated batch links and consistent item references; bad reference maps degrade to canonical content
 * POS:    shared/protocol — optional presentation only; valid batch linkage survives reference corruption for handoff
 */
import { z } from "zod";
import { ChatActivityMessageSchema, ChatActivityOutcomeSchema } from "./chat-activity-schema.ts";

const ReferenceSchema = z.strictObject({ itemId: z.string().min(1), order: z.int().nonnegative() });
export const TimelineTextReferenceSchema = ReferenceSchema.extend({
  kind: z.literal("text"),
  partIndex: z.int().nonnegative().optional(),
  // UTF-16 offsets reference existing text; they also preserve a tool boundary inside one SDK text part.
  start: z.int().nonnegative(),
  end: z.int().positive(),
}).refine((ref) => ref.end > ref.start, "empty text reference");
export const TimelineToolReferenceSchema = ReferenceSchema.extend({
  kind: z.literal("tool"), partIndex: z.int().nonnegative(),
  outcome: ChatActivityOutcomeSchema.optional(),
  message: ChatActivityMessageSchema.optional(),
  durationMs: z.number().finite().nonnegative().optional(),
});
export const TimelineItemReferenceSchema = z.discriminatedUnion("kind", [TimelineTextReferenceSchema, TimelineToolReferenceSchema]);
export type TimelineItemReference = z.infer<typeof TimelineItemReferenceSchema>;
export type TimelineTextReference = z.infer<typeof TimelineTextReferenceSchema>;
export type TimelineToolReference = z.infer<typeof TimelineToolReferenceSchema>;

const BatchHeaderSchema = z.strictObject({
  schemaVersion: z.literal("timeline-presentation.v1"),
  messageId: z.string().min(1),
  entryIndex: z.int().nonnegative(),
  entryCount: z.int().positive(),
  activitySeq: z.int().nonnegative(),
});
export const TimelinePresentationSchema = BatchHeaderSchema.extend({
  references: z.array(TimelineItemReferenceSchema),
}).refine((value) => value.entryIndex < value.entryCount, "invalid batch position");
export type TimelinePresentation = z.infer<typeof TimelinePresentationSchema>;
const ReadBatchHeaderSchema = BatchHeaderSchema.extend({ references: z.unknown().optional() })
  .refine((value) => value.entryIndex < value.entryCount, "invalid batch position");

interface ReferencedRow {
  role: string;
  content: string;
  parts?: readonly { type: string; text?: string; toolCallId?: string; toolName?: string }[];
}

interface ItemBinding {
  kind: TimelineItemReference["kind"];
  order: number;
  tool?: { toolCallId: string; toolName: string; parts: Set<string> };
}
interface ReferenceBindings {
  items: Map<string, ItemBinding>;
  orders: Map<number, string>;
}

function referenceBindings(): ReferenceBindings { return { items: new Map(), orders: new Map() }; }

export function validTimelinePresentation(value: unknown, row: ReferencedRow): TimelinePresentation | undefined {
  const parsed = TimelinePresentationSchema.safeParse(value);
  if (!parsed.success || row.role === "user") return undefined;
  const occupied = new Map<number, Array<{ start: number; end: number }>>();
  const bindings = referenceBindings();
  for (const ref of parsed.data.references) {
    if (!bindReference(bindings, ref, row)) return undefined;
    const index = ref.partIndex ?? -1;
    const part = ref.partIndex === undefined ? undefined : row.parts?.[ref.partIndex];
    if (ref.kind === "tool") {
      if (!part || (part.type !== "tool-call" && part.type !== "tool-result") || occupied.has(index)) return undefined;
      occupied.set(index, [{ start: 0, end: 1 }]);
      continue;
    }
    const text = ref.partIndex === undefined ? (row.parts?.length ? undefined : row.content) : part?.type === "text" ? part.text : undefined;
    if (typeof text !== "string" || ref.end > text.length) return undefined;
    const ranges = occupied.get(index) ?? [];
    if (ranges.some((range) => ref.start < range.end && ref.end > range.start)) return undefined;
    ranges.push({ start: ref.start, end: ref.end });
    occupied.set(index, ranges);
  }
  return parsed.data;
}

/** The producer stays strict; a read discards bad references without losing independently valid batch coverage. */
export function readTimelinePresentation(value: unknown, row: ReferencedRow): TimelinePresentation | undefined {
  const valid = validTimelinePresentation(value, row);
  if (valid || row.role === "user") return valid;
  const header = ReadBatchHeaderSchema.safeParse(value);
  return header.success ? { ...header.data, references: [] } : undefined;
}

function bindReference(bindings: ReferenceBindings, ref: TimelineItemReference, row: ReferencedRow): boolean {
  const existing = bindings.items.get(ref.itemId);
  const orderedItem = bindings.orders.get(ref.order);
  if ((orderedItem !== undefined && orderedItem !== ref.itemId)
    || (existing && (existing.kind !== ref.kind || existing.order !== ref.order))) return false;
  let tool: ItemBinding["tool"];
  if (ref.kind === "tool") {
    const part = row.parts?.[ref.partIndex];
    if (!part || (part.type !== "tool-call" && part.type !== "tool-result")
      || part.toolCallId === undefined || part.toolName === undefined) return false;
    const previous = existing?.tool;
    if (previous && (previous.toolCallId !== part.toolCallId || previous.toolName !== part.toolName
      || previous.parts.has(part.type))) return false;
    tool = { toolCallId: part.toolCallId, toolName: part.toolName, parts: new Set(previous?.parts).add(part.type) };
  }
  bindings.items.set(ref.itemId, { kind: ref.kind, order: ref.order, ...(tool ? { tool } : {}) });
  bindings.orders.set(ref.order, ref.itemId);
  return true;
}

/** Also runs after pages are joined: a conflict can straddle individually valid history pages. */
export function sanitizeTimelinePresentations<Entry extends ReferencedRow & {
  characterId: string; presentation?: TimelinePresentation;
}>(entries: readonly Entry[]): Entry[] {
  const groups = new Map<string, ReferenceBindings>();
  const invalid = new Set<string>();
  for (const entry of entries) {
    const view = entry.presentation;
    if (!view) continue;
    const key = JSON.stringify([entry.characterId, view.messageId]);
    if (invalid.has(key)) continue;
    const bindings = groups.get(key) ?? referenceBindings();
    groups.set(key, bindings);
    // Partial tool identity cannot safely join an unreferenced call to a referenced result. Use one conservative
    // canonical projection for the batch instead; unreferenced ordinary text remains independently readable.
    if (hasUnreferencedTool(entry, view) || view.references.some((ref) => !bindReference(bindings, ref, entry))) invalid.add(key);
  }
  return entries.map((entry) => {
    const view = entry.presentation;
    if (!view || !invalid.has(JSON.stringify([entry.characterId, view.messageId]))) return entry;
    return { ...entry, presentation: { ...view, references: [] } };
  });
}

function hasUnreferencedTool(row: ReferencedRow, view: TimelinePresentation): boolean {
  const referenced = new Set(view.references.flatMap((ref) => ref.kind === "tool" ? [ref.partIndex] : []));
  return row.parts?.some((part, index) => (part.type === "tool-call" || part.type === "tool-result") && !referenced.has(index)) ?? false;
}

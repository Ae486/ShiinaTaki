/**
 * INPUT:  foreground-turn activity notifications and read-only recovery snapshots
 * OUTPUT: ordered language/tool schemas, truthful phases/outcomes, and explicit bounded-recovery states
 * POS:    shared/protocol — disposable Chat/Pet presentation only; never an execution or replay authority
 */
import { z } from "zod";
import { getValidToolDisplayName } from "./tool-presentation.ts";

export const CHAT_ACTIVITY_MAX_ITEMS = 512;
export const CHAT_ACTIVITY_MAX_TEXT_BYTES = 1_048_576;

export const ChatActivityOutcomeSchema = z.enum(["completed", "failed", "cancelled", "outcome_unknown"]);
export type ChatActivityOutcome = z.infer<typeof ChatActivityOutcomeSchema>;
export const ChatActivityPhaseSchema = z.enum(["received", "processing", "approval", "executing"]);
export type ChatActivityPhase = z.infer<typeof ChatActivityPhaseSchema>;

// Explanations come from Core's existing safe summaries/closed classification, never a raw exception or payload.
export const ChatActivityMessageSchema = z.string().min(1).max(240);
export const ChatActivityTerminalSchema = z.strictObject({
  outcome: ChatActivityOutcomeSchema,
  message: ChatActivityMessageSchema.optional(),
});
export type ChatActivityTerminal = z.infer<typeof ChatActivityTerminalSchema>;

const IdentitySchema = z.strictObject({
  characterId: z.string().min(1),
  messageId: z.string().min(1),
  runId: z.string().min(1).optional(),
  attemptId: z.string().min(1).optional(),
});
export type ChatActivityIdentity = z.infer<typeof IdentitySchema>;
const EnvelopeSchema = IdentitySchema.extend({ seq: z.int().positive() });
const ItemIdentitySchema = z.strictObject({ itemId: z.string().min(1), order: z.int().nonnegative() });
const ToolIdentitySchema = ItemIdentitySchema.extend({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  displayName: z.preprocess(getValidToolDisplayName, z.string().optional()),
});
const ToolTerminalSchema = ChatActivityTerminalSchema.extend({ durationMs: z.number().finite().nonnegative().optional() });

export const ChatActivityToolStatusSchema = z.discriminatedUnion("phase", [
  z.strictObject({ phase: ChatActivityPhaseSchema }),
  ToolTerminalSchema.extend({ phase: z.literal("settled") }),
]);
export type ChatActivityToolStatus = z.infer<typeof ChatActivityToolStatusSchema>;
export const ChatActivityTextItemSchema = ItemIdentitySchema.extend({ kind: z.literal("text"), text: z.string() });
export const ChatActivityToolItemSchema = ToolIdentitySchema.extend({
  kind: z.literal("tool"),
  status: ChatActivityToolStatusSchema,
});
export const ChatActivityItemSchema = z.discriminatedUnion("kind", [ChatActivityTextItemSchema, ChatActivityToolItemSchema]);
export type ChatActivityTextItem = z.infer<typeof ChatActivityTextItemSchema>;
export type ChatActivityToolItem = z.infer<typeof ChatActivityToolItemSchema>;
export type ChatActivityItem = z.infer<typeof ChatActivityItemSchema>;

export const ChatActivitySchema = z.discriminatedUnion("kind", [
  EnvelopeSchema.extend({ kind: z.literal("turn.started") }),
  EnvelopeSchema.extend({
    kind: z.literal("text.delta"), ...ItemIdentitySchema.shape, delta: z.string().min(1),
  }),
  EnvelopeSchema.extend({ kind: z.literal("tool.received"), ...ToolIdentitySchema.shape }),
  EnvelopeSchema.extend({
    kind: z.literal("tool.phase"), itemId: z.string().min(1), phase: ChatActivityPhaseSchema,
  }),
  EnvelopeSchema.extend({
    kind: z.literal("tool.terminal"), itemId: z.string().min(1), ...ToolTerminalSchema.shape,
  }),
  EnvelopeSchema.extend({ kind: z.literal("turn.terminal"), ...ChatActivityTerminalSchema.shape }),
]);
export type ChatActivity = z.infer<typeof ChatActivitySchema>;

export const ChatActivityReadParamsSchema = z.strictObject({ characterId: z.string().min(1) });
export type ChatActivityReadParams = z.infer<typeof ChatActivityReadParamsSchema>;

const SnapshotSchema = IdentitySchema.extend({
  seq: z.int().nonnegative(),
  items: z.array(ChatActivityItemSchema).max(CHAT_ACTIVITY_MAX_ITEMS),
});
export const ChatActivityReadResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("idle"), characterId: z.string().min(1) }),
  SnapshotSchema.extend({ status: z.literal("active") }),
  SnapshotSchema.extend({ status: z.literal("terminal"), ...ChatActivityTerminalSchema.shape }),
  IdentitySchema.extend({
    status: z.literal("unavailable"), seq: z.int().nonnegative(), reason: z.literal("capacity"),
    terminal: ChatActivityTerminalSchema.optional(),
  }),
]).superRefine((snapshot, ctx) => {
  if (!("items" in snapshot)) return;
  const keys = new Set<string>();
  const orders = new Set<number>();
  let bytes = 0;
  for (const item of snapshot.items) {
    if (keys.has(item.itemId) || orders.has(item.order)) ctx.addIssue({ code: "custom", message: "duplicate activity item" });
    keys.add(item.itemId);
    orders.add(item.order);
    bytes += chatActivityItemTextBytes(item);
  }
  if ("message" in snapshot) bytes += utf8TextBytes(snapshot.message ?? "");
  if (bytes > CHAT_ACTIVITY_MAX_TEXT_BYTES) ctx.addIssue({ code: "custom", message: "activity snapshot exceeds text budget" });
});
export type ChatActivityReadResult = z.infer<typeof ChatActivityReadResultSchema>;

const encoder = new TextEncoder();
export function utf8TextBytes(value: string): number {
  return encoder.encode(value).byteLength;
}

/** UTF-8 size delta without re-encoding an accumulated reply, including a split surrogate pair. */
export function appendedUtf8TextBytes(previous: string, delta: string): number {
  const joinsSurrogate = /[\uD800-\uDBFF]$/.test(previous) && /^[\uDC00-\uDFFF]/.test(delta);
  return utf8TextBytes(delta) - (joinsSurrogate ? 2 : 0);
}

export function chatActivityItemTextBytes(item: ChatActivityItem): number {
  if (item.kind === "text") return utf8TextBytes(item.text);
  return utf8TextBytes(item.displayName ?? "")
    + utf8TextBytes(item.status.phase === "settled" ? item.status.message ?? "" : "");
}

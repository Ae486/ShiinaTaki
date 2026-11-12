/**
 * INPUT: canonical private source references and actual child activity observations
 * OUTPUT: ordered pageable conversation entries and isolated live recovery contracts
 * POS: shared/protocol — read-only private Chat surface, never Timeline or execution authority
 */
import { z } from "zod";
import { SubagentInputSchema } from "./subagent-schema.ts";
import { SubagentEventSchema } from "./subagent-inbox-schema.ts";
import { SubagentSummarySchema } from "./subagent-api-schema.ts";
import { RunMessageSchema } from "./run-message-schema.ts";
import { ChatActivitySchema, ChatActivityReadResultSchema } from "./chat-activity-schema.ts";
import { TimelineItemReferenceSchema } from "./timeline-presentation-schema.ts";

const Id = z.string().min(1).max(200);
const Cursor = z.strictObject({ subagentId: z.uuid(), seq: z.int().nonnegative() });
export const SubagentConversationParamsSchema = z.strictObject({
  characterId: Id, subagentId: z.uuid(), workInputId: z.uuid().optional(), cursor: Cursor.optional(),
  direction: z.enum(["newest", "older", "newer"]).default("newest"), limit: z.int().min(1).max(100).default(50),
});
const Entry = z.strictObject({ seq: z.int().positive(), subagentId: z.uuid(), workInputId: z.uuid(),
  historicalOrder: z.boolean(), createdAt: z.iso.datetime({ offset: true }),
  presentation: z.strictObject({ messageId: Id, references: z.array(TimelineItemReferenceSchema) }).optional(),
  batch: z.strictObject({ runId: Id, attemptId: Id, stepNumber: z.int().nonnegative(),
    entrySeqs: z.array(z.int().positive()) }).optional(),
  body: z.strictObject({ digest: z.string().regex(/^[a-f0-9]{64}$/), totalChars: z.int().positive(), nextOffset: z.literal(0) }).optional(),
});
export const SubagentConversationEntrySchema = z.discriminatedUnion("kind", [
  Entry.extend({ kind: z.literal("input"), input: SubagentInputSchema }),
  Entry.extend({ kind: z.literal("message"), message: RunMessageSchema }),
  Entry.extend({ kind: z.literal("event"), event: SubagentEventSchema }),
  Entry.extend({ kind: z.literal("control"), control: z.strictObject({
    origin: z.enum(["user", "parent"]), action: z.literal("stop"), controlVersion: z.int().nonnegative(),
  }) }),
]);
export const SubagentConversationResultSchema = z.strictObject({ conversation: SubagentSummarySchema,
  entries: z.array(SubagentConversationEntrySchema).max(100), nextCursor: Cursor.nullable(), hasMore: z.boolean() });
export const SubagentActivityReadParamsSchema = z.strictObject({ characterId: Id, subagentId: z.uuid() });
export const SubagentActivityReadResultSchema = z.strictObject({
  subagentId: z.uuid(), workInputId: z.uuid().nullable(), activity: ChatActivityReadResultSchema,
  coveredThroughStep: z.int().min(-1), itemSteps: z.array(z.strictObject({ itemId: Id, stepNumber: z.int().nonnegative() })).max(512),
});
export const SubagentActivitySchema = z.strictObject({ subagentId: z.uuid(), workInputId: z.uuid(), activity: ChatActivitySchema });
export const SubagentActivitySubscribeParamsSchema = SubagentActivityReadParamsSchema;
export const SubagentConversationBodyParamsSchema = z.strictObject({ characterId: Id, subagentId: z.uuid(),
  seq: z.int().positive(), offset: z.int().nonnegative().default(0), limit: z.int().min(1).max(12_000).default(12_000),
  digest: z.string().regex(/^[a-f0-9]{64}$/).optional() });
export const SubagentConversationBodyResultSchema = z.strictObject({ seq: z.int().positive(),
  digest: z.string().regex(/^[a-f0-9]{64}$/), body: z.string().max(12_000), offset: z.int().nonnegative(),
  nextOffset: z.int().nonnegative().nullable(), complete: z.boolean() });
export type SubagentConversationBodyParams = z.input<typeof SubagentConversationBodyParamsSchema>;
export type SubagentConversationBodyResult = z.infer<typeof SubagentConversationBodyResultSchema>;
export type SubagentConversationParams = z.input<typeof SubagentConversationParamsSchema>;
export type SubagentConversationResult = z.infer<typeof SubagentConversationResultSchema>;
export type SubagentConversationEntry = z.infer<typeof SubagentConversationEntrySchema>;
export type SubagentActivityReadResult = z.infer<typeof SubagentActivityReadResultSchema>;
export type SubagentActivity = z.infer<typeof SubagentActivitySchema>;

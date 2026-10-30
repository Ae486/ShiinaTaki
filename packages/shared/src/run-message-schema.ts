/**
 * INPUT: visible private work messages and exact model-intent insertion coordinates
 * OUTPUT: typed durable message/receipt rows, separate from the relationship Timeline
 * POS: shared/protocol — native part fidelity and queryable private execution evidence
 */
import { z } from "zod";
import { TimelinePartSchema, TimelineRoleSchema } from "./timeline-schema.ts";
import { SourceContextSchema } from "./context-source-schema.ts";

const Id = z.string().min(1).max(200);
export const PrivateMessageSchema = z.strictObject({
  role: TimelineRoleSchema, content: z.string().max(1_000_000),
  parts: z.array(TimelinePartSchema).max(2000).optional(),
  sourceContext: SourceContextSchema.optional(),
});
export type PrivateMessage = z.infer<typeof PrivateMessageSchema>;
export const RunMessageBatchSchema = z.strictObject({
  stepNumber: z.int().nonnegative(), entryKind: z.enum(["output", "partial"]),
  messages: z.array(PrivateMessageSchema).max(2000),
});
export type RunMessageBatch = z.infer<typeof RunMessageBatchSchema>;
export const RunMessageSchema = PrivateMessageSchema.extend({
  seq: z.int().positive(), runId: Id, attemptId: Id, stepNumber: z.int().nonnegative(),
  messageIndex: z.int().nonnegative(), entryKind: z.enum(["input", "output", "partial"]),
  inputId: z.uuid().nullable(), modelEffectId: Id.nullable(),
  modelInputDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
}).superRefine((row, ctx) => {
  if ((row.entryKind === "input") !== (row.inputId !== null && row.modelEffectId !== null && row.modelInputDigest !== null)) {
    ctx.addIssue({ code: "custom", message: "input receipt requires exact input and model Effect" });
  }
  if (row.entryKind === "partial" && (row.role !== "assistant" || row.parts)) {
    ctx.addIssue({ code: "custom", message: "partial rows contain observed assistant text only" });
  }
});
export type RunMessage = z.infer<typeof RunMessageSchema>;

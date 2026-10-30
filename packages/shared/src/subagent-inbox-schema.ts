/**
 * INPUT: durable worker events and addressed main-consumer actions
 * OUTPUT: private inbox evidence, explicit input waits and bounded tool contracts
 * POS: shared/protocol — descriptive lifecycle facts; never executable authority or public speech
 */
import { z } from "zod";
import { SourceContextSchema } from "./context-source-schema.ts";
import { SubagentTargetSchema } from "./subagent-schema.ts";

const Id = z.string().min(1).max(200);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
export const SubagentInteractionSchema = z.strictObject({
  kind: z.enum(["message", "needs_input"]), text: z.string().min(1).max(1_000_000),
});
export type SubagentInteraction = z.infer<typeof SubagentInteractionSchema>;
export const SubagentEventSchema = z.strictObject({
  eventId: Id, seq: z.int().positive(), characterId: Id, subagentId: z.uuid(), workInputId: z.uuid(),
  kind: z.enum(["message", "needs_input", "final", "interrupted"]),
  producerRunId: Id, producerAttemptId: Id, producerKey: Id, body: z.string().max(1_000_000).nullable(),
  bodyDigest: Digest, sourceContext: SourceContextSchema,
  throughWorkSeq: z.int().positive().nullable(),
  acceptedAt: z.iso.datetime({ offset: true }), eligible: z.boolean(), suppressionReason: Id.nullable(),
  state: z.enum(["accepted", "delivered", "handled"]), reconciliationNeeded: z.boolean(),
});
export type SubagentEvent = z.infer<typeof SubagentEventSchema>;
export const SubagentInputWaitSchema = z.strictObject({
  eventId: Id, workInputId: z.uuid(), state: z.enum(["open", "answered"]), answerInputId: z.uuid().nullable(),
});
export type SubagentInputWait = z.infer<typeof SubagentInputWaitSchema>;
export const SubagentInboxActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("answered_child"), target: SubagentTargetSchema,
    replyToEventId: Id.nullable(), direction: z.string().min(1).max(1_000_000) }),
  z.strictObject({ kind: z.enum(["retained", "no_action", "needs_user_input", "speech_proposed"]),
    note: z.string().max(1_000_000) }),
]);
export type SubagentInboxAction = z.infer<typeof SubagentInboxActionSchema>;
export const SubagentHandleEventToolSchema = z.strictObject({
  eventId: Id, operationKey: Id, action: SubagentInboxActionSchema,
});
export const SubagentReadInboxToolSchema = z.strictObject({
  eventId: Id, offset: z.int().nonnegative(), limit: z.int().min(1).max(16_000), detail: z.enum(["event", "action"]).optional(),
});
export const SubagentInboxRecoveryParamsSchema = z.strictObject({ characterId: Id, afterId: Id.optional(), limit: z.int().min(1).max(50).default(20) });
export type SubagentInboxRecoveryParams = z.input<typeof SubagentInboxRecoveryParamsSchema>;
export const SubagentInboxRecoveryResultSchema = z.strictObject({ entries: z.array(z.strictObject({ consumerId: Id, runId: Id,
  reason: Id, canResume: z.boolean(), events: z.array(z.strictObject({ eventId: Id, kind: SubagentEventSchema.shape.kind,
    state: SubagentEventSchema.shape.state })).max(8),
  actions: z.array(z.strictObject({ eventId: Id, operationKey: Id, kind: Id, result: z.string().max(2000), resultComplete: z.boolean() })).max(8),
})).max(50), nextCursor: Id.nullable() });
export const SubagentInboxResumeParamsSchema = z.strictObject({ characterId: Id, consumerId: Id, operationKey: z.string().min(1).max(100) });
export type SubagentInboxResumeParams = z.infer<typeof SubagentInboxResumeParamsSchema>;
export const SubagentInboxResumeResultSchema = z.strictObject({ consumerId: Id, runId: Id, reused: z.boolean(),
  state: z.enum(["claimed", "delivered", "reconciliation_needed", "settled", "released"]) });
export type SubagentInboxRecoveryResult = z.infer<typeof SubagentInboxRecoveryResultSchema>;
export type SubagentInboxResumeResult = z.infer<typeof SubagentInboxResumeResultSchema>;

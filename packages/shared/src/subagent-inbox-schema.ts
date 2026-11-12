/**
 * INPUT: durable worker events and addressed main-consumer actions
 * OUTPUT: private inbox evidence, explicit input waits and flat model handling intents
 * POS: shared/protocol — descriptive lifecycle facts; never executable authority or public speech
 */
import { z } from "zod";
import { SourceContextSchema } from "./context-source-schema.ts";
import { SubagentTargetSchema } from "./subagent-schema.ts";
import { SubagentCheckInSchema } from "./subagent-progress-schema.ts";

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
  reason: z.enum(["question", "check_in"]).default("question"), checkIn: SubagentCheckInSchema.nullable().default(null),
}).refine((wait) => (wait.reason === "check_in") === (wait.checkIn !== null), "Check-in waits require their runtime sidecar");
export type SubagentInputWait = z.infer<typeof SubagentInputWaitSchema>;
export const SubagentInboxActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("continue_child"), target: SubagentTargetSchema,
    replyToEventId: Id, direction: z.string().max(1_000_000) }),
  z.strictObject({ kind: z.literal("answered_child"), target: SubagentTargetSchema,
    replyToEventId: Id.nullable(), direction: z.string().min(1).max(1_000_000) }),
  z.strictObject({ kind: z.enum(["retained", "no_action", "needs_user_input", "speech_proposed"]),
    note: z.string().max(1_000_000) }),
]);
export type SubagentInboxAction = z.infer<typeof SubagentInboxActionSchema>;
export const SubagentHandleEventToolSchema = z.strictObject({
  eventId: Id.describe("The exact delivered inbox event to handle."),
  intent: z.enum(["record", "ask_user", "reply", "answer_child", "continue_child"])
    .describe("Record evidence, ask the user, propose a public reply, reply privately to the child, or approve its check-in."),
  text: z.string().max(1_000_000).describe("Complete answer/question, private record note, or optional check-in direction."),
  target: SubagentTargetSchema.required({ expectedRunId: true }).nullable()
    .describe("Copy the complete current target for answer_child/continue_child; otherwise use null."),
}).refine((value) => (value.intent === "answer_child" || value.intent === "continue_child") === (value.target !== null),
  { path: ["target"], message: "Child actions require the exact target; record, ask_user and reply require null." })
  .refine((value) => value.intent === "record" || value.intent === "continue_child" || value.text.trim().length > 0,
    { path: ["text"], message: "Questions and answers require meaningful text." });
export type SubagentHandleEventToolInput = z.infer<typeof SubagentHandleEventToolSchema>;
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

/**
 * INPUT: explicit delegated work, immutable selected context and exact addressed controls
 * OUTPUT: work-scoped input, conversation and captured-token schemas
 * POS: shared/protocol — durable addressing facts, never a second permission or Run authority
 */
import { z } from "zod";
import { ContextMaterialSchema } from "./context-source-schema.ts";
import { PrivateMessageSchema } from "./run-message-schema.ts";

const Id = z.string().min(1).max(200);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Materials = z.array(ContextMaterialSchema).max(200).refine(
  (items) => new Set(items.map((item) => item.key)).size === items.length, "material keys must be unique");
export const SubagentToolSelectionSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("allow"), names: z.array(Id).max(2000) }),
  z.strictObject({ mode: z.literal("inherit"), excludeNames: z.array(Id).max(2000) }),
]);
export type SubagentToolSelection = z.infer<typeof SubagentToolSelectionSchema>;
export const SubagentInitialContextSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("fresh") }),
  z.strictObject({ kind: z.literal("snapshot"), messages: z.array(PrivateMessageSchema).max(2000), materials: Materials }),
]);
export type SubagentInitialContext = z.infer<typeof SubagentInitialContextSchema>;
export const SubagentTargetSchema = z.strictObject({
  subagentId: z.uuid(), workInputId: z.uuid(), expectedRunId: Id.optional(), expectedControlVersion: z.int().nonnegative(),
});
export type SubagentTarget = z.infer<typeof SubagentTargetSchema>;
export const SubagentWorkTokenSchema = z.strictObject({
  subagentId: z.uuid(), workInputId: z.uuid(), throughWorkSeq: z.int().positive(), controlVersion: z.int().nonnegative(),
  source: z.strictObject({ ownerRef: Id, revision: Id }).optional(),
});
export type SubagentWorkToken = z.infer<typeof SubagentWorkTokenSchema>;
export const SubagentWorkScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("subagent"), subagentId: z.uuid(), workInputId: z.uuid() }),
  z.strictObject({ kind: z.literal("parent-continuation"), completionId: Id }),
]);
export type SubagentWorkScope = z.infer<typeof SubagentWorkScopeSchema>;
export const SubagentConversationSchema = z.strictObject({
  subagentId: z.uuid(), characterId: Id, createdByRunId: Id, label: z.string().min(1).max(200),
  createdAt: z.iso.datetime({ offset: true }), initialContext: SubagentInitialContextSchema, initialContextDigest: Digest,
  stopOrigin: z.enum(["user", "parent"]).nullable(), controlVersion: z.int().nonnegative(),
  nextInputSeq: z.int().positive(), activeRunId: Id.nullable(),
});
export type SubagentConversation = z.infer<typeof SubagentConversationSchema>;
export const SubagentSenderSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("user") }),
  z.strictObject({ kind: z.literal("parent"), runId: Id }),
  z.strictObject({ kind: z.literal("core"), ownerRef: Id }),
]);
export type SubagentSender = z.infer<typeof SubagentSenderSchema>;
export const SubagentCompletionPolicySchema = z.enum(["record_only", "request_parent"]);
export const SubagentInputRequestSchema = z.strictObject({
  subagentId: z.uuid(), operationKey: Id, sender: SubagentSenderSchema,
  direction: z.string().max(1_000_000), materials: Materials,
  input: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("work"), completionPolicy: SubagentCompletionPolicySchema,
      lifetimeMinutes: z.int().min(5).max(720), toolSelection: SubagentToolSelectionSchema.optional() }),
    z.strictObject({ kind: z.literal("message"), workInputId: z.uuid(), expectedControlVersion: z.int().nonnegative(), expectedRunId: Id.optional() }),
    z.strictObject({ kind: z.literal("continue"), workInputId: z.uuid(), expectedControlVersion: z.int().nonnegative() }),
  ]),
});
export type SubagentInputRequest = z.infer<typeof SubagentInputRequestSchema>;
export const SubagentReplyAcceptanceSchema = z.strictObject({
  characterId: Id, workInputId: z.uuid(), primaryRunId: Id, primaryAttemptId: Id,
  userEntryId: z.uuid(), userSeq: z.int().positive(), userContentDigest: Digest,
  originalWording: z.string().max(1_000_000), purpose: z.string().min(1).max(1000),
  acceptedAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }), acceptedRootRunId: Id,
});
export type SubagentReplyAcceptance = z.infer<typeof SubagentReplyAcceptanceSchema>;
export const SubagentInputSchema = z.strictObject({
  inputId: z.uuid(), subagentId: z.uuid(), inputSeq: z.int().positive(), workInputId: z.uuid(), workSeq: z.int().positive(),
  operationKey: Id, requestDigest: Digest, kind: z.enum(["work", "message", "continue"]), sender: SubagentSenderSchema,
  direction: z.string().max(1_000_000), materials: Materials, toolSelection: SubagentToolSelectionSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }), completionPolicy: SubagentCompletionPolicySchema,
  workExpiresAt: z.iso.datetime({ offset: true }),
  consumed: z.strictObject({ runId: Id, attemptId: Id, step: z.int().nonnegative(), effectId: Id }).nullable(),
  replyAcceptance: SubagentReplyAcceptanceSchema.nullable(),
});
export type SubagentInput = z.infer<typeof SubagentInputSchema>;

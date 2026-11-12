/**
 * INPUT: validated work proposals and canonical child/parent Run outcomes
 * OUTPUT: inspectable terminal reports, completion disposition and parent synthesis
 * POS: shared/protocol — no result or descriptive source grants publication authority
 */
import { z } from "zod";
import { RunOutcomeSchema } from "./harness-schema.ts";
import { SourceContextSchema } from "./context-source-schema.ts";
import { SubagentCompletionPolicySchema, SubagentWorkTokenSchema } from "./subagent-schema.ts";

const Id = z.string().min(1).max(200);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Body = z.string().max(1_000_000);
export const SubagentProposalSchema = z.strictObject({
  text: Body, sourceContext: SourceContextSchema.optional(),
  artifact: z.strictObject({ reference: z.string().min(1).max(4000), revision: Id }).optional(),
});
export type SubagentProposal = z.infer<typeof SubagentProposalSchema>;
export const ParentContinuationProposalSchema = z.discriminatedUnion("decision", [
  z.strictObject({ decision: z.literal("internal_result"), text: Body, sourceContext: SourceContextSchema.optional() }),
  z.strictObject({ decision: z.literal("no_action"), reason: z.string().min(1).max(1000),
    text: Body.optional(), sourceContext: SourceContextSchema.optional() }),
  z.strictObject({ decision: z.literal("reply"), text: Body, sourceContext: SourceContextSchema.optional() }),
]);
export type ParentContinuationProposal = z.infer<typeof ParentContinuationProposalSchema>;
export const SubagentCompletionStateSchema = z.enum(["not_requested", "pending", "deferred", "admitted", "withheld"]);
export const SubagentCompletionReasonSchema = z.enum([
  "foreground_busy", "source_unavailable", "authority_unavailable", "superseded", "source_retired", "expired",
]);
export type SubagentCompletionReason = z.infer<typeof SubagentCompletionReasonSchema>;
const TerminalReport = z.strictObject({
  runId: Id, attemptId: Id, outcome: RunOutcomeSchema,
  body: Body.nullable(), outputKind: z.enum(["validated", "unstructured", "partial", "none"]),
  sourceContext: SourceContextSchema, receiptId: Id, settledAt: z.iso.datetime({ offset: true }),
});
export const SubagentResultSchema = TerminalReport.extend({
  subagentId: z.uuid(), workInputId: z.uuid(), throughWorkSeq: z.int().positive(),
  workExpiresAt: z.iso.datetime({ offset: true }),
  currentness: z.enum(["current", "superseded"]),
  artifact: SubagentProposalSchema.shape.artifact,
});
export type SubagentResult = z.infer<typeof SubagentResultSchema>;
export const ParentContinuationResultSchema = TerminalReport.extend({
  decision: z.enum(["internal_result", "no_action", "reply", "unstructured", "none"]),
  reason: z.string().max(1000).optional(),
});
export type ParentContinuationResult = z.infer<typeof ParentContinuationResultSchema>;
export const SubagentPublicationSchema = z.strictObject({
  state: z.enum(["internal_only", "no_action", "pending", "deferred", "refused", "recorded"]),
  reason: z.string().max(1000).optional(), runId: Id.optional(), deliveryId: Id.optional(),
});
export type SubagentPublication = z.infer<typeof SubagentPublicationSchema>;
export const SubagentResultGroupSchema = z.strictObject({
  completionId: Id, child: SubagentResultSchema, childDigest: Digest,
  completionState: SubagentCompletionStateSchema, completionReason: SubagentCompletionReasonSchema.nullable(),
  parentRunId: Id.nullable(), parent: ParentContinuationResultSchema.nullable(), parentDigest: Digest.nullable(),
  publication: SubagentPublicationSchema.nullable(),
});
export type SubagentResultGroup = z.infer<typeof SubagentResultGroupSchema>;
export const SubagentExecutionSchema = z.strictObject({
  runId: Id, subagentId: z.uuid(), workInputId: z.uuid(), triggerInputId: z.uuid(),
  completionPolicy: SubagentCompletionPolicySchema, throughWorkSeq: z.int().positive(), workToken: SubagentWorkTokenSchema,
  proposal: SubagentProposalSchema.nullable(), proposalAttemptId: Id.nullable(), proposalDigest: Digest.nullable(),
  proposalTokenDigest: Digest.nullable(),
  result: SubagentResultSchema.nullable(), resultDigest: Digest.nullable(), settledAt: z.iso.datetime({ offset: true }).nullable(),
  completionState: SubagentCompletionStateSchema, completionReason: SubagentCompletionReasonSchema.nullable(), parentRunId: Id.nullable(),
  parentProposal: ParentContinuationProposalSchema.nullable(), parentProposalAttemptId: Id.nullable(), parentProposalDigest: Digest.nullable(),
  parentResult: ParentContinuationResultSchema.nullable(), parentResultDigest: Digest.nullable(), parentSettledAt: z.iso.datetime({ offset: true }).nullable(),
  publication: SubagentPublicationSchema.nullable(),
});
export type SubagentExecution = z.infer<typeof SubagentExecutionSchema>;

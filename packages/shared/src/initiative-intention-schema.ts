/**
 * INPUT: Core-bound conversation provenance and a finite automatic follow-up proposal
 * OUTPUT: strict Intention plan, source, lifecycle and refusal contracts
 * POS: shared/domain — a one-shot plan is neither a reported event nor a Scheduled Task
 */
import { z } from "zod";

const Id = z.string().min(1).max(200);
const Timestamp = z.iso.datetime({ offset: true });
const Digest = z.string().regex(/^[a-f0-9]{64}$/);

export const InitiativeIntentionPlanSchema = z.strictObject({
  purpose: z.string().trim().min(1).max(1000)
    .describe("The bounded reason to consider one later follow-up, not prewritten dialogue or an asserted outcome."),
  notBefore: Timestamp.describe("Inclusive absolute follow-up window start, with UTC offset. This is a plan, not an event fact."),
  expiresAt: Timestamp.describe("Exclusive absolute follow-up deadline, with UTC offset. Never extend a previous plan on replay."),
  reportedEventTime: Timestamp.nullable()
    .describe("An ISO timestamp explicitly present in the current user message, or null. Relative or vague timing must remain null; never infer an event instant."),
}).refine((value) => Date.parse(value.notBefore) < Date.parse(value.expiresAt), "The follow-up window must have positive duration.");
export type InitiativeIntentionPlan = z.infer<typeof InitiativeIntentionPlanSchema>;

export const InitiativeIntentionSourceSchema = z.strictObject({
  kind: z.literal("primary_timeline"), characterId: Id, timelineId: Id,
  timelineSeq: z.int().positive(), digest: Digest, runId: Id, attemptId: Id, toolCallId: Id,
});
export type InitiativeIntentionSource = z.infer<typeof InitiativeIntentionSourceSchema>;

export const InitiativeIntentionDispositionSchema = z.enum([
  "silent", "express", "speak", "completed", "failed", "cancelled", "expired", "source_invalidated", "unknown",
]);
export type InitiativeIntentionDisposition = z.infer<typeof InitiativeIntentionDispositionSchema>;

export const InitiativeIntentionSchema = z.strictObject({
  intentionId: Id, characterId: Id, sourceKey: Digest, source: InitiativeIntentionSourceSchema,
  purpose: z.string().min(1).max(1000).nullable(), reportedEventTime: Timestamp.nullable(),
  notBefore: Timestamp, expiresAt: Timestamp,
  state: z.enum(["active", "claimed", "terminal"]),
  canonicalRunKey: z.string().min(1).max(256).nullable(), runId: Id.nullable(),
  disposition: InitiativeIntentionDispositionSchema.nullable(), createdAt: Timestamp, terminalAt: Timestamp.nullable(),
}).refine((value) => Date.parse(value.notBefore) < Date.parse(value.expiresAt)
  && value.characterId === value.source.characterId
  && (value.state === "terminal"
    ? value.disposition !== null && value.terminalAt !== null && value.purpose === null && value.reportedEventTime === null
    : value.disposition === null && value.terminalAt === null && value.purpose !== null)
  && (value.state !== "claimed" || value.canonicalRunKey !== null)
  && (value.state !== "active" || (value.canonicalRunKey === null && value.runId === null))
  && (value.runId === null || value.canonicalRunKey !== null));
export type InitiativeIntention = z.infer<typeof InitiativeIntentionSchema>;

export const InitiativeIntentionRefusalSchema = z.enum([
  "invalid_request", "source_unavailable", "source_stale", "window_too_long", "expired", "capacity", "claim_conflict",
]);
export type InitiativeIntentionRefusal = z.infer<typeof InitiativeIntentionRefusalSchema>;
export const InitiativeIntentionPlanResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.enum(["created", "duplicate"]), intention: InitiativeIntentionSchema }),
  z.strictObject({ status: z.literal("refused"), reason: InitiativeIntentionRefusalSchema }),
]);
export type InitiativeIntentionPlanResult = z.infer<typeof InitiativeIntentionPlanResultSchema>;

/**
 * INPUT: trusted selected-context manifests and model structural decisions
 * OUTPUT: strict bounded initiative execution, delivery and policy facts
 * POS: shared/protocol — payload text stays in ephemeral input or confined delivery storage
 */
import { z } from "zod";

const Id = z.string().min(1).max(200);
const Time = z.string().datetime({ offset: true });
const Version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const InitiativeSourceSchema = z.strictObject({
  category: z.enum(["persona", "memory", "pattern", "intention", "observation", "completion", "time", "companion_state"]),
  reference: Id,
  revision: Id,
  trust: z.enum(["core", "user", "untrusted"]),
});
export const InitiativeContextManifestSchema = z.strictObject({
  version: z.literal("initiative-context.v1"),
  profile: z.literal("initiative-thin"),
  capturedAt: Time,
  expiresAt: Time,
  policyRevision: Id,
  primaryVersion: Version,
  timezoneRevision: Version,
  sources: z.array(InitiativeSourceSchema).min(1).max(32),
  accountingQuality: z.enum(["estimated", "unknown"]),
}).refine((value) => Date.parse(value.expiresAt) > Date.parse(value.capturedAt), "context expiry must follow capture");
export type InitiativeContextManifest = z.infer<typeof InitiativeContextManifestSchema>;

export const InitiativeSelectedContextSchema = z.strictObject({
  instructions: z.string().min(1).max(32_000),
  controlInput: z.string().min(1).max(8_000),
  manifest: InitiativeContextManifestSchema,
  allowedToolNames: z.array(Id).max(32),
  candidateIds: z.array(Id).min(1).max(4).refine((ids) => new Set(ids).size === ids.length),
  // Optional for existing C1 callers; Pattern-backed production opportunities always capture this policy.
  candidatePolicies: z.array(z.strictObject({ candidateId: Id,
    allowedOutcomes: z.array(z.enum(["silent", "express", "speak"])).min(1).max(3),
  })).min(1).max(4).optional(),
  // A fresh eligible purpose may explicitly pull only these Banks inside the admitted Run.
  // The captured tool wrapper owns attempt counts and record/source currentness across retries.
  relatedMemory: z.strictObject({ query: z.string().trim().min(1).max(1000),
    scopes: z.array(z.enum(["global", "character"])).min(1).max(2)
      .refine((scopes) => new Set(scopes).size === scopes.length),
  }).optional(),
}).superRefine((selection, ctx) => {
  if (selection.candidatePolicies === undefined) return;
  const ids = selection.candidatePolicies.map((policy) => policy.candidateId);
  if (new Set(ids).size !== ids.length || ids.length !== selection.candidateIds.length
    || selection.candidateIds.some((id) => !ids.includes(id))
    || selection.candidatePolicies.some((policy) => !policy.allowedOutcomes.includes("silent")
      || new Set(policy.allowedOutcomes).size !== policy.allowedOutcomes.length)) {
    ctx.addIssue({ code: "custom", path: ["candidatePolicies"], message: "Each candidate requires one complete outcome policy including silence" });
  }
});
export type InitiativeSelectedContext = z.infer<typeof InitiativeSelectedContextSchema>;

// Current Avatar supports dynamic raw vocabulary. This bounded fallback preserves that contract;
// semantic PresentationIntent mapping can be supplied by the existing Avatar owner later.
export const InitiativePresentationSchema = z.strictObject({ kind: z.enum(["expression", "motion"]), name: z.string().min(1).max(200) });
export type InitiativePresentation = z.infer<typeof InitiativePresentationSchema>;
const Selected = z.array(Id).max(4).refine((ids) => new Set(ids).size === ids.length);
export const HeartbeatDecisionSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("silent"), selectedCandidateIds: Selected }),
  z.strictObject({ outcome: z.literal("express"), selectedCandidateIds: Selected.min(1), presentation: InitiativePresentationSchema }),
  z.strictObject({ outcome: z.literal("speak"), selectedCandidateIds: Selected.min(1),
    text: z.string().trim().min(1).max(8_000), presentation: InitiativePresentationSchema.nullable(),
    responseExpectation: z.enum(["none", "invitation"]) }),
]);
export type HeartbeatDecision = z.infer<typeof HeartbeatDecisionSchema>;

// Provider function parameters need an object root. Keep the persisted domain union above unchanged;
// this separate all-required, nullable wire shape is normalized only at the tool boundary.
export const HeartbeatDecisionToolInputSchema = z.strictObject({
  outcome: z.enum(["silent", "express", "speak"]),
  selectedCandidateIds: Selected.describe("Only IDs offered in this judgment; at least one for express or speak."),
  text: z.string().trim().min(1).max(8_000).nullable().describe("Complete public utterance for speak; null otherwise."),
  presentation: InitiativePresentationSchema.nullable().describe("Required for express, optional for speak, null for silent."),
  responseExpectation: z.enum(["none", "invitation"]).nullable().describe("Required for speak; null for silent or express."),
}).superRefine((input, ctx) => {
  const valid = input.outcome === "silent" ? input.text === null && input.presentation === null && input.responseExpectation === null
    : input.outcome === "express" ? input.selectedCandidateIds.length > 0 && input.text === null && input.presentation !== null && input.responseExpectation === null
      : input.selectedCandidateIds.length > 0 && input.text !== null && input.responseExpectation !== null;
  if (!valid) ctx.addIssue({ code: "custom", message: "Supply the fields required by the selected outcome; all unused fields must be null." });
});
export type HeartbeatDecisionToolInput = z.infer<typeof HeartbeatDecisionToolInputSchema>;

export const DeliveryStateSchema = z.enum(["staged", "held", "dispatch_committed", "sent", "unknown", "no_target", "expired", "suppressed"]);
export const DeliveryRecordSchema = z.strictObject({
  deliveryId: Id, runId: Id, attemptId: Id, characterId: Id,
  deliveryClass: z.enum(["class_a", "class_b"]), version: Version,
  decision: HeartbeatDecisionSchema, expiresAt: Time, state: DeliveryStateSchema,
  continuation: z.enum(["none", "pending", "waiting", "running", "completed", "failed", "unknown", "expired"]),
  primaryVersion: Version, timelineSeq: z.number().int().positive().nullable(),
  chargedAt: Time.nullable(), createdAt: Time,
});
export type DeliveryRecord = z.infer<typeof DeliveryRecordSchema>;
export const InitiativePolicyReasonSchema = z.enum(["disabled", "busy", "stale", "expired", "suppressed", "budget", "gap", "accepted"]);
export const InitiativePolicyStatusSchema = z.strictObject({
  characterId: Id, recent: z.array(z.strictObject({ reason: InitiativePolicyReasonSchema, occurredAt: Time })).max(100),
});
export type InitiativePolicyStatus = z.infer<typeof InitiativePolicyStatusSchema>;

/**
 * INPUT: accepted source facts and deterministic pre-admission policy evaluations
 * OUTPUT: bounded source envelopes and same-Monitor policy read contracts
 * POS: shared/protocol — no executable predicates, fabricated presence or execution accounting
 */
import { z } from "zod";
import { RunInitiatorSchema } from "./harness-schema.ts";

const Id = z.string().min(1).max(200);
const Instant = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Timestamp = z.string().datetime({ offset: true });
export const InitiativeForegroundFactSchema = z.strictObject({
  occurrenceKey: Id, observedAt: Instant, startedAt: Instant, application: z.string().min(1).max(120), meaningful: z.boolean(),
  idleSeconds: z.number().int().nonnegative().nullable(), observationEpoch: Instant,
  hostId: Id, connectionGeneration: Instant, catalogGeneration: Instant,
}).refine((fact) => fact.startedAt <= fact.observedAt, "activity cannot start after its observation");
export type InitiativeForegroundFact = z.infer<typeof InitiativeForegroundFactSchema>;
export const InitiativePresenceReturnSchema = z.strictObject({
  occurrenceKey: Id, sourceKey: Id, sourceGeneration: Instant, observedAt: Instant,
  inputAt: Instant, previousInputAt: Instant, knownInactiveSince: Instant,
}).refine((fact) => fact.previousInputAt <= fact.knownInactiveSince && fact.knownInactiveSince < fact.inputAt
  && fact.inputAt <= fact.observedAt, "return requires ordered known inactivity and real input");
export type InitiativePresenceReturn = z.infer<typeof InitiativePresenceReturnSchema>;
export const InitiativeCompletionFactSchema = z.strictObject({
  runId: Id, characterId: Id, completedAt: Instant, initiator: RunInitiatorSchema,
  deliveredClassA: z.boolean(), causeRunId: Id.nullable(),
});
export type InitiativeCompletionFact = z.infer<typeof InitiativeCompletionFactSchema>;
// Intention authority supplies actual finite plan data, never a synthetic accepted Pattern.
export const InitiativeDueIntentionSchema = z.strictObject({
  intentionId: Id, characterId: Id, sourceKey: Id, sourceRevision: Id,
  notBefore: Instant, expiresAt: Instant, purpose: z.string().min(1).max(1000),
}).refine((fact) => fact.expiresAt > fact.notBefore);
export type InitiativeDueIntention = z.infer<typeof InitiativeDueIntentionSchema>;
export const InitiativeViewingFactSchema = z.strictObject({
  viewingId: Id, characterId: Id, sourceRevision: Id, eligibleAt: Instant, expiresAt: Instant,
}).refine((fact) => fact.expiresAt > fact.eligibleAt);
export type InitiativeViewingFact = z.infer<typeof InitiativeViewingFactSchema>;
export const InitiativeWakeReasonSchema = z.enum([
  "disabled", "wake-disabled", "no-target", "no-pattern", "no-signal", "missing-source", "stale-source", "privacy-paused",
  "quiet-hours", "absence-unknown", "conditions-unmet", "duplicate", "chance", "pattern-cooldown",
  "model-cadence", "model-budget", "utterance-budget", "utterance-gap", "busy", "expired", "stale-policy",
  "context-unavailable", "admitted", "dispatch-refused", "source-error", "backoff-spacing", "backoff-daily",
]);
export type InitiativeWakeReason = z.infer<typeof InitiativeWakeReasonSchema>;
export const InitiativeWakeEvaluationSchema = z.strictObject({
  reason: InitiativeWakeReasonSchema, occurredAt: Timestamp, matchedCount: z.number().int().min(0).max(4),
  source: z.enum(["none", "clock", "activity", "presence", "completion", "intention", "media"]),
});
export type InitiativeWakeEvaluation = z.infer<typeof InitiativeWakeEvaluationSchema>;
export const InitiativeWakePolicyStatusSchema = z.strictObject({
  characterId: Id, cursor: Instant, recent: z.array(InitiativeWakeEvaluationSchema).max(100),
  counters: z.array(z.strictObject({ reason: InitiativeWakeReasonSchema, count: Instant })).max(32),
  since: Timestamp,
});
export type InitiativeWakePolicyStatus = z.infer<typeof InitiativeWakePolicyStatusSchema>;

export const INITIATIVE_WAKE_METHODS = {
  read: "observability.initiative-policy", changed: "observability.initiative-policy-changed",
} as const;
export const InitiativeWakeReadParamsSchema = z.strictObject({ characterId: Id });
export type InitiativeWakeReadParams = z.infer<typeof InitiativeWakeReadParamsSchema>;
export const InitiativeWakeChangedSchema = z.strictObject({ characterId: Id });
export type InitiativeWakeChanged = z.infer<typeof InitiativeWakeChangedSchema>;

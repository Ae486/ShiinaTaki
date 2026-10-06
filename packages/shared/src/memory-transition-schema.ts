/**
 * INPUT:  confirmed transition previews and Core-owned immutable transition evidence
 * OUTPUT: strict v1 identity, intent, attempt, proof, receipt and status contracts
 * POS:    shared/protocol — repeated transitions; these contracts do not certify native capability
 */
import { z } from "zod";
import { MemoryBankScopeSchema } from "./memory-provider-domain-schema.ts";

const Id = z.string().min(1).max(256);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Time = z.iso.datetime({ offset: true });
export const MemoryTransitionKindSchema = z.enum(["transition.return-local", "transition.reenter-hindsight", "transition.emergency-local"]);
export const MemoryTransitionErrorCodeSchema = z.enum([
  "MEMORY_TRANSITION_UNAVAILABLE", "MEMORY_TRANSITION_STALE", "MEMORY_TRANSITION_CONFLICT", "MEMORY_TRANSITION_LEASE_LOST",
  "MEMORY_TRANSITION_QUEUE_FULL", "MEMORY_TRANSITION_CUTOFF", "MEMORY_TRANSITION_PROOF_INVALID", "MEMORY_TRANSITION_OUTCOME_UNKNOWN",
]);
export const MemoryTransitionBankSchema = z.strictObject({
  scope: MemoryBankScopeSchema, sourceBankId: Id, targetBankId: Id.nullable(), sourceRevision: z.int().nonnegative(),
  nativeBankId: Id.nullable(), nativeGeneration: Id.nullable(), manifestHash: Hash, mappingHash: Hash,
  policyRevision: z.int().nonnegative(), blockRevision: z.int().nonnegative(),
});
export const MemoryTransitionIdentitySchema = z.strictObject({
  predecessorEpochId: Id, sourceProvider: z.enum(["local", "hindsight"]), sourceLineageId: Id,
  targetProvider: z.enum(["local", "hindsight"]), targetLineageId: Id,
  configRevision: z.int().nonnegative(), configFingerprint: Hash, inventoryRevision: z.int().nonnegative(),
  inventoryHash: Hash, banks: z.array(MemoryTransitionBankSchema).min(1).max(1024),
  baselineReceiptId: Id.nullable(), baselineHash: Hash.nullable(), custodyBoundaryHash: Hash,
}).superRefine((value, ctx) => {
  if (value.sourceProvider === value.targetProvider) ctx.addIssue({ code: "custom", message: "transition must change provider" });
  const scopes = value.banks.map((bank) => JSON.stringify(bank.scope));
  if (new Set(scopes).size !== scopes.length || new Set(value.banks.map((bank) => bank.sourceBankId)).size !== value.banks.length) {
    ctx.addIssue({ code: "custom", message: "inventory must have unique scopes and source Banks" });
  }
  if (value.banks.filter((bank) => bank.scope.kind === "global").length !== 1) ctx.addIssue({ code: "custom", message: "complete inventory requires Global" });
  if ((value.baselineReceiptId === null) !== (value.baselineHash === null)) ctx.addIssue({ code: "custom", message: "baseline identity and hash are paired" });
  if (value.banks.some((bank) => (bank.nativeBankId === null) !== (bank.nativeGeneration === null)
    || (value.sourceProvider === "hindsight" && bank.nativeBankId === null))) ctx.addIssue({ code: "custom", message: "native Bank identity and generation must be complete" });
});
export type MemoryTransitionIdentity = z.infer<typeof MemoryTransitionIdentitySchema>;

const RequestFields = { requestId: z.uuid(), previewId: z.uuid(), previewHash: Hash, expected: MemoryTransitionIdentitySchema,
  recovery: z.strictObject({ transitionId: z.uuid(), expectedReceiptId: Hash.nullable(), expectedGeneration: z.int().min(1) }).optional() };
export const MemoryTransitionReturnRequestSchema = z.strictObject({ kind: z.literal("transition.return-local"), ...RequestFields, confirmation: z.literal("healthy-switch") });
export const MemoryTransitionReentryRequestSchema = z.strictObject({ kind: z.literal("transition.reenter-hindsight"), ...RequestFields, confirmation: z.literal("healthy-switch") });
export const MemoryTransitionEmergencyRequestSchema = z.strictObject({ kind: z.literal("transition.emergency-local"), ...RequestFields, confirmation: z.literal("emergency-takeover") });
export const MemoryTransitionRequestSchema = z.discriminatedUnion("kind", [MemoryTransitionReturnRequestSchema, MemoryTransitionReentryRequestSchema, MemoryTransitionEmergencyRequestSchema])
  .superRefine((value, ctx) => {
    const source = value.kind === "transition.reenter-hindsight" ? "local" : "hindsight";
    if (value.expected.sourceProvider !== source) ctx.addIssue({ code: "custom", message: "direction and predecessor disagree" });
    if (source === "local" && value.expected.baselineReceiptId === null) ctx.addIssue({ code: "custom", message: "reentry requires a common baseline" });
  });
export type MemoryTransitionRequest = z.infer<typeof MemoryTransitionRequestSchema>;
export const MemoryTransitionQueuePolicySchema = z.strictObject({
  maxIntents: z.int().min(1).max(4096), maxBytes: z.int().min(1024).max(67_108_864),
  maxIntentBytes: z.int().min(1024).max(1_048_576), admissionWindowMs: z.int().min(1000).max(600_000),
}).refine((value) => value.maxIntentBytes <= value.maxBytes, "per-intent bound exceeds queue bound");
export const MemoryTransitionIntentSchema = z.strictObject({
  version: z.literal(1), transitionId: z.uuid(), operationId: z.uuid(), request: MemoryTransitionRequestSchema,
  actorId: Id, admittedAt: Time, queuePolicy: MemoryTransitionQueuePolicySchema, incidentId: z.uuid().nullable(),
}).refine((value) => (value.request.kind === "transition.emergency-local") === (value.incidentId !== null), "only emergency reserves an incident identity")
  .refine((value) => value.request.recovery === undefined, "a recovery preserves its original transition intent");
export type MemoryTransitionIntent = z.infer<typeof MemoryTransitionIntentSchema>;

export const MemoryTransitionAttemptSchema = z.strictObject({
  transitionId: z.uuid(), operationId: z.uuid(), attemptId: z.uuid(), ownerId: Id, generation: z.int().min(1), revision: z.int().nonnegative(),
  leaseUntil: Time, phase: z.enum(["admitted", "draining", "fenced", "proven", "committed", "binding", "settling", "terminal"]),
  admissionOpenedAt: Time.nullable(), cutoffAt: Time.nullable(), cutoffSequence: z.int().nonnegative().nullable(),
  lastEvidenceId: Hash.nullable(), cancellationRequested: z.boolean(),
}).superRefine((value, ctx) => {
  if ((value.cutoffAt === null) !== (value.cutoffSequence === null)) ctx.addIssue({ code: "custom", message: "cutoff needs time and exact sequence" });
  if (value.cutoffAt !== null && value.admissionOpenedAt === null) ctx.addIssue({ code: "custom", message: "cutoff requires admission boundary" });
});
export type MemoryTransitionAttempt = z.infer<typeof MemoryTransitionAttemptSchema>;

// W2 must supply and verify the referenced native protocol; this is a required proof envelope, not an HTTP endpoint.
const NativeProof = z.strictObject({
  protocol: z.literal("taki-transition-v1"), fenceId: Id, holderGeneration: z.int().min(1), certificateId: Id,
  nativeSnapshotId: Id, nativeCursor: z.int().nonnegative(), applicationSnapshotId: Id, applicationCursor: z.int().nonnegative(),
  nativeGeneration: Id, maintenanceInputHash: Hash, maintenanceOutcomeHash: Hash, proofHash: Hash,
});
export const MemoryTransitionFinalProofSchema = z.strictObject({
  version: z.literal(1), transitionId: z.uuid(), attemptId: z.uuid(), generation: z.int().min(1),
  identity: MemoryTransitionIdentitySchema, fencedManifestHash: Hash, mappingHash: Hash, custodyBoundaryHash: Hash,
  cutoffSequence: z.int().nonnegative(), unresolvedSourceHash: Hash,
  banks: z.array(z.strictObject({ sourceBankId: Id, manifestHash: Hash, mappingHash: Hash, native: NativeProof.nullable() })).min(1).max(1024),
  incidentId: z.uuid().nullable(), incidentHash: Hash.nullable(), backupId: Id.nullable(), recordedAt: Time,
}).superRefine((value, ctx) => {
  if ((value.incidentId === null) !== (value.incidentHash === null)) ctx.addIssue({ code: "custom", message: "incident identity and hash must agree" });
  const actual = value.banks.map((bank) => bank.sourceBankId).sort();
  const expected = value.identity.banks.map((bank) => bank.sourceBankId).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) ctx.addIssue({ code: "custom", message: "final proof must cover every Bank exactly once" });
  if (value.incidentId === null && value.banks.some((bank) => bank.native === null)) ctx.addIssue({ code: "custom", message: "healthy proof requires every native boundary" });
});
export type MemoryTransitionFinalProof = z.infer<typeof MemoryTransitionFinalProofSchema>;
export const MemoryTransitionReceiptSchema = z.strictObject({
  version: z.literal(1), receiptId: Hash, transitionId: z.uuid(), operationId: z.uuid(), requestId: z.uuid(),
  kind: MemoryTransitionKindSchema, identity: MemoryTransitionIdentitySchema, newEpochId: Id, proofId: Hash,
  mappingHash: Hash, custodyAssignmentHash: Hash, cutoffSequence: z.int().nonnegative(), committedAt: Time,
}).refine((value) => value.newEpochId !== value.identity.predecessorEpochId, "transition receipt must publish a new epoch");
export type MemoryTransitionReceipt = z.infer<typeof MemoryTransitionReceiptSchema>;
export const MemoryTransitionResultSchema = z.strictObject({
  kind: z.literal("transition"), transitionId: z.uuid(), receiptId: Hash.nullable(), authorityCommitted: z.boolean(),
  runtime: z.enum(["source", "ready", "unavailable"]), queue: z.enum(["unsettled", "settled"]),
  outcome: z.enum(["completed", "failed", "cancelled", "outcome_unknown"]), errorCode: MemoryTransitionErrorCodeSchema.nullable(),
}).superRefine((value, ctx) => {
  if (value.authorityCommitted !== (value.receiptId !== null)) ctx.addIssue({ code: "custom", message: "authority commit requires receipt" });
  if (value.outcome === "completed" && (!value.authorityCommitted || value.runtime !== "ready" || value.queue !== "settled" || value.errorCode !== null)) {
    ctx.addIssue({ code: "custom", message: "completion requires committed ready runtime and settled queue" });
  }
  if (value.outcome === "cancelled" && value.authorityCommitted) ctx.addIssue({ code: "custom", message: "committed transition cannot be cancelled" });
  if ((value.authorityCommitted && value.runtime === "source") || (!value.authorityCommitted && value.runtime === "ready")) ctx.addIssue({ code: "custom", message: "runtime and committed authority disagree" });
  if ((value.outcome === "failed" || value.outcome === "outcome_unknown") && value.errorCode === null) ctx.addIssue({ code: "custom", message: "failed or unknown result needs an explicit code" });
});
export type MemoryTransitionResult = z.infer<typeof MemoryTransitionResultSchema>;
export const MemoryTransitionProducerRefSchema = z.strictObject({ kind: z.literal("transition"), transitionId: z.uuid(), requestId: z.uuid() });
export const MemoryTransitionStatusSchema = z.strictObject({
  intent: MemoryTransitionIntentSchema, attempt: MemoryTransitionAttemptSchema.nullable(), receipt: MemoryTransitionReceiptSchema.nullable(),
  result: MemoryTransitionResultSchema.nullable(), available: z.boolean(), blocking: z.array(MemoryTransitionErrorCodeSchema).max(16),
});
export const MemoryTransitionRecoverySchema = z.strictObject({
  version: z.literal(1), operationId: z.uuid(), transitionId: z.uuid(), request: MemoryTransitionRequestSchema, actorId: Id, admittedAt: Time,
}).refine((value) => value.request.recovery?.transitionId === value.transitionId, "recovery must identify the original transition");
export type MemoryTransitionRecovery = z.infer<typeof MemoryTransitionRecoverySchema>;
export const MemoryTransitionResolutionSchema = z.strictObject({
  version: z.literal(1), resolutionId: Hash, operationId: z.uuid(), transitionId: z.uuid(), result: MemoryTransitionResultSchema,
  release: z.strictObject({ protocol: z.literal("taki-transition-v1"), attemptId: z.uuid(), generation: z.int().min(1),
    disposition: z.enum(["source-aborted", "source-retired", "offline-quarantined"]), proofHash: Hash,
    banks: z.array(z.strictObject({ sourceBankId: Id, nativeGeneration: Id.nullable(), fenceId: Id.nullable(),
      outcomeReceiptId: Id.nullable(), proofHash: Hash, dispatch: z.enum(["never-dispatched", "offline-quarantined"]).optional() })
      .refine((bank) => bank.dispatch !== undefined ? bank.fenceId === null && bank.outcomeReceiptId === null
        : bank.outcomeReceiptId !== null, "non-dispatch evidence cannot fabricate a native outcome")).min(1).max(1024),
    incidentId: z.uuid().nullable(), recordedAt: Time }),
}).refine((value) => value.result.transitionId === value.transitionId && value.result.outcome !== "outcome_unknown"
  && value.result.queue === "settled", "resolution must settle obligations for the original transition");
export type MemoryTransitionResolution = z.infer<typeof MemoryTransitionResolutionSchema>;

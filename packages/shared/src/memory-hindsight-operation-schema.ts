/**
 * INPUT:  the operator's single Hindsight activation command and the Core-owned cutover/promotion evidence it produces
 * OUTPUT: strict hindsight.activate request, producer, progress, result and closed activation error-code schemas
 * POS:    shared/protocol — Stage 2b operation arms; Core mints every id, clients never supply epoch or transaction identity
 */
import { z } from "zod";
import { HINDSIGHT_ERROR_CODES } from "./hindsight-connection-schema.ts";

const Id = z.string().min(1).max(256);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Count = z.int().nonnegative();
export const BankScopeSchema = z.enum(["global", "character"]);

export const MemoryHindsightActivationErrorCodeSchema = z.enum([
  ...HINDSIGHT_ERROR_CODES,
  "HINDSIGHT_PREDECESSOR_STALE", "HINDSIGHT_SOURCE_RUN_NOT_COMPLETED", "HINDSIGHT_CUTOVER_LEASE_LOST",
  "HINDSIGHT_LOCAL_COVERAGE_STALE", "HINDSIGHT_LOCAL_COVERAGE_MISSING", "HINDSIGHT_LOCAL_COVERAGE_LIMIT_EXCEEDED",
  "HINDSIGHT_CURRENT_TARGET_CONFLICT", "HINDSIGHT_CURRENT_PREPARATION_GAPS", "HINDSIGHT_CURRENT_NATIVE_REFUSED",
  "HINDSIGHT_CURRENT_VERIFICATION_INCOMPLETE", "HINDSIGHT_CURRENT_IMPORT_MISSING", "HINDSIGHT_CURRENT_VERIFICATION_MISSING",
  "HINDSIGHT_CURRENT_REPLICA_STALE", "HINDSIGHT_BANKS_INCOMPLETE", "HINDSIGHT_TEMPLATE_NOT_VERIFIED",
  "HINDSIGHT_CONNECTION_NOT_VERIFIED", "HINDSIGHT_PROVIDER_LINEAGE_MISMATCH", "HINDSIGHT_CHECKPOINT_MISSING",
  "HINDSIGHT_CHECKPOINT_STALE", "HINDSIGHT_CHECKPOINT_SET_STALE", "HINDSIGHT_MANIFEST_STALE", "HINDSIGHT_REPLICA_NOT_PUBLISHED",
  "HINDSIGHT_PROMOTION_CONFLICT", "MEMORY_QUIESCENCE_TIMEOUT", "MEMORY_INGESTION_INCOMPLETE", "MEMORY_AUTHORITY_MISMATCH",
  "MEMORY_RUNTIME_UNAVAILABLE", "HINDSIGHT_ACTIVATION_INTERRUPTED", "HINDSIGHT_ACTIVATION_INTERNAL_ERROR",
]);
export type MemoryHindsightActivationErrorCode = z.infer<typeof MemoryHindsightActivationErrorCodeSchema>;

export const MemoryHindsightActivateSourceSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("new"), setupRevision: z.int().nonnegative(), expectedEpochId: Id }),
  z.strictObject({ mode: z.literal("resume"), runId: Id }),
  z.strictObject({ mode: z.literal("recover"), epochId: Id }),
]);
export const MemoryHindsightActivateRequestSchema = z.strictObject({
  kind: z.literal("hindsight.activate"), source: MemoryHindsightActivateSourceSchema,
});
export const MemoryHindsightPhaseSchema = z.enum([
  "reserved", "draining", "capturing", "preparing", "importing", "verifying", "ready", "committing", "binding", "completed",
]);
export const MemoryHindsightProgressSchema = z.strictObject({
  phase: MemoryHindsightPhaseSchema, bankCount: Count, preparedBankCount: Count, importedBankCount: Count,
  verifiedBankCount: Count, carriedWitnessCount: Count,
});
export const MemoryHindsightProducerBankSchema = z.strictObject({
  nativeBankId: Id, scope: BankScopeSchema, replicaEpochId: z.uuid(), verificationId: z.uuid(), preparationId: Id.nullable(),
});
export const MemoryHindsightProducerRefSchema = z.strictObject({
  kind: z.literal("hindsight"), runId: Id, hindsightEpochId: Id, transactionId: Id, configFingerprint: Digest,
  manifestId: Id.nullable(), progress: MemoryHindsightProgressSchema, banks: z.array(MemoryHindsightProducerBankSchema).max(256),
});
export const MemoryHindsightBlockingSchema = z.strictObject({
  scope: BankScopeSchema, characterId: Id.nullable(), localBankId: Id.nullable(), code: MemoryHindsightActivationErrorCodeSchema,
});
export const MemoryHindsightResultSchema = z.strictObject({
  kind: z.literal("hindsight"), runId: Id, outcome: z.enum(["activated", "binding_unavailable", "prerequisite_blocked"]),
  epochId: Id.nullable(), runtimeAvailable: z.boolean(), blocking: z.array(MemoryHindsightBlockingSchema).max(256),
}).superRefine((result, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  if (result.outcome === "prerequisite_blocked" && (result.blocking.length === 0 || result.epochId !== null || result.runtimeAvailable)) fail("a blocked activation names its prerequisites and no epoch");
  if (result.outcome !== "prerequisite_blocked" && (result.blocking.length !== 0 || result.epochId === null)) fail("a committed activation names its epoch and nothing blocking");
  if (result.runtimeAvailable !== (result.outcome === "activated")) fail("runtime availability follows the activation outcome");
});
export type MemoryHindsightActivateSource = z.infer<typeof MemoryHindsightActivateSourceSchema>;
export type MemoryHindsightActivateRequest = z.infer<typeof MemoryHindsightActivateRequestSchema>;
export type MemoryHindsightPhase = z.infer<typeof MemoryHindsightPhaseSchema>;
export type MemoryHindsightProgress = z.infer<typeof MemoryHindsightProgressSchema>;
export type MemoryHindsightProducerBank = z.infer<typeof MemoryHindsightProducerBankSchema>;
export type MemoryHindsightProducerRef = z.infer<typeof MemoryHindsightProducerRefSchema>;
export type MemoryHindsightBlocking = z.infer<typeof MemoryHindsightBlockingSchema>;
export type MemoryHindsightResult = z.infer<typeof MemoryHindsightResultSchema>;

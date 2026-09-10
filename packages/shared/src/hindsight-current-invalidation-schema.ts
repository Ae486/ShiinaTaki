/**
 * INPUT:  authenticated native responses proving drift under one frozen D78 request
 * OUTPUT: immutable preparation/candidate invalidation observations with exact certificate provenance
 * POS:    shared cutover evidence — transport failure and inability to parse never prove native drift
 */
import { z } from "zod";
import { HindsightCurrentTransferFailureSchema } from "./hindsight-current-state-schema.ts";
import { HindsightCutoverVerificationFailureSchema, HindsightCutoverVerificationStatusSchema } from "./hindsight-cutover-verification-schema.ts";

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const driftReasons = new Set(["generation_mismatch", "bank_not_found", "source_changed", "target_changed",
  "source_missing", "target_missing", "policy_changed", "definition_changed", "candidate_changed", "ownership_drift"]);
export const HindsightCurrentNativeObservationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("verification-status"), value: HindsightCutoverVerificationStatusSchema }),
  z.strictObject({ kind: z.literal("verification-refusal"), value: HindsightCutoverVerificationFailureSchema }),
  z.strictObject({ kind: z.literal("transfer-refusal"), value: HindsightCurrentTransferFailureSchema }),
]);
export type HindsightCurrentNativeObservation = z.infer<typeof HindsightCurrentNativeObservationSchema>;

export function hindsightCurrentObservationProvesDrift(response: HindsightCurrentNativeObservation): boolean {
  if (response.kind !== "verification-status") return driftReasons.has(response.value.reason);
  return response.value.state === "stale"
    || response.value.state === "incomplete" && response.value.reasons.some((reason) => driftReasons.has(reason));
}

export const HindsightCurrentNativeInvalidationSchema = z.strictObject({
  schemaVersion: z.literal(1), invalidationId: Hash, observationKey: Hash, preparationId: Hash,
  bankId: z.string().min(1).max(256), providerLineage: z.uuid(), bankGeneration: z.uuid(),
  scope: z.enum(["preparation", "candidate"]), candidateId: Hash.nullable(), verificationId: z.uuid().nullable(),
  certificateHash: Hash.nullable(), observedAt: z.iso.datetime({ offset: true }), response: HindsightCurrentNativeObservationSchema,
}).superRefine((value, context) => {
  if (!hindsightCurrentObservationProvesDrift(value.response)
    || value.scope === "candidate" && (value.candidateId === null || value.verificationId === null
      || value.response.kind !== "verification-status")
    || value.scope === "preparation" && value.response.kind === "verification-status") {
    context.addIssue({ code: "custom", message: "invalidation must bind a proven native drift response" });
  }
  if (value.response.kind === "verification-status" && (value.response.value.verification_id !== value.verificationId
    || value.response.value.bank_id !== value.bankId || value.response.value.provider_lineage !== value.providerLineage
    || value.response.value.bank_generation !== value.bankGeneration)) {
    context.addIssue({ code: "custom", message: "native drift observation namespace mismatch" });
  }
});
export type HindsightCurrentNativeInvalidation = z.infer<typeof HindsightCurrentNativeInvalidationSchema>;

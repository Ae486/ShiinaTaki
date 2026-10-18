/**
 * INPUT:  optional healthy template commitments and authenticated observations joined to immutable W2 evidence
 * OUTPUT: separately versioned Core extensions without expanding historical transition documents
 * POS:    Shared transition evidence; Native W2 hash domains and emergency contracts remain unchanged
 */
import { z } from "zod";
import { HindsightTemplateBackupBankAttestationSchema } from "./hindsight-template-backup-attestation-schema.ts";
import { HindsightBackupNativeRequestV2Schema, HindsightTemplateBackupObservationResponseSchema } from "./hindsight-backup-v2-schema.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const MemoryTransitionTemplateCommitmentSchema = z.strictObject({ version: z.literal(1), hash: Hash });
export type MemoryTransitionTemplateCommitment = z.infer<typeof MemoryTransitionTemplateCommitmentSchema>;

/** Each Bank carries its own attestation; the complete admitted inventory reconstructs the one commitment. */
export const MemoryTransitionTemplateAssociationSchema = z.strictObject({
  version: z.literal(1), admitted: MemoryTransitionTemplateCommitmentSchema,
  w2EvidenceId: Hash, w2ProofHash: Hash, defaultsHash: Hash,
  hold: z.strictObject({ state: z.literal("clear"), digest: Hash }),
  bank: HindsightTemplateBackupBankAttestationSchema,
  request: HindsightBackupNativeRequestV2Schema,
  observation: HindsightTemplateBackupObservationResponseSchema,
}).refine((value) => value.request.nativeBankIds.length === 1 && value.request.templates.length === 1
  && value.observation.proof.banks.length === 1 && value.observation.proof.templates.length === 1
  && value.request.requestHash === value.observation.requestHash,
"one exact Bank and request must be associated with each W2 evidence document");
export type MemoryTransitionTemplateAssociation = z.infer<typeof MemoryTransitionTemplateAssociationSchema>;

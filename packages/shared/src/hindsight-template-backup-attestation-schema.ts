/**
 * INPUT:  verified immutable Core history, current pointers, publication evidence and exact copied Bank scope
 * OUTPUT: bounded template attestation carried by backup-v2 manifests and healthy transition evidence
 * POS:    Shared evidence contract; the copied Core producer must verify every committed source document
 */
import { z } from "zod";
import { HindsightTemplateHashSchema as Hash, HindsightTemplateIdSchema as Id,
  HindsightTemplateTargetSchema } from "./hindsight-template-definition-schema.ts";
import { HindsightTemplateBackupReceiptInventorySchema } from "./hindsight-template-backup-schema.ts";

const UUID = z.uuid().transform((value) => value.toLowerCase());
const Selected = z.strictObject({
  selectionRevision: z.int().positive(), selectionHash: Hash, templateRevision: Id,
  enrollmentRevision: z.int().positive(), userRevision: z.int().nonnegative(),
  requestId: UUID, requestHash: Hash, receiptHash: Hash,
  publication: z.strictObject({ publicationId: UUID, planId: UUID, planHash: Hash,
    operationId: UUID, selectionIdentity: Hash }),
  databaseDefinitionHash: Hash, inheritedConfigHash: Hash, definitionProjectionHash: Hash,
});
export const HindsightTemplateBackupBankAttestationSchema = z.strictObject({
  target: HindsightTemplateTargetSchema, canonicalIdentity: z.string().min(1).max(170),
  scope: z.enum(["global", "character"]), characterId: Id.nullable(), historyHash: Hash,
  receiptInventory: HindsightTemplateBackupReceiptInventorySchema,
  // Removing the overlay (templateRevision "none") is still an evidence-backed selection.
  selected: Selected.nullable(),
}).refine((bank) => (bank.scope === "character") === (bank.characterId !== null)
  && bank.canonicalIdentity === (bank.scope === "global" ? "global" : "character:" + bank.characterId),
"exact canonical Bank scope is required");
export type HindsightTemplateBackupBankAttestation = z.infer<typeof HindsightTemplateBackupBankAttestationSchema>;

export const HindsightTemplateBackupAttestationSchema = z.strictObject({
  version: z.literal(1), authorityEpochId: Id, providerLineageId: UUID,
  defaultsHash: Hash, hold: z.strictObject({ state: z.literal("clear"), digest: Hash }),
  banks: z.array(HindsightTemplateBackupBankAttestationSchema).max(256), attestationHash: Hash,
}).refine((value) => value.banks.every((bank) => bank.target.provider_lineage === value.providerLineageId)
  && new Set(value.banks.map((bank) => bank.target.bank_id)).size === value.banks.length
  && new Set(value.banks.map((bank) => bank.canonicalIdentity)).size === value.banks.length,
"attestation contains each exact Bank once");
export type HindsightTemplateBackupAttestation = z.infer<typeof HindsightTemplateBackupAttestationSchema>;

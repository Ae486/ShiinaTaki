/**
 * INPUT:  complete original selected Apply requests, independent Native observations and copied Core attestation
 * OUTPUT: separate strict backup-v2 request, proof body, endpoint, archive, observation and manifest contracts
 * POS:    Shared backup-v2 wire; no legacy optional-field upgrade or evidence-stripping projection
 */
import { z } from "zod";
import { HindsightTemplateApplyRequestSchema } from "./hindsight-template-schema.ts";
import { HindsightTemplateHashSchema as Hash, HindsightTemplateTargetSchema } from "./hindsight-template-definition-schema.ts";
import { HindsightTemplateBackupBankProofV2Schema } from "./hindsight-template-backup-schema.ts";
import { HindsightTemplateBackupAttestationSchema } from "./hindsight-template-backup-attestation-schema.ts";
import { hindsightBackupJsonBytes, HINDSIGHT_BACKUP_APPLY_MAX_BYTES } from "./hindsight-template-backup-encoding.ts";
import { HindsightBackupNativeRequestV1BaseSchema, HindsightBackupNativeProofBodyV1BaseSchema,
  HindsightBackupNativeBankSchema, HindsightBackupArchiveEntrySchema, HindsightBackupManifestV1BaseSchema,
  refineHindsightBackupNativeProof, refineHindsightBackupManifest } from "./hindsight-backup-v1-schema.ts";

const UUID = z.uuid().transform((value) => value.toLowerCase());
const TemplateRequest = z.strictObject({
  target: HindsightTemplateTargetSchema,
  selected: z.strictObject({ request: HindsightTemplateApplyRequestSchema, receiptHash: Hash }).nullable(),
});
export const HindsightBackupNativeRequestV2Schema = HindsightBackupNativeRequestV1BaseSchema.extend({
  version: z.literal(2), backupId: UUID, createdAt: z.iso.datetime({ offset: true }).max(64), providerLineageId: UUID, requestHash: Hash,
  templates: z.array(TemplateRequest).max(256),
}).superRefine((value, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  const banks = new Set(value.nativeBankIds);
  if (banks.size !== value.nativeBankIds.length || new Set(value.operationIds).size !== value.operationIds.length
    || new Set(value.templates.map((entry) => entry.target.bank_id)).size !== value.templates.length
    || value.templates.length !== banks.size) fail("each requested Bank and operation appears once");
  for (const entry of value.templates) {
    if (!banks.has(entry.target.bank_id) || entry.target.provider_lineage !== value.providerLineageId) fail("exact requested template target required");
    if (entry.selected !== null) {
      const { request } = entry.selected;
      if (request.target.provider_lineage !== entry.target.provider_lineage || request.target.bank_id !== entry.target.bank_id
        || request.target.bank_generation !== entry.target.bank_generation) fail("selected original request target differs");
      if (hindsightBackupJsonBytes(request) > HINDSIGHT_BACKUP_APPLY_MAX_BYTES) fail("selected original request exceeds the Apply byte limit");
    }
  }
});
export type HindsightBackupNativeRequestV2 = z.infer<typeof HindsightBackupNativeRequestV2Schema>;

const NativeProofBase = HindsightBackupNativeProofBodyV1BaseSchema.extend({
  version: z.literal(2), requestHash: Hash, providerLineage: UUID,
  banks: z.array(HindsightBackupNativeBankSchema.extend({ bankGeneration: UUID })).max(256),
  templates: z.array(HindsightTemplateBackupBankProofV2Schema).max(256),
});
function refineProof(value: z.infer<typeof NativeProofBase>, context: z.RefinementCtx): void {
  refineHindsightBackupNativeProof(value, context);
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  const banks = new Map(value.banks.map((bank) => [bank.bankId, bank]));
  if (value.templates.length !== banks.size || new Set(value.templates.map((entry) => entry.target.bank_id)).size !== banks.size) {
    fail("template proof covers every captured Bank exactly once");
  }
  for (const entry of value.templates) {
    const bank = banks.get(entry.target.bank_id);
    if (!bank || bank.bankGeneration !== entry.target.bank_generation || entry.target.provider_lineage !== value.providerLineage) {
      fail("template proof target differs from captured Bank");
    }
    if (entry.selected.state === "selected" && entry.selected.configurationObservation.requestHash !== value.requestHash) {
      fail("configuration observation is bound to the backup request");
    }
  }
}
/** This body cannot carry ZIP fields; observation is not a filesystem backup. */
export const HindsightBackupNativeProofBodyV2Schema = NativeProofBase.superRefine(refineProof);
export type HindsightBackupNativeProofBodyV2 = z.infer<typeof HindsightBackupNativeProofBodyV2Schema>;
export const HindsightBackupNativeProofV2Schema = NativeProofBase.extend({
  zipSha256: Hash, zipBytes: z.int().positive(),
}).superRefine(refineProof);
export type HindsightBackupNativeProofV2 = z.infer<typeof HindsightBackupNativeProofV2Schema>;

export const HindsightTemplateBackupObservationRequestSchema = z.strictObject({
  version: z.literal(2), nonce: UUID, request: HindsightBackupNativeRequestV2Schema,
});
export type HindsightTemplateBackupObservationRequest = z.infer<typeof HindsightTemplateBackupObservationRequestSchema>;
export const HindsightTemplateBackupObservationResponseSchema = z.strictObject({
  version: z.literal(2), nonce: UUID, requestHash: Hash, schema: z.string().min(1).max(120),
  proof: HindsightBackupNativeProofBodyV2Schema,
}).refine((value) => value.requestHash === value.proof.requestHash && value.proof.templates.every((bank) =>
  bank.selected.state === "unselected" || bank.selected.configurationObservation.schema === value.schema),
"observation binds its schema and request to the complete proof");
export type HindsightTemplateBackupObservationResponse = z.infer<typeof HindsightTemplateBackupObservationResponseSchema>;

export const HindsightBackupArchiveProofV2Schema = z.strictObject({
  version: z.literal(2), backupId: UUID, requestHash: Hash,
  proof: HindsightBackupNativeProofBodyV2Schema, entries: z.array(HindsightBackupArchiveEntrySchema).max(512),
}).refine((value) => value.requestHash === value.proof.requestHash
  && new Set(value.entries.map((entry) => entry.name)).size === value.entries.length,
"archive contains unique entries and the exact requested proof");
export type HindsightBackupArchiveProofV2 = z.infer<typeof HindsightBackupArchiveProofV2Schema>;

export const HindsightBackupNativeResponseV2Schema = z.strictObject({
  version: z.literal(2), backupId: UUID, requestHash: Hash, schema: z.string().min(1).max(120),
  proof: HindsightBackupNativeProofBodyV2Schema,
  artifact: z.strictObject({ location: z.literal("native-host"),
    fileName: z.string().regex(/^taki-backup-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.zip$/),
    sha256: Hash, bytes: z.int().positive() }),
}).refine((value) => value.requestHash === value.proof.requestHash && value.proof.templates.every((bank) =>
  bank.selected.state === "unselected" || bank.selected.configurationObservation.schema === value.schema),
"endpoint response binds schema and request to the complete proof");
export type HindsightBackupNativeResponseV2 = z.infer<typeof HindsightBackupNativeResponseV2Schema>;

/** The unrefined versioned base is deliberately exported for staged Core metadata without weakening the sealed contract. */
export const HindsightBackupManifestV2BaseSchema = HindsightBackupManifestV1BaseSchema.extend({
  version: z.literal(2), createdAt: z.iso.datetime({ offset: true }).max(64), verifiedAt: z.iso.datetime({ offset: true }).max(64).nullable(),
  requestHash: Hash, templates: HindsightTemplateBackupAttestationSchema,
  native: HindsightBackupManifestV1BaseSchema.shape.native.extend({ proof: HindsightBackupNativeProofV2Schema }),
});
export const HindsightBackupManifestV2Schema = HindsightBackupManifestV2BaseSchema.superRefine((value, context) => {
  refineHindsightBackupManifest(value, context);
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  if (value.requestHash !== value.native.proof.requestHash || value.templates.authorityEpochId !== value.authority.epochId
    || value.templates.providerLineageId !== value.authority.providerLineageId) fail("manifest binds request and copied authority");
  const banks = new Map(value.templates.banks.map((bank) => [bank.canonicalIdentity, bank]));
  if (banks.size !== value.banks.length) fail("attestation covers each copied Bank");
  for (const bank of value.banks) {
    const entry = banks.get(bank.bankId);
    if (!entry || entry.target.bank_id !== bank.nativeBankId || entry.scope !== bank.scope || entry.characterId !== bank.characterId
      || bank.bankGeneration !== null && bank.bankGeneration !== entry.target.bank_generation) fail("attestation target differs from copied Bank");
  }
});
export type HindsightBackupManifestV2 = z.infer<typeof HindsightBackupManifestV2Schema>;

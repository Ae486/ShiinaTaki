/**
 * INPUT:  exact lifecycle targets, independently verified receipts and actual service configuration observations
 * OUTPUT: strict backup-v2 Bank evidence with separate selected and unselected variants
 * POS:    Shared backup wire; receipt inventory never asserts Core publication or invents inherited defaults
 */
import { z } from "zod";
import { HindsightTemplateHashSchema as Hash, HindsightTemplateTargetSchema } from "./hindsight-template-definition-schema.ts";

const UUID = z.uuid().transform((value) => value.toLowerCase());
export const HINDSIGHT_TEMPLATE_BACKUP_VERSION = "1.0.0" as const;
export const HINDSIGHT_TEMPLATE_BACKUP_BUILD = "taki-memory-hindsight-0.9.0-template-backup-v1" as const;
export const HINDSIGHT_TEMPLATE_BACKUP_OBSERVATION_PATH = "/ext/taki-memory/template/backup-observation" as const;

export const HindsightTemplateBackupFailureSchema = z.strictObject({
  error: z.literal("template_backup_refused"),
  reason: z.enum(["invalid_request", "request_too_large", "response_too_large", "manifest_too_large", "unsupported_storage",
    "operation_refused", "field_refused", "bank_not_found", "generation_mismatch", "request_conflict", "receipt_corrupt",
    "unsupported_value", "configuration_unavailable", "configuration_changed", "service_required", "service_unavailable", "observation_mismatch"]),
});
export type HindsightTemplateBackupFailure = z.infer<typeof HindsightTemplateBackupFailureSchema>;

/** A tuple is derived only after the complete original receipt and its SQL identity were verified. */
export const HindsightTemplateBackupReceiptTupleSchema = z.strictObject({
  request_id: UUID, request_hash: Hash, receipt_hash: Hash,
});
export type HindsightTemplateBackupReceiptTuple = z.infer<typeof HindsightTemplateBackupReceiptTupleSchema>;
export const HindsightTemplateBackupReceiptInventorySchema = z.strictObject({ count: z.int().nonnegative(), digest: Hash });
export type HindsightTemplateBackupReceiptInventory = z.infer<typeof HindsightTemplateBackupReceiptInventorySchema>;

/** Only the digest leaves Native; the context input contains real non-secret authenticated identifiers. */
export const HindsightTemplateBackupConfigurationObservationSchema = z.strictObject({
  version: z.literal(1), source: z.enum(["local-service", "authenticated-service"]),
  observationId: UUID, observedAt: z.iso.datetime({ offset: true }).max(64), schema: z.string().min(1).max(120),
  contextHash: Hash, requestHash: Hash, inheritedConfigHash: Hash, observationHash: Hash,
});
export type HindsightTemplateBackupConfigurationObservation = z.infer<typeof HindsightTemplateBackupConfigurationObservationSchema>;

const Selected = z.strictObject({
  state: z.literal("selected"), requestId: UUID, requestHash: Hash, receiptHash: Hash,
  databaseDefinitionHash: Hash, inheritedConfigHash: Hash, definitionProjectionHash: Hash,
  configurationObservation: HindsightTemplateBackupConfigurationObservationSchema,
}).refine((value) => value.inheritedConfigHash === value.configurationObservation.inheritedConfigHash,
  "configuration observation names the inherited projection");

export const HindsightTemplateBackupBankProofV2Schema = z.strictObject({
  target: HindsightTemplateTargetSchema,
  receiptInventory: HindsightTemplateBackupReceiptInventorySchema,
  selected: z.discriminatedUnion("state", [Selected, z.strictObject({ state: z.literal("unselected") })]),
});
export type HindsightTemplateBackupBankProofV2 = z.infer<typeof HindsightTemplateBackupBankProofV2Schema>;

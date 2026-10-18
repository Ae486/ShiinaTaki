/**
 * INPUT:  strict versioned manifest bases and a complete original Native backup request
 * OUTPUT: version-preserving staged Core records with exact request/scope/receipt-list binding
 * POS:    private Core artifact metadata; staged records never pretend to contain a Native ZIP proof
 */
import { z } from "zod";
import { HindsightBackupManifestV1BaseSchema, HindsightBackupManifestV2BaseSchema,
  HindsightBackupNativeRequestV1Schema, HindsightBackupNativeRequestV2Schema } from "@taki/shared";
import { hindsightBackupOperationDigest } from "./hindsight-backup-pair.ts";

const omitted = { route: true, native: true, sensitive: true, verifiedAt: true } as const;
const V1 = HindsightBackupManifestV1BaseSchema.omit(omitted);
const V2 = HindsightBackupManifestV2BaseSchema.omit(omitted);
export const HindsightBackupStagedCoreSchema = z.discriminatedUnion("version", [V1, V2]);
export const HindsightBackupStagedRecordSchema = z.union([
  z.strictObject({ request: HindsightBackupNativeRequestV1Schema, core: V1 }),
  z.strictObject({ request: HindsightBackupNativeRequestV2Schema, core: V2 }),
]).refine(({ request, core }) => request.backupId === core.backupId && request.createdAt === core.createdAt
  && request.providerLineageId === core.authority.providerLineageId
  && request.nativeBankIds.length === core.banks.length
  && core.banks.every((bank) => request.nativeBankIds.includes(bank.nativeBankId))
  && request.operationIds.length === core.terminalOperations.count
  && hindsightBackupOperationDigest(request.operationIds) === core.terminalOperations.digest
  && (request.version === 1 || core.version === 2 && request.requestHash === core.requestHash),
"staged request belongs to its exact copied identity");
export type HindsightBackupStagedRecord = z.infer<typeof HindsightBackupStagedRecordSchema>;

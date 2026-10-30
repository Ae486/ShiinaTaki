/**
 * INPUT:  immutable D77 body upload descriptors and scoped part requests or receipts
 * OUTPUT: bounded multipart wire schemas with separate byte and semantic checksums
 * POS:    shared application-state transport — large logical records remain complete through body parts
 */
import { z } from "zod";
import {
  HINDSIGHT_APPLICATION_PART_BYTES, TakiApplicationBodyRefSchema, TakiApplicationNamespaceSchema,
  TakiApplicationIdSchema as Id, TakiApplicationHashSchema as Hash, TakiApplicationCountSchema as Count,
  TakiApplicationTimeSchema as Time,
} from "./hindsight-application-primitives-schema.ts";

export const TakiApplicationBodyUploadRequestSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, descriptor: TakiApplicationBodyRefSchema,
});
export type TakiApplicationBodyUploadRequest = z.infer<typeof TakiApplicationBodyUploadRequestSchema>;
export const TakiApplicationBodyUploadStatusSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, bank_id: Id, descriptor: TakiApplicationBodyRefSchema,
  state: z.enum(["uploading", "sealed"]), received_parts: Count, expires_at: Time.nullable(),
});
export type TakiApplicationBodyUploadStatus = z.infer<typeof TakiApplicationBodyUploadStatusSchema>;
export const TakiApplicationBodyPartRequestSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, part_sha256: Hash,
  data_base64: z.string().max(4 * Math.ceil(HINDSIGHT_APPLICATION_PART_BYTES / 3)),
});
export type TakiApplicationBodyPartRequest = z.infer<typeof TakiApplicationBodyPartRequestSchema>;
export const TakiApplicationBodyPartReceiptSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, bank_id: Id, body_id: z.uuid(), part_number: Count,
  part_sha256: Hash, total_bytes: Count, part_hash: Hash,
});
export type TakiApplicationBodyPartReceipt = z.infer<typeof TakiApplicationBodyPartReceiptSchema>;
export const TakiApplicationBodyPartSchema = TakiApplicationBodyPartReceiptSchema.extend({ data_base64: z.string() });
export type TakiApplicationBodyPart = z.infer<typeof TakiApplicationBodyPartSchema>;

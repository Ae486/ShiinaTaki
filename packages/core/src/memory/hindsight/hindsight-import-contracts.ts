/**
 * INPUT:  untrusted JSON from Hindsight retain, operation, document, and fact endpoints
 * OUTPUT: bounded native retain/operation/document/fact wire schemas shared by import and Pending Memory
 * POS:    core/memory/hindsight — data-plane validation boundary; raw provider errors do not escape
 */
import { z } from "zod";

const text = z.string().min(1).max(100_000);
const id = z.string().min(1).max(512);
export const HindsightRetainResponseSchema = z.object({ success: z.boolean(), bank_id: id, items_count: z.number().int().min(1), async: z.boolean(), operation_id: id.optional().nullable(), operation_ids: z.array(id).max(8).optional().nullable() }).passthrough();
export const HindsightDetailedOperationSchema = z.object({ operation_id: id, status: z.enum(["pending", "processing", "completed", "failed", "cancelled", "not_found"]), operation_type: z.string().min(1).max(128).nullable().optional(), result_metadata: z.record(z.string().min(1).max(128), z.unknown()).nullable().optional() }).passthrough();
export const HindsightDocumentResponseSchema = z.object({ id, bank_id: id, original_text: text.nullable().optional(), content_hash: z.string().max(256).nullable().optional(), memory_unit_count: z.number().int().min(0), updated_at: z.string().max(128).optional() }).passthrough();
export const HindsightFactPageResponseSchema = z.object({ items: z.array(z.record(z.string().min(1).max(128), z.unknown())).max(100), total: z.number().int().min(0), limit: z.number().int().min(1).max(100), offset: z.number().int().min(0) }).passthrough();

export type HindsightImportOperationWire = z.infer<typeof HindsightDetailedOperationSchema>;
export type HindsightImportDocumentWire = z.infer<typeof HindsightDocumentResponseSchema>;
export type HindsightImportFactWire = Record<string, unknown>;

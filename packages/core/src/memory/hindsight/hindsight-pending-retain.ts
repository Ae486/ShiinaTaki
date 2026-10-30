/**
 * INPUT:  one submitted Pending Memory retain and the existing native operation/document/fact readers
 * OUTPUT: bounded native extraction receipt, deferred status, or an explicit unresolved/failed outcome
 * POS:    core/memory/hindsight — native completion mapping only; observation/graph completion is a separate required fence
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { PendingMemoryNativeReceiptSchema, type PendingMemoryNativeReceipt, type PendingMemoryRecord } from "@taki/shared";
import type { HindsightCallContext, HindsightClient } from "./hindsight-client.ts";

interface Input {
  record: PendingMemoryRecord; client: HindsightClient; request: () => HindsightCallContext; now: () => string;
}
const FactSchema = z.object({ id: z.uuid(), document_id: z.string().min(1).max(256), revision: z.int().min(1) });

export async function resolvePendingRetain(input: Input): Promise<PendingMemoryNativeReceipt | undefined> {
  const { record, client } = input;
  if (!client.operationImportStatus || !client.document || !client.factPage) throw new Error("HINDSIGHT_PENDING_CLIENT_UNAVAILABLE");
  const operation = await client.operationImportStatus(record.intent.bank.bankId, record.remoteOperationId, input.request());
  input.request();
  if (operation.operationId !== record.remoteOperationId) throw new Error("HINDSIGHT_PENDING_RECEIPT_INVALID");
  // Native retain operation rows are pruned. A missing row after dispatch is not permission to submit again.
  if (operation.status === "not_found") throw new Error("HINDSIGHT_PENDING_OUTCOME_UNKNOWN");
  if (operation.operationType !== "batch_retain") throw new Error("HINDSIGHT_PENDING_RECEIPT_INVALID");
  if (operation.status === "pending" || operation.status === "processing") return undefined;
  if (operation.status === "failed") throw new Error("HINDSIGHT_PENDING_OPERATION_FAILED");
  if (operation.status === "cancelled") throw new Error("HINDSIGHT_PENDING_OPERATION_CANCELLED");
  if (operation.resultMetadataHash === null || operation.derivedUnitCount === null || operation.extractionErrorCount !== 0
    || record.intent.operation.kind !== "retain" || record.documentId === null) throw new Error("HINDSIGHT_PENDING_RECEIPT_INVALID");
  if (operation.derivedUnitCount > 256 || (operation.derivedUnitCount === 0 && !record.intent.operation.zeroResultAllowed)) {
    throw new Error("HINDSIGHT_PENDING_RECEIPT_INVALID");
  }
  await verifyDocument(input, operation.derivedUnitCount);
  const memories = await readFacts(input, operation.derivedUnitCount);
  return PendingMemoryNativeReceiptSchema.parse({ kind: "retain", operationId: record.remoteOperationId,
    documentId: record.documentId, memories, resultMetadataHash: operation.resultMetadataHash, completedAt: input.now() });
}

async function verifyDocument(input: Input, count: number): Promise<void> {
  const { record, client } = input;
  if (!client.document || record.documentId === null || record.intent.operation.kind !== "retain") throw new Error("HINDSIGHT_PENDING_RECEIPT_INVALID");
  const document = await client.document(record.intent.bank.bankId, record.documentId, input.request());
  input.request();
  const hash = createHash("sha256").update(record.intent.operation.request.content).digest("hex");
  const providerHash = document.content_hash?.replace(/^sha256:/, "");
  if (document.id !== record.documentId || document.bank_id !== record.intent.bank.bankId || document.memory_unit_count !== count
    || (providerHash ? providerHash !== hash : document.original_text !== record.intent.operation.request.content)) {
    throw new Error("HINDSIGHT_PENDING_RECEIPT_INVALID");
  }
}

async function readFacts(input: Input, count: number): Promise<Array<{ memoryId: string; revision: number }>> {
  const { record, client } = input;
  if (!client.factPage || record.documentId === null) throw new Error("HINDSIGHT_PENDING_RECEIPT_INVALID");
  const result: Array<{ memoryId: string; revision: number }> = [];
  do {
    const page = await client.factPage({ bankId: record.intent.bank.bankId, documentId: record.documentId,
      limit: 100, offset: result.length, context: input.request() });
    input.request();
    if (page.offset !== result.length || page.limit !== 100 || page.total !== count || page.items.length + result.length > count) {
      throw new Error("HINDSIGHT_PENDING_RECEIPT_INVALID");
    }
    for (const raw of page.items) {
      const parsed = FactSchema.safeParse(raw);
      if (!parsed.success || parsed.data.document_id !== record.documentId || (raw.bank_id !== undefined && raw.bank_id !== record.intent.bank.bankId)) {
        throw new Error("HINDSIGHT_PENDING_RECEIPT_INVALID");
      }
      result.push({ memoryId: parsed.data.id, revision: parsed.data.revision });
    }
    if (result.length < count && page.items.length === 0) throw new Error("HINDSIGHT_PENDING_RECEIPT_INVALID");
  } while (result.length < count);
  if (new Set(result.map((item) => item.memoryId)).size !== result.length) throw new Error("HINDSIGHT_PENDING_RECEIPT_INVALID");
  return result;
}

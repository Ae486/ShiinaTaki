/**
 * INPUT:  one admitted durable Pending retain and its original source/provenance/metadata
 * OUTPUT: an immutable application Source artifact prepared before any native source dispatch
 * POS:    core/memory/hindsight — source preservation only; a source intent never becomes a confirmed fact or per-unit policy
 */
import {
  HindsightCurrentCanonicalSourceSchema, TakiApplicationSourceBodySchema, type PendingMemoryRecord,
} from "@taki/shared";
import { createHash } from "node:crypto";
import type { HindsightCallContext } from "./hindsight-client.ts";
import { HindsightApplicationRefusal } from "./hindsight-application-client.ts";
import { prepareHindsightApplicationBody } from "./hindsight-application-body-transfer.ts";
import type { HindsightApplicationWriter } from "./hindsight-application-writer.ts";
import { retainItem } from "./hindsight-pending-client.ts";
import { hindsightError } from "./hindsight-errors.ts";

export function prepareHindsightPendingSource(input: { writer: HindsightApplicationWriter; record: PendingMemoryRecord }) {
  const { record } = input; const operation = record.intent.operation;
  if (operation.kind !== "retain" || record.documentId === null) throw new Error("HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED");
  const namespace = { provider_lineage: record.intent.providerLineageId,
    bank_generation: record.intent.bankGeneration, application_id: "taki" as const };
  const scope = { bankId: record.intent.bank.bankId, namespace };
  const request = operation.request; const documentId = record.documentId;
  return input.writer.prepare({ namespace, key: { authorityEpochId: record.intent.authorityEpochId,
    bankId: scope.bankId, requestId: `source:${record.remoteOperationId}` },
  intent: { purpose: "preserve-original-source", nativeOperationId: record.remoteOperationId, intent: record.intent },
  create: () => {
    const encoded = retainItem({ request, documentId, originalAt: record.intent.originalAt }).metadata ?? null;
    // Revision 1 belongs to this newly created application source, not a
    // predicted native document revision. The native witness remains absent.
    const original = HindsightCurrentCanonicalSourceSchema.parse({ authorityEpochId: record.intent.authorityEpochId,
      bankId: scope.bankId, documentId, contentHash: createHash("sha256").update(request.content, "utf8").digest("hex"),
      retainedText: request.content, context: request.context, tags: request.tags, metadata: request.metadata,
      observationScopes: request.observationScopes, provenance: request.provenance, revision: 1,
      createdAt: record.intent.originalAt, updatedAt: record.intent.originalAt });
    const value = TakiApplicationSourceBodySchema.parse({ original_source: original, encoded_metadata: encoded,
      original_witness: null, operation_id: record.remoteOperationId });
    const body = prepareHindsightApplicationBody({ ...scope, schema: "application-source.v1", value });
    return { bodies: [body], commands: [{ command: "put_artifact", key: { artifact_kind: "source", artifact_id: `retain:${record.remoteOperationId}` },
      expected_artifact: null, body_ref: body.ref, binding: { kind: "awaiting_native", operation_id: record.remoteOperationId, document_id: documentId },
      expected_native: null, actor: { kind: "background", actor_ref: record.intent.operationId } }] };
  } });
}

export async function ensureHindsightPendingSource(input: {
  writer: HindsightApplicationWriter; record: PendingMemoryRecord; context: HindsightCallContext;
}): Promise<void> {
  if (input.record.intent.operation.kind !== "retain") return;
  const job = prepareHindsightPendingSource(input);
  const result = await input.writer.run({ key: job.key, context: input.context });
  if (result.status === "pending") throw hindsightError(result.code);
  if (result.status === "refused") {
    if (!result.job.receipt?.refusal) throw new Error("MEMORY_INTEGRITY_ERROR");
    throw new HindsightApplicationRefusal(result.job.receipt.refusal);
  }
}

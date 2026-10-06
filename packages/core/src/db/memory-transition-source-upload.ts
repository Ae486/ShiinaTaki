/**
 * INPUT: complete captured Local aliases, verified common baseline and a current native transition owner
 * OUTPUT: immutable exact Source body bytes/ref/request before the first upload and durable executor request attempts
 * POS: core/db — W3 upload preparation, no asynchronous I/O or authority publication
 */
import { MemoryTransitionSourceUploadSchema, MemoryTransitionSourceUploadAttemptSchema,
  type MemoryTransitionCandidate, type MemoryTransitionLocalCapture, type HindsightTransitionStatus,
  type MemoryTransitionScopeMapping, type MemoryTransitionSourceUpload, type MemoryTransitionSourceUploadAttempt,
  type HindsightTransitionExecutor } from "@taki/shared";
import { transitionSemanticHash } from "../memory/transitions/transition-local-projection.ts";
import { prepareHindsightApplicationBody } from "../memory/hindsight/hindsight-application-body-transfer.ts";
import { decodeHindsightApplicationBody, hindsightApplicationHash, sameApplicationValue } from "../memory/hindsight/hindsight-application-integrity.ts";
import { insertTransitionDocument, readTransitionDocument, transitionDocumentHash } from "./memory-transition-document-repo.ts";
import { requireTransitionPreparation, type TransitionCaptureInput } from "./memory-transition-local-capture.ts";
import type { Database } from "./sqlite.ts";

export function prepareTransitionSourceUploads(db: Database, input: { capture: MemoryTransitionLocalCapture;
  baseline: MemoryTransitionCandidate; scope: MemoryTransitionScopeMapping; target: HindsightTransitionStatus }): MemoryTransitionSourceUpload[] {
  const uploads: MemoryTransitionSourceUpload[] = [];
  for (const alias of input.baseline.state.sourceAliases.filter((row) => row.bankId === input.scope.localBankId)) {
    const source = input.capture.state.sources.find((row) => row.bankId === alias.bankId && row.documentId === alias.documentId);
    const before = input.baseline.state.sources.find((row) => row.bankId === alias.bankId && row.documentId === alias.documentId);
    if (!before) invalid();
    if (!source || transitionSemanticHash(source) === transitionSemanticHash(before)) continue;
    if (alias.retired) invalid();
    const slot = JSON.stringify([alias.bankId, alias.documentId]);
    const existing = readTransitionDocument(db, "source_uploads", { transitionId: input.capture.transitionId, slot, schema: MemoryTransitionSourceUploadSchema });
    const namespace = { application_id: "taki" as const, provider_lineage: input.target.request.provider_lineage, bank_generation: input.target.request.bank_generation };
    const sourceHash = hindsightApplicationHash({ namespace, bankId: input.scope.nativeBankId, domain: "transition-source-evidence", value: source });
    if (existing) { if (existing.captureId !== input.capture.captureId || existing.sourceHash !== sourceHash) invalid(); uploads.push(existing); continue; }
    const body = prepareHindsightApplicationBody({ bankId: input.scope.nativeBankId, namespace, schema: "application-source.v1",
      value: { original_source: source, encoded_metadata: null, original_witness: null, operation_id: null } });
    const value = { version: 1 as const, transitionId: input.capture.transitionId, captureId: input.capture.captureId,
      localBankId: alias.bankId, documentId: alias.documentId, nativeBankId: input.scope.nativeBankId, namespace, sourceHash,
      ref: body.ref, base64: Buffer.from(body.bytes).toString("base64"), request: { namespace, descriptor: body.ref, executor: input.target.executor } };
    const upload = MemoryTransitionSourceUploadSchema.parse({ ...value, uploadId: transitionDocumentHash("source_uploads", value) });
    insertTransitionDocument(db, "source_uploads", { id: upload.uploadId, transitionId: upload.transitionId, slot, value: upload }); uploads.push(upload);
  }
  return uploads;
}
export function readTransitionSourceUploads(db: Database, transitionId: string): MemoryTransitionSourceUpload[] {
  return db.prepare("SELECT id FROM memory_transition_source_uploads WHERE transition_id=:transition ORDER BY slot").all({ transition: transitionId }).map((row) => {
    const upload = readTransitionDocument(db, "source_uploads", { id: String(row.id), schema: MemoryTransitionSourceUploadSchema }); if (!upload) invalid();
    const body = decodeHindsightApplicationBody({ bankId: upload.nativeBankId, namespace: upload.namespace,
      ref: upload.ref, bytes: Buffer.from(upload.base64, "base64") });
    if (!sameApplicationValue(upload.request.descriptor, upload.ref) || !sameApplicationValue(upload.request.namespace, upload.namespace)
      || upload.request.executor.transition_id !== transitionId || body.content.body_schema !== "application-source.v1"
      || hindsightApplicationHash({ bankId: upload.nativeBankId, namespace: upload.namespace, domain: "transition-source-evidence",
        value: body.content.value.original_source }) !== upload.sourceHash) invalid();
    return upload;
  });
}
export function prepareTransitionSourceUploadAttempt(db: Database, input: TransitionCaptureInput & { upload: MemoryTransitionSourceUpload; executor: HindsightTransitionExecutor }) {
  let result: MemoryTransitionSourceUploadAttempt | undefined;
  db.transaction(() => {
    const intent = requireTransitionPreparation(db, input);
    if (input.upload.transitionId !== intent.transitionId || input.executor.transition_id !== intent.transitionId) invalid();
    const value = { transitionId: intent.transitionId, uploadId: input.upload.uploadId, request: { ...input.upload.request, executor: input.executor } };
    result = MemoryTransitionSourceUploadAttemptSchema.parse({ ...value, attemptId: transitionDocumentHash("source_upload_attempts", value) });
    insertTransitionDocument(db, "source_upload_attempts", { id: result.attemptId, transitionId: intent.transitionId,
      slot: JSON.stringify([input.upload.uploadId, input.executor]), value: result });
  });
  if (!result) invalid(); return result;
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }

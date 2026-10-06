/**
 * INPUT:  complete writer-reserved Local capture, healthy common baseline and exact native re-entry owner
 * OUTPUT: immutable delta request/result identities and guarded complete mapping validation
 * POS:    core/db — W3 preparation/replay storage; native execution and W4 authority remain separate
 */
import { randomUUID } from "node:crypto";
import { HINDSIGHT_TRANSITION_MAX_BYTES, HindsightTransitionDeltaRequestSchema, MemoryTransitionPreparationSchema,
  MemoryTransitionDeltaEvidenceSchema, type HindsightTransitionStatus, type MemoryTransitionPreparation,
  type MemoryTransitionUnusedInventory, type HindsightTransitionDeltaResult, type MemoryTransitionScopeMapping } from "@taki/shared";
import { hindsightTransitionHash, signHindsightTransitionDelta, validateHindsightTransitionStatus,
  validateHindsightTransitionDelta } from "../memory/hindsight/hindsight-transition-proof.ts";
import { compileTransitionNativeDelta } from "../memory/transitions/transition-delta-rows.ts";
import { compileTransitionApplicationDelta } from "../memory/transitions/transition-delta-application.ts";
import { compileTransitionUnusedDelta } from "../memory/transitions/transition-unused-delta.ts";
import { assertTransitionLocalCurrent, readTransitionLocalCapture, requireTransitionPreparation, type TransitionCaptureInput } from "./memory-transition-local-capture.ts";
import { requireTransitionCommonBaseline, readTransitionNativeEvidence } from "./memory-transition-candidate-repo.ts";
import { insertTransitionDocument, readTransitionDocument, transitionDocumentHash } from "./memory-transition-document-repo.ts";
import type { Database } from "./sqlite.ts";
import { prepareTransitionSourceUploads } from "./memory-transition-source-upload.ts";

export function prepareTransitionDelta(db: Database, input: TransitionCaptureInput & { captureId: string;
  localBankId: string; target: HindsightTransitionStatus; retired: HindsightTransitionStatus | null;
  unusedInventory?: MemoryTransitionUnusedInventory }): MemoryTransitionPreparation {
  let prepared: MemoryTransitionPreparation | undefined;
  db.transaction(() => {
    const intent = requireTransitionPreparation(db, input); const expected = intent.request.expected;
    const capture = readTransitionLocalCapture(db, input.captureId); assertTransitionLocalCurrent(db, capture);
    if (capture.transitionId !== intent.transitionId || !expected.baselineHash || !expected.baselineReceiptId
      || expected.sourceProvider !== "local") invalid();
    const common = requireTransitionCommonBaseline(db, { baselineId: expected.baselineHash,
      receiptId: expected.baselineReceiptId, epochId: expected.predecessorEpochId });
    validateHindsightTransitionStatus(input.target, { bankId: input.target.bank_id, transitionId: intent.transitionId });
    if (input.target.request.direction !== "reenter-hindsight" || input.target.request.provider_lineage !== expected.targetLineageId
      || !["fenced", "proven"].includes(input.target.phase)) invalid();
    const previous = readTransitionDocument(db, "preparations", { transitionId: intent.transitionId,
      slot: input.localBankId, schema: MemoryTransitionPreparationSchema });
    if (previous) {
      if (previous.captureId !== capture.captureId || previous.target.request.request_hash !== input.target.request.request_hash) invalid();
      prepared = previous; return;
    }
    const existing = common.candidate.scopes.find((scope) => scope.localBankId === input.localBankId);
    const localBank = capture.state.banks.find((bank) => bank.bankId === input.localBankId); if (!localBank) invalid();
    let scope: MemoryTransitionScopeMapping; let compiled;
    if (existing) {
      const evidence = readTransitionNativeEvidence(db, existing.evidenceId); requireRetiredBaseline(input, { existing, common, evidence });
      scope = { ...existing, origin: "baseline" as const };
      const native = compileTransitionNativeDelta({ capture, baseline: common.candidate, localBankId: input.localBankId,
        nativeBankId: scope.nativeBankId, mappings: common.candidate.mappings.filter((row) => row.localBankId === input.localBankId) });
      const uploads = prepareTransitionSourceUploads(db, { capture, baseline: common.candidate, scope, target: input.target });
      const application = compileTransitionApplicationDelta({ capture, baseline: common.candidate, evidence,
        localBankId: input.localBankId, localLineageId: expected.sourceLineageId, native: native.native, uploads });
      compiled = { ...native, application, chunks: retainedChunks(evidence, common.candidate.mappings, native.native) };
    } else {
      if (!input.unusedInventory || input.retired || !input.target.request.unused_scope
        || common.candidate.scopes.some((row) => hindsightTransitionHash(row.scope) === hindsightTransitionHash(localBank.scope))) invalid();
      compiled = compileTransitionUnusedDelta({ capture, localBankId: input.localBankId, localLineageId: expected.sourceLineageId,
        target: input.target, inventory: input.unusedInventory });
      scope = { scope: localBank.scope, localBankId: localBank.bankId, nativeBankId: input.target.bank_id,
        nativeGeneration: input.target.request.bank_generation, origin: "new", originEpochId: capture.epochId,
        evidenceId: hindsightTransitionHash(input.unusedInventory) };
    }
    const request = signPreparedDelta(input.target, capture.contentHash, compiled);
    prepared = persistPreparation(db, { version: 1 as const, transitionId: intent.transitionId, captureId: capture.captureId,
      baselineId: common.baseline.baselineId, scope, target: input.target, request, unusedInventory: input.unusedInventory ?? null });
  });
  if (!prepared) invalid(); return prepared;
}
function signPreparedDelta(target: HindsightTransitionStatus, manifestHash: string,
  compiled: Pick<MemoryTransitionPreparation["request"], "native" | "application" | "chunks" | "rows">) {
  const request = signHindsightTransitionDelta(target.bank_id, HindsightTransitionDeltaRequestSchema.parse({ ...compiled,
    executor: target.executor, operation_id: randomUUID(), request_hash: "0".repeat(64), baseline_transition_id: target.request.baseline_transition_id,
    baseline_proof_hash: target.request.baseline_proof_hash, unused_scope: target.request.unused_scope, local_manifest_hash: manifestHash }));
  if (Buffer.byteLength(JSON.stringify(request)) > HINDSIGHT_TRANSITION_MAX_BYTES) invalid(); return request;
}
function persistPreparation(db: Database, body: Omit<MemoryTransitionPreparation, "preparationId">): MemoryTransitionPreparation {
  const value = MemoryTransitionPreparationSchema.parse({ ...body, preparationId: transitionDocumentHash("preparations", body) });
  insertTransitionDocument(db, "preparations", { id: value.preparationId, transitionId: value.transitionId, slot: value.scope.localBankId, value });
  return value;
}
function requireRetiredBaseline(input: Parameters<typeof prepareTransitionDelta>[1], context: {
  existing: MemoryTransitionScopeMapping; common: ReturnType<typeof requireTransitionCommonBaseline>;
  evidence: ReturnType<typeof readTransitionNativeEvidence>;
}): void {
  const retired = input.retired; const { existing, common, evidence } = context; const proof = evidence.status.proof;
  if (!retired || !proof || input.unusedInventory || input.target.request.unused_scope) invalid();
  validateHindsightTransitionStatus(retired, { bankId: existing.nativeBankId, transitionId: common.baseline.transitionId });
  if (input.target.bank_id !== existing.nativeBankId || input.target.request.bank_generation !== existing.nativeGeneration
    || input.target.request.baseline_transition_id !== common.baseline.transitionId
    || input.target.request.baseline_proof_hash !== proof.proof_hash || retired.phase !== "retired"
    || retired.proof?.proof_hash !== proof.proof_hash || retired.outcome?.request.core_receipt_id !== common.receipt.receiptId
    || retired.outcome.request.disposition !== "retire") invalid();
}
function retainedChunks(evidence: ReturnType<typeof readTransitionNativeEvidence>, mappings: Parameters<typeof compileTransitionNativeDelta>[0]["mappings"],
  native: Parameters<typeof compileTransitionApplicationDelta>[0]["native"]) {
  return evidence.auxiliaryPages.flatMap((page) => page.records).filter((row) => row.table === "chunks").map((entry) => {
    const row = JSON.parse(entry.row_json) as Record<string, unknown>;
    const document = mappings.find((mapping) => mapping.kind === "document" && mapping.native.object_id === row.document_id);
    if (!document) invalid();
    const deleted = native.find((item) => item.source.source_kind === "document" && item.source.source_id === document.localId)?.disposition === "delete";
    return { source_chunk_id: String(row.chunk_id), source_document_id: document.localId, target_chunk_id: String(row.chunk_id),
      chunk_index: Number(row.chunk_index), content_hash: String(row.content_hash), disposition: deleted ? "delete" as const : "reuse" as const };
  });
}
export function readTransitionPreparation(db: Database, id: string): MemoryTransitionPreparation {
  const value = readTransitionDocument(db, "preparations", { id, schema: MemoryTransitionPreparationSchema });
  if (!value || signHindsightTransitionDelta(value.scope.nativeBankId, value.request).request_hash !== value.request.request_hash) invalid();
  return value;
}
export function recordTransitionDeltaResult(db: Database, input: TransitionCaptureInput & { preparationId: string; result: HindsightTransitionDeltaResult }) {
  let resultId = "";
  db.transaction(() => {
    const intent = requireTransitionPreparation(db, input); const prepared = readTransitionPreparation(db, input.preparationId);
    if (prepared.transitionId !== intent.transitionId) invalid();
    validatePreparedDeltaResult(prepared, input.result);
    const body = { version: 1 as const, transitionId: intent.transitionId, preparationId: prepared.preparationId, result: input.result };
    resultId = transitionDocumentHash("delta_results", body);
    insertTransitionDocument(db, "delta_results", { id: resultId, transitionId: intent.transitionId,
      slot: prepared.scope.localBankId, value: { ...body, resultId } });
  });
  return resultId;
}
export function readTransitionDeltaResult(db: Database, transitionId: string, localBankId: string) {
  return readTransitionDocument(db, "delta_results", { transitionId, slot: localBankId, schema: MemoryTransitionDeltaEvidenceSchema });
}
export function validatePreparedDeltaResult(prepared: MemoryTransitionPreparation, result: HindsightTransitionDeltaResult): void {
  validateHindsightTransitionDelta(result, { bankId: prepared.scope.nativeBankId, transitionId: prepared.transitionId, request: prepared.request });
  if (result.provider_lineage !== prepared.target.request.provider_lineage || result.bank_generation !== prepared.scope.nativeGeneration
    || result.mappings.length !== prepared.request.native.length || result.artifacts.length !== prepared.request.application.length) invalid();
  const mappings = new Map(result.mappings.map((row) => [JSON.stringify([row.source.source_kind, row.source.source_id]), row]));
  if (mappings.size !== result.mappings.length) invalid();
  for (const item of prepared.request.native) {
    const actual = mappings.get(JSON.stringify([item.source.source_kind, item.source.source_id]));
    if (!actual || hindsightTransitionHash(actual.source) !== hindsightTransitionHash(item.source)
      || actual.disposition !== ({ reuse: "reused", upsert: "upserted", delete: "deleted" } as const)[item.disposition]
      || item.disposition === "delete" && hindsightTransitionHash(actual.target) !== hindsightTransitionHash(item.target)
      || item.disposition !== "delete" && !actual.target
      || actual.target && item.target && actual.target.object_id !== item.target.object_id
      || item.disposition === "reuse" && hindsightTransitionHash(actual.target) !== hindsightTransitionHash(item.target)) invalid();
  }
  const artifacts = new Map(result.artifacts.map((row) => [JSON.stringify(row.key), row]));
  if (artifacts.size !== result.artifacts.length) invalid();
  for (const item of prepared.request.application) {
    const actual = artifacts.get(JSON.stringify(item.key));
    if (!actual || actual.source_record_hash !== item.source_record_hash
      || hindsightTransitionHash(actual.previous) !== hindsightTransitionHash(item.expected_artifact)
      || actual.previous_body_hash !== item.expected_body_hash || JSON.stringify(actual.current.key) !== JSON.stringify(item.key)
      || item.disposition === "reuse" && (actual.disposition !== "reused" || hindsightTransitionHash(actual.current) !== hindsightTransitionHash(item.expected_artifact))
      || item.disposition === "retire" && actual.disposition !== "retired") invalid();
  }
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }

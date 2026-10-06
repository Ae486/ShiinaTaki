/**
 * INPUT:  complete current Local state, baseline mappings and exact native payload witnesses
 * OUTPUT: native descriptor reuse/upsert/delete with only changed structured bodies and real retirement evidence
 * POS:    core/memory/transitions — W3 delta compiler; epoch relocation alone never edits native content
 */
import { HindsightTransitionDeltaRequestSchema, type MemoryTransitionLocalCapture, type MemoryTransitionCandidate,
  type MemoryTransitionObjectMapping, type HindsightTransitionDeltaRequest, type HindsightCurrentSourceWitness,
  type MemoryTransitionLocalState } from "@taki/shared";
import { hindsightTransitionHash } from "../hindsight/hindsight-transition-proof.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";
import { transitionObjectKey } from "./transition-local-projection.ts";

export type LocalObject = { kind: MemoryTransitionObjectMapping["kind"]; id: string; revision: number; value: object; native: Record<string, unknown> };
export function transitionLocalObjects(state: MemoryTransitionLocalState, bankId: string): LocalObject[] {
  const banks = state.banks.filter((bank) => bank.bankId === bankId).map((bank) => ({ kind: "bank" as const, id: bankId,
    revision: bank.revision, value: bank, native: { payload: snake(bank, ["authorityEpochId", "scope", "revision"]) } }));
  const sources = state.sources.filter((source) => source.bankId === bankId
    && !state.sourceAliases.some((alias) => alias.bankId === bankId && alias.documentId === source.documentId)).map((source) => ({ kind: "document" as const,
    id: source.documentId, revision: source.revision, value: source,
    native: { ...snake(source, ["authorityEpochId", "bankId", "documentId", "revision", "provenance", "retainedText"]), original_text: source.retainedText } }));
  const units = state.records.filter(({ unit }) => unit.bankId === bankId).map((record) => ({ kind: "memory_unit" as const,
    id: record.unit.memoryId, revision: record.unit.revision, value: record,
    native: snake(record.unit, ["authorityEpochId", "bankId", "memoryId", "revision"]) }));
  const derived = state.derived.filter((row) => row.bankId === bankId).map((row) => ({ kind: row.payload.kind,
    id: row.payload.kind === "mental_model" ? row.payload.mentalModelId : row.payload.directiveId,
    revision: row.objectRevision, value: row, native: snake(row.payload, ["kind", "bankId", "mentalModelId", "directiveId"]) }));
  return [...banks, ...sources, ...units, ...derived];
}
export function compileTransitionNativeDelta(input: { capture: MemoryTransitionLocalCapture; baseline: MemoryTransitionCandidate;
  localBankId: string; nativeBankId: string; mappings: MemoryTransitionObjectMapping[] }) {
  const current = new Map(transitionLocalObjects(input.capture.state, input.localBankId).map((row) => [transitionObjectKey(row.kind, row.id), row]));
  const before = new Map(transitionLocalObjects(input.baseline.state, input.localBankId).map((row) => [transitionObjectKey(row.kind, row.id), row]));
  const mapped = new Set(input.mappings.map((row) => transitionObjectKey(row.kind, row.localId)));
  const native: HindsightTransitionDeltaRequest["native"] = [];
  const rows: HindsightTransitionDeltaRequest["rows"] = { bank: null, documents: [], chunks: [], memory_units: [], mental_models: [], directives: [] };
  for (const mapping of input.mappings) {
    const key = transitionObjectKey(mapping.kind, mapping.localId); const object = current.get(key); const old = before.get(key);
    if (!old) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    const source = sourceWitness(object ?? old);
    const target = { object_kind: mapping.native.object_kind, object_id: mapping.native.object_id,
      object_revision: mapping.native.object_revision, payload_hash: mapping.native.payload_hash };
    if (!object) {
      native.push({ source, target, disposition: "delete", body_hash: null, retirement: transitionRetirement(input.capture, old) });
    } else if (sameNativeContent(object, old)) {
      native.push({ source, target, disposition: "reuse", body_hash: null, retirement: null });
    } else {
      const body = historicalBody(structuredBody(object, input.nativeBankId), { ...input, object });
      native.push({ source, target, disposition: "upsert", body_hash: hindsightTransitionHash(body), retirement: null });
      appendBody(rows, object.kind, body);
    }
  }
  for (const [key, object] of current) if (!mapped.has(key)) {
    const body = historicalBody(structuredBody(object, input.nativeBankId), { ...input, object });
    native.push({ source: sourceWitness(object), target: null, disposition: "upsert", body_hash: hindsightTransitionHash(body), retirement: null });
    appendBody(rows, object.kind, body);
  }
  return { native, rows: HindsightTransitionDeltaRequestSchema.shape.rows.parse(rows) };
}
export function sourceWitness(object: LocalObject): HindsightCurrentSourceWitness {
  return { source_kind: object.kind, source_id: object.id, source_revision: object.revision, source_payload_hash: transitionLocalHash(object.value) };
}
export function nativeContentHash(object: LocalObject): string {
  const row = { ...object.native };
  if (object.kind === "bank" && row.payload && typeof row.payload === "object") {
    row.payload = Object.fromEntries(Object.entries(row.payload).filter(([key]) => key !== "bank_id"));
  }
  return transitionLocalHash(row);
}
export function sameNativeContent(current: LocalObject, previous: LocalObject): boolean {
  if (nativeContentHash(current) === nativeContentHash(previous)) return true;
  if (current.kind !== "memory_unit" || !("policy" in current.value) || !("policy" in previous.value)
    || transitionLocalHash(policySemantics(current.value.policy)) === transitionLocalHash(policySemantics(previous.value.policy))) return false;
  const stripBookkeeping = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row)
    .filter(([key]) => key !== "updated_at" && key !== "edited_at").map(([key, value]) => [key, key === "tags" && Array.isArray(value)
      ? value.filter((tag) => !String(tag).startsWith("taki-layer:")) : value]));
  return transitionLocalHash(stripBookkeeping(current.native)) === transitionLocalHash(stripBookkeeping(previous.native));
}
function policySemantics(value: unknown): unknown {
  if (!value || typeof value !== "object") throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["authorityEpochId", "bankId", "memoryId", "updatedAt", "policyVersion"].includes(key)));
}
function structuredBody(object: LocalObject, bankId: string): Record<string, unknown> {
  const row: Record<string, unknown> = { source: sourceWitness(object), ...object.native };
  if (object.kind === "bank") row.payload = { ...(row.payload as object), bank_id: bankId };
  return row;
}
function historicalBody(body: Record<string, unknown>, input: { capture: MemoryTransitionLocalCapture;
  baseline: MemoryTransitionCandidate; object: LocalObject; localBankId: string }): Record<string, unknown> {
  if (input.object.kind !== "memory_unit") return body;
  const edges = input.capture.state.historicalReferences.filter((edge) => edge.bankId === input.localBankId && edge.memoryId === input.object.id);
  for (const edge of edges) {
    if (!input.baseline.state.historicalReferences.some((old) => transitionLocalHash(old) === transitionLocalHash(edge))
      || input.capture.state.records.some(({ unit }) => unit.bankId === input.localBankId && unit.memoryId === edge.previous.object_id)) invalid();
  }
  return { ...body, source_memory_ids: (body.source_memory_ids as string[]).map((id) =>
    edges.find((edge) => edge.sourceMemoryId === id)?.previous.object_id ?? id) };
}
function appendBody(rows: HindsightTransitionDeltaRequest["rows"], kind: LocalObject["kind"], body: unknown): void {
  const fields = HindsightTransitionDeltaRequestSchema.shape.rows.shape;
  if (kind === "bank") rows.bank = fields.bank.parse(body);
  else if (kind === "document") rows.documents.push(fields.documents.unwrap().element.parse(body));
  else if (kind === "memory_unit") rows.memory_units.push(fields.memory_units.unwrap().element.parse(body));
  else if (kind === "mental_model") rows.mental_models.push(fields.mental_models.unwrap().element.parse(body));
  else rows.directives.push(fields.directives.unwrap().element.parse(body));
}
export function transitionRetirement(capture: MemoryTransitionLocalCapture, old: LocalObject) {
  const history = capture.state.history.map((entry) => ({ ...entry, row: JSON.parse(entry.rowJson) as Record<string, unknown> }));
  const bankId = "unit" in old.value ? (old.value.unit as { bankId: string }).bankId : (old.value as { bankId: string }).bankId;
  if (old.kind === "memory_unit") {
    const receipt = history.find((entry) => {
      if (entry.table !== "canonical_memory_operation_receipts" || entry.row.authority_epoch_id !== capture.epochId || entry.row.operation !== "maintenance") return false;
      const body = JSON.parse(String(entry.row.result_json));
      return body.kind === "hard-delete-rolling" && body.result.outcome === "deleted" && body.result.bankId === bankId
        && body.result.memoryId === old.id && body.result.deletedRevision >= old.revision;
    });
    if (receipt) {
      const result = JSON.parse(String(receipt.row.result_json)).result;
      const snapshot = history.find((entry) => entry.table === "canonical_memory_revision_snapshots"
        && entry.row.bank_id === bankId && entry.row.memory_id === old.id && entry.row.revision === result.deletedRevision);
      if (!snapshot) invalid();
      return { source_record_id: old.id, source_revision: old.revision, reason: "expired" as const,
        retired_at: String(result.deletedAt), evidence_hash: hindsightTransitionHash([receipt, snapshot]) };
    }
  } else if (old.kind === "document") {
    const retired = history.find((entry) => entry.table === "canonical_memory_retired_sources" && entry.row.authority_epoch_id === capture.epochId
      && entry.row.bank_id === bankId && entry.row.document_id === old.id && Number(entry.row.last_revision) >= old.revision);
    if (retired) return { source_record_id: old.id, source_revision: old.revision, reason: "expired" as const,
      retired_at: String(retired.row.deleted_at), evidence_hash: hindsightTransitionHash(retired) };
  }
  return invalid();
}
function snake(value: object, omit: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omit.includes(key)).map(([key, item]) =>
    [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), item]));
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }

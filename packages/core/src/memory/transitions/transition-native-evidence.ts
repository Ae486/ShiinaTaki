/**
 * INPUT:  exact W2 final status and every native/application/maintenance/auxiliary page and body
 * OUTPUT: complete hash-verified preservation evidence, including unbound heads, tombstones and original history
 * POS:    core/memory/transitions — W3 proof closure; no provider effects or authority publication
 */
import { MemoryTransitionNativeEvidenceSchema, type MemoryTransitionNativeEvidence,
  type HindsightTransitionProof, type TakiApplicationNativeHead } from "@taki/shared";
import { transitionDocumentHash } from "../../db/memory-transition-document-repo.ts";
import { hindsightTransitionHash, validateHindsightTransitionStatus } from "../hindsight/hindsight-transition-proof.ts";
import { decodeHindsightApplicationBody, sameApplicationValue } from "../hindsight/hindsight-application-integrity.ts";
import { verifyHindsightApplicationBundle, type HindsightApplicationBundle } from "../hindsight/hindsight-application-bundle.ts";
import { normalizeSnapshotMetadata, normalizeSnapshotPage } from "../hindsight/hindsight-snapshot-contracts.ts";
import { verifySnapshotContents } from "../hindsight/hindsight-snapshot-validator.ts";
import { verifyCurrentMaintenanceStream } from "../hindsight/hindsight-current-maintenance-stream.ts";
import { currentRequiredSetHash } from "../hindsight/hindsight-current-maintenance-hash.ts";
import { verifyTransitionTemplateAssociation } from "./transition-template-evidence.ts";

export function sealTransitionNativeEvidence(raw: Omit<MemoryTransitionNativeEvidence, "evidenceId">): MemoryTransitionNativeEvidence {
  const evidence = MemoryTransitionNativeEvidenceSchema.parse({ ...raw, evidenceId: "0".repeat(64) });
  const body = Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== "evidenceId"));
  evidence.evidenceId = transitionDocumentHash("native_evidence", body);
  verifyTransitionNativeEvidence(evidence); return evidence;
}
export function verifyTransitionNativeEvidence(evidence: MemoryTransitionNativeEvidence): HindsightApplicationBundle {
  const parsed = MemoryTransitionNativeEvidenceSchema.parse(evidence);
  const { evidenceId, ...body } = parsed;
  if (evidenceId !== transitionDocumentHash("native_evidence", body)) invalid();
  const status = parsed.status;
  validateHindsightTransitionStatus(status, { bankId: status.bank_id, transitionId: parsed.transitionId });
  const proof = status.proof;
  if (!proof || !["proven", "retired", "active"].includes(status.phase)
    || status.active_writers !== 0 || status.accepted_operations !== 0) invalid();
  verifySnapshotContents(normalizeSnapshotMetadata(proof.native_snapshot), parsed.nativePages.map(normalizeSnapshotPage));
  if (hindsightTransitionHash(parsed.nativePages.flatMap((page) => page.records)) !== proof.native_records_hash) invalid();
  const scope = { bankId: status.bank_id, namespace: proof.application_snapshot.namespace };
  const bodies = new Map(parsed.bodies.map(({ ref, base64 }) => {
    const bytes = Buffer.from(base64, "base64");
    if (bytes.toString("base64") !== base64) invalid();
    return [ref.body_id, decodeHindsightApplicationBody({ ...scope, ref, bytes })] as const;
  }));
  if (bodies.size !== parsed.bodies.length) invalid();
  const bundle = { manifest: proof.application_snapshot, pages: parsed.applicationPages, bodies };
  verifyHindsightApplicationBundle(bundle, scope);
  const descriptors = bundle.pages.flatMap((page) => page.records);
  if (hindsightTransitionHash(descriptors) !== proof.application_records_hash) invalid();
  verifyNativeJoin(parsed, bundle);
  verifyMaintenance(parsed, proof); verifyAuxiliary(parsed, proof);
  const hash = hindsightTransitionHash({ domain: "transition-baseline.v1", bank_id: status.bank_id,
    provider_lineage: proof.provider_lineage, bank_generation: proof.bank_generation,
    native_cursor: proof.native_snapshot.manifest.end_cursor, application_checkpoint: proof.application_snapshot.checkpoint,
    native_records_hash: proof.native_records_hash, application_records_hash: proof.application_records_hash,
    auxiliary_records_hash: proof.auxiliary_records_hash });
  if (hash !== proof.baseline_hash) invalid();
  verifyTransitionTemplateAssociation(parsed);
  return bundle;
}

function verifyNativeJoin(evidence: MemoryTransitionNativeEvidence, bundle: HindsightApplicationBundle): void {
  const native = new Map(evidence.nativePages.flatMap((page) => page.records).map((row) => [key(row.object_kind, row.object_id), row]));
  const heads = bundle.pages.flatMap((page) => page.records).filter((row) => row.kind === "native").map((row) => row.head);
  if (native.size !== evidence.status.proof?.native_snapshot.manifest.total_records) invalid();
  const live = heads.filter((head) => head.version !== null);
  if (native.size !== live.length) invalid();
  for (const head of live) {
    const row = native.get(key(head.object_kind, head.object_id));
    const body = head.body_ref && bundle.bodies.get(head.body_ref.body_id)?.content;
    if (!row || !body || body.body_schema !== "application-native-record.v1"
      || row.object_revision !== head.version?.object_revision || !sameApplicationValue(row.payload, body.value.payload)) invalid();
  }
  const all = new Set(heads.map((head) => key(head.object_kind, head.object_id)));
  for (const row of native.values()) {
    if (row.object_kind !== "memory_unit") continue;
    if (row.payload.document_id !== null && !all.has(key("document", String(row.payload.document_id)))) invalid();
    const refs = row.payload.source_memory_ids;
    if (!Array.isArray(refs) || refs.some((id) => !all.has(key("memory_unit", String(id))))) invalid();
  }
  requireBodyClosure(bundle, heads);
}
function requireBodyClosure(bundle: HindsightApplicationBundle, heads: TakiApplicationNativeHead[]): void {
  const refs = new Set(heads.flatMap((head) => head.body_ref ? [head.body_ref.body_id] : []));
  for (const page of bundle.pages) for (const row of page.records) if (row.kind === "artifact") refs.add(row.artifact.body_ref.body_id);
  for (const body of bundle.bodies.values()) {
    if (body.content.body_schema === "application-native-record.v1" && body.content.value.source_evidence_ref) refs.add(body.content.value.source_evidence_ref.body_id);
    if (body.content.body_schema === "application-source-evidence.v1") refs.add(body.content.value.source_ref.body_id);
  }
  if (refs.size !== bundle.bodies.size || [...bundle.bodies.keys()].some((id) => !refs.has(id))) invalid();
}
function verifyMaintenance(evidence: MemoryTransitionNativeEvidence, proof: HindsightTransitionProof): void {
  const pages = evidence.maintenancePages; const manifest = proof.evidence;
  if (pages.length !== manifest.total_pages || manifest.page_hashes.length !== pages.length
    || pages.length !== Math.max(1, Math.ceil(manifest.total_records / 128))) invalid();
  for (const [i, page] of pages.entries()) {
    if (page.verification_id !== evidence.transitionId || page.bank_id !== proof.bank_id || page.certificate_hash !== proof.proof_hash
      || page.provider_lineage !== proof.provider_lineage || page.bank_generation !== proof.bank_generation
      || page.page_number !== i || page.total_pages !== pages.length || page.page_hash !== manifest.page_hashes[i]
      || page.page_hash !== hindsightTransitionHash({ page_number: i, records: page.records })
      || page.records.length !== Math.min(128, manifest.total_records - i * 128)) invalid();
  }
  const records = pages.flatMap((page) => page.records);
  const requirements = records.filter((row) => row.record_kind === "requirement").map((row) => row.requirement);
  // W2's opaque input commitment additionally covers its native candidate/policy. The complete stream is independently
  // checked here; no invented D78 certificate substitutes for the authenticated transition proof.
  verifyCurrentMaintenanceStream(records, { evidence: manifest, required_set_hash: currentRequiredSetHash(requirements),
    source_scope_count: requirements.filter((row) => row.kind === "source_scope").length,
    model_count: requirements.filter((row) => row.kind === "mental_model").length,
    snapshot: proof.native_snapshot, verification_id: evidence.transitionId,
    provider_lineage: proof.provider_lineage, bank_generation: proof.bank_generation });
  if (proof.maintenance_outcome_hash !== hindsightTransitionHash(records.filter((row) => ["outcome", "action", "model"].includes(row.record_kind)))) invalid();
}
function verifyAuxiliary(evidence: MemoryTransitionNativeEvidence, proof: HindsightTransitionProof): void {
  const pages = evidence.auxiliaryPages;
  if (pages.length !== proof.auxiliary_page_hashes.length || !pages.length) invalid();
  for (const [i, page] of pages.entries()) {
    if (page.transition_id !== evidence.transitionId || page.bank_id !== proof.bank_id || page.proof_hash !== proof.proof_hash
      || page.page_number !== i || page.total_pages !== pages.length || page.page_hash !== proof.auxiliary_page_hashes[i]
      || page.page_hash !== hindsightTransitionHash({ page_number: i, records: page.records })) invalid();
  }
  const records = pages.flatMap((page) => page.records);
  if (hindsightTransitionHash(records) !== proof.auxiliary_records_hash
    || new Set(records.map((row) => key(row.table, row.row_json))).size !== records.length) invalid();
  const chunks = new Map<string, Record<string, unknown>>();
  for (const record of records) {
    const row: unknown = JSON.parse(record.row_json);
    if (!row || typeof row !== "object" || Array.isArray(row)) invalid();
    const object = row as Record<string, unknown>;
    if (Object.hasOwn(object, "bank_id") && object.bank_id !== proof.bank_id) invalid();
    if (record.table === "chunks") chunks.set(String(object.chunk_id), object);
  }
  for (const row of evidence.nativePages.flatMap((page) => page.records)) {
    if (row.object_kind === "memory_unit" && row.payload.chunk_id !== null) {
      const chunk = chunks.get(String(row.payload.chunk_id));
      if (!chunk || chunk.document_id !== row.payload.document_id) invalid();
    }
  }
}
function key(kind: string, id: string): string { return JSON.stringify([kind, id]); }
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }

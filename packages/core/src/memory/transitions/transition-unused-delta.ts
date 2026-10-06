/**
 * INPUT:  genuine W2 unused-scope admission and authenticated complete native/application target inventory
 * OUTPUT: first delta for a previously absent Local scope while retaining actual template initialization objects
 * POS:    core/memory/transitions — W3 new-scope branch; never fabricates retired baseline or resets a Bank
 */
import { HindsightTransitionDeltaRequestSchema, type MemoryTransitionUnusedInventory, type HindsightTransitionStatus,
  type MemoryTransitionLocalCapture, type HindsightTransitionDeltaRequest } from "@taki/shared";
import { verifyHindsightApplicationBundle } from "../hindsight/hindsight-application-bundle.ts";
import { decodeHindsightApplicationBody, sameApplicationValue } from "../hindsight/hindsight-application-integrity.ts";
import { normalizeSnapshotMetadata, normalizeSnapshotPage } from "../hindsight/hindsight-snapshot-contracts.ts";
import { verifySnapshotContents } from "../hindsight/hindsight-snapshot-validator.ts";
import { hindsightTransitionHash, validateHindsightUnusedScope } from "../hindsight/hindsight-transition-proof.ts";
import { transitionLocalObjects, sourceWitness } from "./transition-delta-rows.ts";

export function compileTransitionUnusedDelta(input: { capture: MemoryTransitionLocalCapture; localBankId: string;
  localLineageId: string; target: HindsightTransitionStatus; inventory: MemoryTransitionUnusedInventory }) {
  verifyUnusedInventory(input.target, input.inventory);
  const { capture, localBankId } = input;
  const native: HindsightTransitionDeltaRequest["native"] = [];
  const application: HindsightTransitionDeltaRequest["application"] = [];
  const rows = HindsightTransitionDeltaRequestSchema.shape.rows.parse({ bank: null });
  const objects = transitionLocalObjects(capture.state, localBankId);
  const bank = objects.find((object) => object.kind === "bank"); if (!bank) invalid();
  for (const row of input.inventory.nativePages.flatMap((page) => page.records)) {
    const source = row.object_kind === "bank" ? sourceWitness(bank) : { source_kind: row.object_kind,
      source_id: row.object_id, source_revision: row.object_revision, source_payload_hash: hindsightTransitionHash(row.payload) };
    native.push({ source, target: { object_kind: row.object_kind, object_id: row.object_id,
      object_revision: row.object_revision, payload_hash: hindsightTransitionHash(row.payload) }, disposition: "reuse", body_hash: null, retirement: null });
  }
  const fields = HindsightTransitionDeltaRequestSchema.shape.rows.shape;
  for (const object of objects) {
    if (object.kind === "bank") continue;
    if (native.some((row) => row.source.source_kind === object.kind && row.source.source_id === object.id)) invalid();
    const body = { source: sourceWitness(object), ...object.native };
    native.push({ source: body.source, target: null, disposition: "upsert", body_hash: hindsightTransitionHash(body), retirement: null });
    if (object.kind === "document") rows.documents.push(fields.documents.unwrap().element.parse(body));
    else if (object.kind === "memory_unit") rows.memory_units.push(fields.memory_units.unwrap().element.parse(body));
    else if (object.kind === "mental_model") rows.mental_models.push(fields.mental_models.unwrap().element.parse(body));
    else rows.directives.push(fields.directives.unwrap().element.parse(body));
  }
  const localBank = capture.state.banks.find((entry) => entry.bankId === localBankId); if (!localBank) invalid();
  application.push(app({ artifact_kind: "bank", artifact_id: localBankId }, localBankId, { value: localBank,
    body: { artifact_kind: "bank", body: { scope: localBank.scope, original_bank: localBank,
      original_authority_epoch_id: capture.epochId, original_provider_lineage: input.localLineageId } } }));
  for (const source of capture.state.sources.filter((entry) => entry.bankId === localBankId)) {
    application.push(app({ artifact_kind: "source", artifact_id: source.documentId }, source.documentId, { value: source,
      body: { artifact_kind: "source", body: { original_source: source, encoded_metadata: source.metadata, original_witness: null, operation_id: null } } }));
  }
  for (const record of capture.state.records.filter((entry) => entry.unit.bankId === localBankId)) {
    application.push(app({ artifact_kind: "memory", artifact_id: record.unit.memoryId }, record.unit.memoryId, { value: record,
      body: { artifact_kind: "memory", body: { policy_basis: "curated", policy: record.policy, provenance: record.provenance,
        original_record: record, encoded_metadata: record.unit.metadata,
        source_artifacts: unusedSourceArtifacts(input, record.unit.memoryId, application) } } }));
  }
  for (const block of capture.state.blocks.filter((entry) => sameApplicationValue(entry.scope, localBank.scope))) {
    application.push(app({ artifact_kind: "block", artifact_id: block.block_id }, null, { value: block, body: { artifact_kind: "block", body: block } }));
  }
  return { native, application, rows, chunks: [] };
}
function unusedSourceArtifacts(input: Parameters<typeof compileTransitionUnusedDelta>[0], memoryId: string,
  application: HindsightTransitionDeltaRequest["application"]) {
  const set = input.capture.state.sourceSets.find((row) => row.bankId === input.localBankId && row.memoryId === memoryId);
  if (!set) invalid();
  // A newly created native namespace has no historical Source versions. Preserve the complete Local
  // copy/reinforcement evidence list, resolving every occurrence to its actual Source output in this delta.
  return set.references.map((ref) => {
    const source = application.find((row) => row.key.artifact_kind === "source" && row.key.artifact_id === ref.documentId);
    if (ref.intent !== "local" || ref.artifact !== null || source?.disposition !== "upsert"
      || source.native_source_id !== ref.documentId || source.body?.artifact_kind !== "source"
      || ref.source.authorityEpochId !== input.capture.epochId || ref.source.bankId !== input.localBankId
      || !sameApplicationValue(source.body.body.original_source, ref.source)) invalid();
    return source.key;
  });
}
function verifyUnusedInventory(target: HindsightTransitionStatus, inventory: MemoryTransitionUnusedInventory): void {
  const unused = target.request.unused_scope; if (!unused) invalid(); validateHindsightUnusedScope(unused, target.bank_id);
  const snapshot = inventory.nativeSnapshot; const manifest = snapshot.manifest; const app = inventory.applicationManifest;
  if (manifest.bank_id !== target.bank_id || manifest.provider_lineage !== target.request.provider_lineage
    || manifest.bank_generation !== target.request.bank_generation || manifest.end_cursor !== unused.native_cursor
    || app.kind !== "snapshot" || app.checkpoint.native_cursor !== manifest.end_cursor) invalid();
  verifySnapshotContents(normalizeSnapshotMetadata(snapshot), inventory.nativePages.map(normalizeSnapshotPage));
  const scope = { bankId: target.bank_id, namespace: app.namespace };
  if (scope.namespace.provider_lineage !== manifest.provider_lineage || scope.namespace.bank_generation !== manifest.bank_generation) invalid();
  const bodies = new Map(inventory.bodies.map(({ ref, base64 }) => [ref.body_id,
    decodeHindsightApplicationBody({ ...scope, ref, bytes: Buffer.from(base64, "base64") })]));
  verifyHindsightApplicationBundle({ manifest: app, pages: inventory.applicationPages, bodies }, scope);
  const descriptors = inventory.applicationPages.flatMap((page) => page.records);
  if (descriptors.some((row) => row.kind !== "native" || row.head.binding_state === "tombstoned")
    || inventory.nativePages.flatMap((page) => page.records).some((row) => row.object_kind === "document" || row.object_kind === "memory_unit")) invalid();
  const records = inventory.nativePages.flatMap((page) => page.records);
  if (descriptors.length !== records.length) invalid();
  for (const row of descriptors) {
    if (row.kind !== "native" || !row.head.body_ref) invalid();
    const native = bodies.get(row.head.body_ref.body_id)?.content;
    const record = records.find((entry) => entry.object_kind === row.head.object_kind && entry.object_id === row.head.object_id);
    if (!record || native?.body_schema !== "application-native-record.v1" || !sameApplicationValue(native.value.payload, record.payload)) invalid();
  }
}
function app(key: HindsightTransitionDeltaRequest["application"][number]["key"], nativeSourceId: string | null,
  input: { value: unknown; body: HindsightTransitionDeltaRequest["application"][number]["body"] }): HindsightTransitionDeltaRequest["application"][number] {
  return { key, expected_artifact: null, expected_body_hash: null, source_record_hash: hindsightTransitionHash(input.value),
    disposition: "upsert", native_source_id: nativeSourceId, body: input.body, retirement: null };
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }

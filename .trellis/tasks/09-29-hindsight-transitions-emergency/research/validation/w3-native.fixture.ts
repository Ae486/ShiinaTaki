/** Owned W3 consumer over real HTTP/PG; native test code owns fixture acquisition and maintenance. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHindsightClient } from "../../../../../packages/core/src/memory/hindsight/hindsight-client.ts";
import { requireHindsightTransitionClient } from "../../../../../packages/core/src/memory/hindsight/hindsight-transition-capability.ts";
import { requireHindsightApplicationClient } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-capability.ts";
import { loadTransitionNativeEvidence } from "../../../../../packages/core/src/memory/transitions/transition-native-loader.ts";
import { projectTransitionLocalBank } from "../../../../../packages/core/src/memory/transitions/transition-local-projection.ts";
import { compileTransitionNativeDelta } from "../../../../../packages/core/src/memory/transitions/transition-delta-rows.ts";
import { compileTransitionApplicationDelta } from "../../../../../packages/core/src/memory/transitions/transition-delta-application.ts";
import { signHindsightTransitionDelta, hindsightTransitionHash } from "../../../../../packages/core/src/memory/hindsight/hindsight-transition-proof.ts";
import { HindsightTransitionDeltaRequestSchema } from "../../../../../packages/shared/src/index.ts";
import { prepareHindsightApplicationBody, uploadHindsightApplicationBody } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-body-transfer.ts";
import { hindsightApplicationHash } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-integrity.ts";
import { transitionLocalHash } from "../../../../../packages/core/src/memory/transitions/transition-local-encoding.ts";

assert.equal(process.env.TAKI_TRANSITION_HTTP_FIXTURE, "1");
const [endpoint, bankId, baselineId, transitionId, mode, oracleJson] = process.argv.slice(2);
assert(endpoint && bankId && baselineId && transitionId);
assert.equal(new URL(endpoint).hostname, "127.0.0.1");
const client = requireHindsightTransitionClient(requireHindsightApplicationClient(createHindsightClient({ endpoint,
  resolveApiKey: () => "native-results-offline-test" })));
assert(client.currentSnapshotPage);
const context = { timeoutMs: 120_000 };
const status = await client.transitionStatus({ bankId, transitionId: baselineId, context });
const evidence = await loadTransitionNativeEvidence({ status, client: { ...client, currentSnapshotPage: client.currentSnapshotPage }, request: () => context });
const scope = { scope: { kind: "global" as const, characterId: null }, localBankId: "old-bank", nativeBankId: bankId,
  nativeGeneration: status.request.bank_generation, evidenceId: evidence.evidenceId, origin: "original" as const, originEpochId: "old-authority" };
const projected = projectTransitionLocalBank({ evidence, scope, epochId: randomUUID(), createdAt: new Date().toISOString() });
assert(projected.sources.length > 0 && projected.records.length > 0);
const target = await client.transitionStatus({ bankId, transitionId, context });
const baseline = { state: { banks: [projected.bank], sources: projected.sources, records: projected.records, derived: projected.derived,
  blocks: [], history: [], historicalReferences: projected.historicalReferences,
  sourceAliases: projected.sourceAliases, sourceSets: projected.sourceSets }, mappings: projected.mappings };
const current = structuredClone(baseline.state);
const historical = mode === "historical";
const aliasMode = mode === "alias";
assert.equal(projected.historicalReferences.length > 0, historical);
const record = current.records.find((row) => row.unit.memoryId === (historical ? projected.historicalReferences[0]?.memoryId : "old-unit")); assert(record);
record.policy.importance = record.policy.importance === 8 ? 7 : 8;
record.policy.policyVersion++; record.policy.updatedAt = new Date().toISOString();
record.unit.revision++; record.unit.updatedAt = record.policy.updatedAt;
record.unit.editedAt = record.policy.updatedAt;
if (historical) record.unit.text = "Edited by actual Core with retained historical supporting fact";
const capture = { epochId: projected.bank.authorityEpochId, state: current };
const uploads = [];
if (aliasMode) {
  const alias = current.sourceAliases[0]; assert(alias);
  const source = current.sources.find((row) => row.documentId === alias.documentId); assert(source);
  source.retainedText = "Current Local edited fragment only"; source.revision++;
  source.metadata = JSON.parse('{"\\u0000local": ["\\ud800", null, false, {"__proto__":42}]}');
  const namespace = status.proof!.application_snapshot.namespace;
  const body = prepareHindsightApplicationBody({ bankId, namespace, schema: "application-source.v1",
    value: { original_source: source, encoded_metadata: null, original_witness: null, operation_id: null } });
  assert(client.uploadTransitionSourceBody && client.putTransitionSourcePart && client.sealTransitionSourceBody);
  await uploadHindsightApplicationBody({ bankId, namespace, body, context, client: {
    uploadApplicationBody: (input) => client.uploadTransitionSourceBody!({ ...input, request: { ...input.request, executor: target.executor } }),
    putApplicationBodyPart: (input) => client.putTransitionSourcePart!({ ...input, request: { ...input.request, executor: target.executor } }),
    sealApplicationBody: (input) => client.sealTransitionSourceBody!({ ...input, request: { ...input.request, executor: target.executor } }),
  } });
  uploads.push({ localBankId: scope.localBankId, documentId: source.documentId, ref: body.ref,
    sourceHash: hindsightApplicationHash({ bankId, namespace, domain: "transition-source-evidence", value: source }) });
  for (const set of current.sourceSets) {
    const ref = set.references.find((ref) => ref.documentId === source.documentId);
    if (ref) { ref.intent = "local"; ref.source = source; }
  }
}
const native = compileTransitionNativeDelta({ capture: capture as never, baseline: baseline as never,
  localBankId: scope.localBankId, nativeBankId: bankId, mappings: projected.mappings });
assert.equal(native.native.filter((row) => row.disposition === "upsert").length, historical ? 1 : 0);
if (historical) {
  assert.equal(native.rows.memory_units[0]?.source_memory_ids[0], projected.historicalReferences[0]?.previous.object_id);
  assert(!native.native.some((row) => row.source.source_id === projected.historicalReferences[0]?.sourceMemoryId));
}
// Retain the actual current Block from the full application evidence as part of the Local state.
for (const body of evidence.bodies) {
  const value = JSON.parse(Buffer.from(body.base64, "base64").toString());
  if (body.ref.body_schema === "application-block.v1") current.blocks.push(value);
}
baseline.state.blocks = current.blocks;
const application = compileTransitionApplicationDelta({ capture: capture as never, baseline: baseline as never,
  evidence, localBankId: scope.localBankId, localLineageId: randomUUID(), native: native.native, uploads: uploads as never });
const chunks = evidence.auxiliaryPages.flatMap((page) => page.records).filter((row) => row.table === "chunks").map((entry) => {
  const row = JSON.parse(entry.row_json);
  const document = projected.mappings.find((mapping) => mapping.kind === "document" && mapping.native.object_id === row.document_id); assert(document);
  return { source_chunk_id: row.chunk_id, source_document_id: document.localId, target_chunk_id: row.chunk_id,
    chunk_index: row.chunk_index, content_hash: row.content_hash, disposition: "reuse" };
});
const request = signHindsightTransitionDelta(bankId, HindsightTransitionDeltaRequestSchema.parse({ ...native, application, chunks,
  executor: target.executor, operation_id: randomUUID(), request_hash: "0".repeat(64), baseline_transition_id: baselineId,
  baseline_proof_hash: status.proof!.proof_hash, unused_scope: null, local_manifest_hash: transitionLocalHash(current) }));
const result = await client.applyTransitionDelta({ bankId, request, context });
assert.equal(result.mappings.length, request.native.length);
assert.equal(result.mappings.filter((row) => row.disposition === "upserted").length, historical ? 1 : 0);
assert(result.artifacts.some((row) => row.disposition === "upserted"));
const finalStatus = await client.verifyTransition({ bankId, request: target.executor, context });
const final = await loadTransitionNativeEvidence({ status: finalStatus, client: { ...client, currentSnapshotPage: client.currentSnapshotPage }, request: () => context });
assert.equal(final.status.proof!.delta_result_hash, result.result_hash);
const restored = projectTransitionLocalBank({ evidence: final, scope: { ...scope, evidenceId: final.evidenceId },
  epochId: randomUUID(), createdAt: new Date().toISOString(), previous: projected.mappings,
  localEpochIds: [capture.epochId],
  nativeBaseline: { evidence, reusedMemoryIds: native.native.flatMap((row) => row.source.source_kind === "memory_unit"
    && row.disposition === "reuse" && row.target ? [row.target.object_id] : []) } });
const restoredRecord = restored.records.find((row) => row.unit.memoryId === record.unit.memoryId); assert(restoredRecord);
assert.equal(restoredRecord.policy.policyVersion, record.policy.policyVersion);
const finalNative = final.nativePages.flatMap((page) => page.records).find((row) => row.object_kind === "memory_unit"
  && row.object_id === projected.mappings.find((mapping) => mapping.localId === record.unit.memoryId)?.native.object_id)!;
assert.equal(restoredRecord.unit.updatedAt, historical ? finalNative.payload.updated_at : record.unit.updatedAt);
assert.equal(restoredRecord.unit.editedAt, historical ? finalNative.payload.edited_at : record.unit.editedAt);
if (historical) {
  assert.equal(restored.historicalReferences[0]?.sourceMemoryId, projected.historicalReferences[0]?.sourceMemoryId);
  assert.deepEqual(restoredRecord.unit.sourceMemoryIds, record.unit.sourceMemoryIds);
}
if (aliasMode) {
  const alias = restored.sourceAliases.find((row) => row.documentId === current.sourceAliases[0]?.documentId);
  assert(alias, JSON.stringify({ expected: current.sourceAliases.map((row) => [row.documentId, row.physicalDocumentId, row.artifact.key]),
    actual: restored.sourceAliases.map((row) => [row.documentId, row.physicalDocumentId, row.artifact.key]) }));
  const source = restored.sources.find((row) => row.documentId === alias.documentId); assert(source);
  assert.equal(source.retainedText, "Current Local edited fragment only");
  assert.deepEqual(source.metadata, current.sources.find((row) => row.documentId === alias.documentId)!.metadata);
  for (const expected of current.sourceSets.filter((set) => set.references.some((ref) => ref.documentId === alias.documentId))) {
    const refs = restored.sourceSets.find((set) => set.memoryId === expected.memoryId)!.references;
    assert.deepEqual(refs.map((ref) => [ref.documentId, ref.source.retainedText]),
      expected.references.map((ref) => [ref.documentId, ref.source.retainedText]), JSON.stringify({ memoryId: expected.memoryId,
        expected: expected.references.map((ref) => [ref.intent, ref.artifact]), actual: refs.map((ref) => ref.artifact) }));
  }
  const oracle = JSON.parse(oracleJson ?? "[]") as { nativeMemoryId: string; references: typeof alias.artifact[] }[];
  assert(oracle.length > 0);
  const output = result.artifacts.find((row) => row.key.artifact_id === alias.artifact.key.artifact_id); assert(output);
  for (const original of oracle) {
    const mapping = projected.mappings.find((row) => row.kind === "memory_unit" && row.native.object_id === original.nativeMemoryId); assert(mapping);
    const actual = restored.sourceSets.find((row) => row.memoryId === mapping.localId); assert(actual);
    let changed = false;
    const expected = original.references.map((ref) => {
      if (!changed && ref.key.artifact_id === alias.artifact.key.artifact_id) { changed = true; return output.current; } return ref;
    });
    assert(changed); assert.deepEqual(actual.references.map((ref) => ref.artifact), expected);
  }
  assert.equal(result.native_before_cursor, result.native_through_cursor);
}
console.log(JSON.stringify({ completeNativeClosure: true, preservedOriginalIds: true, expectedNativeDispositions: true,
  actualDeltaAccepted: true, finalMaintenanceClosure: true, policyVersionPreserved: true, expectedHistoricalClosure: true }));

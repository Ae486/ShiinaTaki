/**
 * INPUT:  owned SQLite databases and deterministic canonical/D77 test data
 * OUTPUT: full hash-consistent W3 storage fixtures with independent Local/native IDs
 * POS:    core/testing — synthetic proof mechanics only; never certifies a native maintenance execution
 */
import { randomUUID } from "node:crypto";
import { HindsightTransitionAcquireSchema, HindsightTransitionStatusSchema, HindsightTransitionProofSchema,
  type MemoryTransitionIntent, type HindsightSnapshotMetadataWire, type HindsightSnapshotRecordWire,
  type MemoryTransitionNativeEvidence, type MemoryBankScope } from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import { createCanonicalMaintenanceFixture } from "../db/canonical-memory-maintenance-fixtures.ts";
import { createMemoryOperationRepo } from "../db/memory-operation-repo.ts";
import { admitTransition, claimTransition, changeTransitionAdmission, updateTransitionAttempt, DEFAULT_TRANSITION_QUEUE_POLICY,
  type TransitionLease } from "../db/memory-transition-repo.ts";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { signHindsightTransitionAcquire, hindsightTransitionHash } from "../memory/hindsight/hindsight-transition-proof.ts";
import { normalizeSnapshotMetadata } from "../memory/hindsight/hindsight-snapshot-contracts.ts";
import { snapshotManifestHash } from "../memory/hindsight/hindsight-snapshot-validator.ts";
import { applicationTestArtifact, applicationTestBody, applicationTestNative, applicationTestSnapshot,
  applicationTestMemoryBody, applicationTestMemoryPayload, type ApplicationNativeFixture, type ApplicationArtifactFixture } from "./hindsight-application-fixtures.ts";
import { applicationTestBind } from "./hindsight-application-runtime-fixtures.ts";
import { sealTransitionNativeEvidence } from "../memory/transitions/transition-native-evidence.ts";
import { addTransitionSourceAliases, addTransitionAwaitingSource, type TransitionSourceFixtureOptions } from "./memory-transition-source-fixtures.ts";

export const W3_AT = "2026-10-01T00:00:00.000Z";
export function createTransitionCandidateFixture(db: Database, options: { historical?: boolean; aliases?: boolean; aliasEvidence?: boolean; retiredAlias?: boolean; awaitingSource?: boolean;
  sourceOptions?: TransitionSourceFixtureOptions } = {}) {
  const local = createCanonicalMaintenanceFixture(db);
  const json = JSON.parse('{"number":1,"string":"1","null":null,"empty":"","__proto__":{"literal":true},"nested":[false,1,"1"]}');
  const seed = local.seed({ memoryId: "logical-unit", source: { metadata: json, retainedText: "", context: null,
    contentHash: "original-declared-hash" }, unit: { metadata: json }, policy: { visibility: "hidden", policyVersion: 7 } });
  const invalidated = local.seed({ bankId: "a-bank", memoryId: "logical-invalidated", layerId: "episodes", unit: { state: "invalidated",
    invalidationReason: "operator invalidated", invalidatedAt: W3_AT }, policy: { visibility: "mood-gated", disclosure: "cafe" } });
  const nativeLineage = randomUUID(); const transitionId = randomUUID();
  const proofs = local.authority.listBanks(local.epochId).map((bank) => {
    const scope = { bankId: `native-${bank.bankId}`, namespace: { application_id: "taki" as const,
      provider_lineage: nativeLineage, bank_generation: randomUUID() } };
    const bankPayload = { bank_id: scope.bankId, name: bank.name, mission: bank.mission, disposition: bank.disposition,
      config: bank.config, created_at: bank.createdAt, updated_at: bank.updatedAt };
    const nativeBank = applicationTestNative({ scope, kind: "bank", payload: bankPayload, cursor: 1 });
    const bankArtifact = applicationTestArtifact({ scope, key: { artifact_kind: "bank", artifact_id: bank.bankId },
      binding: { kind: "exact_native", native: nativeBank.head.version! }, body: applicationTestBody("application-bank.v1",
        { scope: bank.scope, original_bank: bank, original_provider_lineage: local.authority.activeEpoch().providerLineageId,
          original_authority_epoch_id: local.epochId }, scope) });
    applicationTestBind(nativeBank, bankArtifact.artifact);
    const native = [nativeBank]; const artifacts = [bankArtifact];
    const record = bank.bankId === "global" ? seed : bank.bankId === "a-bank" ? invalidated : undefined;
    if (record) addOriginal(scope, record, { native, artifacts });
    if (bank.bankId === "global") {
      addFixtureSources(options, { native, artifacts });
      native.push(derivedFixture(scope));
      if (options.historical) tombstoneFixture(native);
    }
    return evidenceFromBundle({ transitionId, scope, native, artifacts });
  });
  const epochId = randomUUID(); const targetLineage = local.authority.activeEpoch().providerLineageId;
  db.prepare("UPDATE canonical_memory_authority_epochs SET status='closed',ended_at=:at WHERE epoch_id=:epoch")
    .run({ at: W3_AT, epoch: local.epochId });
  db.prepare("INSERT INTO canonical_memory_authority_epochs VALUES(:epoch,'hindsight',:lineage,'active',:prior,:at,NULL,'planned-switch')")
    .run({ epoch: epochId, lineage: nativeLineage, prior: local.epochId, at: W3_AT });
  db.prepare("UPDATE canonical_memory_authority_state SET active_epoch_id=:epoch WHERE singleton=1").run({ epoch: epochId });
  const expected = { predecessorEpochId: epochId, sourceProvider: "hindsight" as const, sourceLineageId: nativeLineage,
    targetProvider: "local" as const, targetLineageId: targetLineage, configRevision: 0, configFingerprint: "a".repeat(64), inventoryRevision: 0,
    inventoryHash: "a".repeat(64), banks: proofs.map((evidence, index) => ({ scope: local.authority.listBanks(local.epochId)[index]!.scope,
      sourceBankId: evidence.status.bank_id, targetBankId: null, sourceRevision: 1, nativeBankId: evidence.status.bank_id,
      nativeGeneration: evidence.status.request.bank_generation, manifestHash: "a".repeat(64), mappingHash: "a".repeat(64), policyRevision: 0, blockRevision: 0 })),
    baselineReceiptId: null, baselineHash: null, custodyBoundaryHash: "a".repeat(64) };
  const intent: MemoryTransitionIntent = { version: 1, transitionId, operationId: randomUUID(), actorId: "owned-test",
    admittedAt: W3_AT, queuePolicy: { ...DEFAULT_TRANSITION_QUEUE_POLICY }, incidentId: null,
    request: { kind: "transition.return-local", requestId: randomUUID(), previewId: randomUUID(), expected,
      previewHash: canonicalPayloadHash(["taki-transition-preview.v1", "transition.return-local", expected]), confirmation: "healthy-switch" } };
  const lease = admitFixtureTransition(db, intent);
  return { local, seed, invalidated, proofs, intent, lease, input: { lease, now: W3_AT, assertConfiguration: () => undefined } };
}
function derivedFixture(scope: Parameters<typeof evidenceFromBundle>[0]["scope"]) {
  return applicationTestNative({ scope, kind: "memory_unit", cursor: 3,
    payload: applicationTestMemoryPayload({ bank_id: scope.bankId, memory_id: "native-derived", document_id: null,
      state: "invalidated", invalidated_at: W3_AT, invalidation_reason: "native archive",
      source_memory_ids: ["native-logical-unit"], fact_type: "observation" }) });
}
function addFixtureSources(options: Parameters<typeof createTransitionCandidateFixture>[1], output: {
  native: ApplicationNativeFixture[]; artifacts: ApplicationArtifactFixture[];
}) {
  if (options?.aliases) addTransitionSourceAliases(output, { retired: options.retiredAlias, evidenceOnly: options.aliasEvidence, ...options.sourceOptions });
  if (options?.awaitingSource) addTransitionAwaitingSource(output);
}
function tombstoneFixture(native: ApplicationNativeFixture[]): void {
  const original = native.find((row) => row.head.object_id === "native-logical-unit")!;
  const previous = original.head.version!;
  original.head = { ...original.head, version: null, body_ref: null, binding_state: "tombstoned", cause: "native_delete",
    previous_version: previous, tombstone: { object_kind: "memory_unit", object_id: previous.object_id,
      object_revision: previous.object_revision, native_cursor: 4, last_payload_hash: previous.payload_hash } };
  original.bodies = [];
}
function addOriginal(scope: NonNullable<Parameters<typeof applicationTestSnapshot>[0]>["scope"], record: ReturnType<ReturnType<typeof createCanonicalMaintenanceFixture>["seed"]>,
  output: { native: ApplicationNativeFixture[]; artifacts: ApplicationArtifactFixture[] }): void {
  if (!scope) throw new Error("fixture scope");
  const source = record.source;
  const document = applicationTestNative({ scope, kind: "document", cursor: 2, source: { text: source.retainedText, context: source.context, metadata: source.metadata },
    payload: { bank_id: scope.bankId, document_id: `native-${source.documentId}`, content_hash: "native-actual-hash",
      tags: source.tags, metadata: source.metadata, observation_scopes: source.observationScopes, created_at: source.createdAt, updated_at: source.updatedAt } });
  const version = document.head.version!;
  const artifact = applicationTestArtifact({ scope, key: { artifact_kind: "source", artifact_id: source.documentId }, binding: { kind: "exact_native", native: version },
    body: applicationTestBody("application-source.v1", { original_source: source, encoded_metadata: source.metadata, operation_id: null,
      original_witness: { source_kind: "document", source_id: version.object_id, source_revision: version.object_revision, source_payload_hash: version.payload_hash } }, scope) });
  applicationTestBind(document, artifact.artifact);
  const payload = Object.fromEntries(Object.entries(record.unit).filter(([key]) => !["authorityEpochId", "bankId", "memoryId", "documentId"].includes(key))
    .map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value]));
  const memory = applicationTestNative({ scope, kind: "memory_unit", cursor: 3,
    payload: applicationTestMemoryPayload({ ...payload, bank_id: scope.bankId, memory_id: `native-${record.unit.memoryId}`, document_id: version.object_id }) });
  const policy = applicationTestArtifact({ scope, key: { artifact_kind: "memory", artifact_id: record.unit.memoryId },
    binding: { kind: "exact_native", native: memory.head.version! }, body: applicationTestBody("application-memory.v1",
      applicationTestMemoryBody(memory.head.version!, { policy_basis: "curated", policy: record.policy,
        provenance: record.record.provenance, original_record: record.record, encoded_metadata: record.unit.metadata,
        source_artifacts: [{ key: artifact.artifact.key, revision: artifact.artifact.revision, record_hash: artifact.artifact.record_hash }] }), scope) });
  applicationTestBind(memory, policy.artifact); output.native.push(document, memory); output.artifacts.push(artifact, policy);
}
export function admitFixtureTransition(db: Database, intent: MemoryTransitionIntent, keepOpen = false): TransitionLease {
  const repo = createMemoryOperationRepo(db, () => W3_AT);
  db.transaction(() => {
    repo.insertAdmitted({ operationId: intent.operationId, kind: intent.request.kind, family: "memory-transition", request: intent.request,
      authorityEpochId: intent.request.expected.predecessorEpochId, producer: { kind: "transition", transitionId: intent.transitionId,
        requestId: intent.request.requestId }, bootId: "w3-fixture" });
    admitTransition(db, { intent, current: intent.request.expected });
  });
  repo.transition({ operationId: intent.operationId, expectedState: "admitted", patch: { state: "running" } });
  let lease = claimTransition(db, { transitionId: intent.transitionId, ownerId: "w3-fixture", now: W3_AT, leaseMs: 300_000 });
  lease = updateTransitionAttempt(db, { lease, now: W3_AT, patch: { phase: "draining" } });
  if (keepOpen) return changeTransitionAdmission(db, { lease, now: W3_AT, action: "open" });
  lease = changeTransitionAdmission(db, { lease, now: W3_AT, action: "close" });
  return updateTransitionAttempt(db, { lease, now: W3_AT, patch: { phase: "fenced" } });
}
export function evidenceFromBundle(input: { transitionId: string; scope: NonNullable<NonNullable<Parameters<typeof applicationTestSnapshot>[0]>["scope"]>;
  native: ApplicationNativeFixture[]; artifacts: ApplicationArtifactFixture[];
  extraBodies?: NonNullable<Parameters<typeof applicationTestSnapshot>[0]>["extraBodies"] }): MemoryTransitionNativeEvidence {
  const bundle = applicationTestSnapshot({ ...input, pageSize: 2 }); const scope = input.scope;
  const native = input.native.filter((row) => row.head.version).map((row) => ({ object_kind: row.head.object_kind,
    object_id: row.head.object_id, object_revision: row.head.version!.object_revision,
    payload: row.body.content.body_schema === "application-native-record.v1" ? row.body.content.value.payload : {} })) as HindsightSnapshotRecordWire[];
  const metadata = snapshotMetadata(native, scope, bundle.manifest.checkpoint.native_cursor);
  const nativePages = native.map((row, page_number) => ({ snapshot_id: metadata.snapshot_id, page_number, total_pages: native.length,
    record_count: 1, content_sha256: metadata.manifest.page_hashes[page_number]!, records: [row] }));
  const request = signHindsightTransitionAcquire(scope.bankId, HindsightTransitionAcquireSchema.parse({ transition_id: input.transitionId,
    attempt_id: randomUUID(), provider_lineage: scope.namespace.provider_lineage, bank_generation: scope.namespace.bank_generation,
    direction: "return-local", request_hash: "0".repeat(64) }));
  const executor = { transition_id: input.transitionId, attempt_id: request.attempt_id, generation: 1, fence_token: randomUUID() };
  const auxiliary = native.map((row) => ({ table: ({ bank: "banks", document: "documents", memory_unit: "memory_units", mental_model: "mental_models", directive: "directives" })[row.object_kind], row_json: JSON.stringify(row.payload) }));
  const proof = HindsightTransitionProofSchema.parse({ certificate_id: input.transitionId, bank_id: scope.bankId,
    provider_lineage: scope.namespace.provider_lineage, bank_generation: scope.namespace.bank_generation, executor,
    request_hash: request.request_hash, maintenance_input_hash: hindsightTransitionHash([]), maintenance_outcome_hash: hindsightTransitionHash([]),
    evidence: { page_size: 128, total_pages: 1, total_records: 0, counts: { requirements: 0, outcomes: 0, inputs: 0, actions: 0, models: 0 },
      records_hash: hindsightTransitionHash([]), page_hashes: [hindsightTransitionHash({ page_number: 0, records: [] })] }, not_required: [],
    native_snapshot: metadata, application_snapshot: bundle.manifest, native_records_hash: hindsightTransitionHash(native),
    application_records_hash: hindsightTransitionHash(bundle.pages.flatMap((page) => page.records)), auxiliary_records_hash: hindsightTransitionHash(auxiliary),
    auxiliary_page_hashes: [hindsightTransitionHash({ page_number: 0, records: auxiliary })], baseline_hash: "0".repeat(64), proof_hash: "0".repeat(64) });
  proof.baseline_hash = hindsightTransitionHash({ domain: "transition-baseline.v1", bank_id: scope.bankId, provider_lineage: proof.provider_lineage,
    bank_generation: proof.bank_generation, native_cursor: metadata.manifest.end_cursor, application_checkpoint: bundle.manifest.checkpoint,
    native_records_hash: proof.native_records_hash, application_records_hash: proof.application_records_hash, auxiliary_records_hash: proof.auxiliary_records_hash });
  const body = Object.fromEntries(Object.entries(proof).filter(([key]) => key !== "proof_hash"));
  proof.proof_hash = hindsightTransitionHash({ domain: "transition-proof.v1", proof: body });
  const status = HindsightTransitionStatusSchema.parse({ bank_id: scope.bankId, request, executor, revision: 3, phase: "proven",
    lease_expires_at: "2026-10-01T00:05:00.000Z", executor_live: true, active_writers: 0, accepted_operations: 0, proof, outcome: null });
  return sealTransitionNativeEvidence({ version: 1, transitionId: input.transitionId, status, nativePages, applicationPages: bundle.pages,
    bodies: [...bundle.bodies.values()].map(({ ref, bytes }) => ({ ref, base64: Buffer.from(bytes).toString("base64") })),
    maintenancePages: [{ verification_id: input.transitionId, bank_id: scope.bankId, provider_lineage: proof.provider_lineage,
      bank_generation: proof.bank_generation, certificate_hash: proof.proof_hash, page_number: 0, total_pages: 1, page_hash: proof.evidence.page_hashes[0]!, records: [] }],
    auxiliaryPages: [{ transition_id: input.transitionId, bank_id: scope.bankId, proof_hash: proof.proof_hash, page_number: 0,
      total_pages: 1, records: auxiliary, page_hash: proof.auxiliary_page_hashes[0]! }] });
}
function snapshotMetadata(records: HindsightSnapshotRecordWire[], scope: Parameters<typeof evidenceFromBundle>[0]["scope"], cursor: number): HindsightSnapshotMetadataWire {
  const count = (kind: string) => records.filter((row) => row.object_kind === kind).length;
  const units = records.filter((row) => row.object_kind === "memory_unit");
  const metadata: HindsightSnapshotMetadataWire = { snapshot_id: randomUUID(), created_at: W3_AT, expires_at: "2026-10-01T01:00:00.000Z", manifest: {
    schema_version: 1, bank_id: scope.bankId, provider_lineage: scope.namespace.provider_lineage, bank_generation: scope.namespace.bank_generation,
    end_cursor: cursor, page_size: 1, total_pages: records.length, total_records: records.length,
    counts: { bank: count("bank"), document: count("document"), memory_unit: { valid: units.filter((row) => row.payload.state === "valid").length,
      invalidated: units.filter((row) => row.payload.state === "invalidated").length }, mental_model: count("mental_model"), directive: count("directive"), total: records.length },
    page_hashes: records.map((row) => hindsightTransitionHash([row])), sha256: "0".repeat(64) } };
  metadata.manifest.sha256 = snapshotManifestHash(normalizeSnapshotMetadata(metadata)); return metadata;
}
export function fixtureScope(kind: "global" | "character", characterId: string | null): MemoryBankScope {
  return kind === "global" ? { kind, characterId: null } : { kind, characterId: characterId ?? "fixture" };
}

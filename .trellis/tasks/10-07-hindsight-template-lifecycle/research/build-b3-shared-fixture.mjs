/** Deterministic wire/hash vectors only; real producer/copy/restore acceptance is separate. */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import * as shared from "../../../../packages/shared/src/index.ts";
import { hindsightBankBindings } from "../../../../packages/core/src/memory/hindsight/hindsight-bank-identity.ts";

const sha = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const hash = (domain, value) => sha(shared.hindsightTemplateBackupHashJson(domain, value));
const lifecycle = (domain, value) => sha(shared.hindsightTemplateHashJson(domain, value));
const uuid = (digit) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const at = "2026-10-09T00:00:00.000Z";
const lineage = uuid("1");
const [globalBank, characterBank] = hindsightBankBindings("demo");
const target = { provider_lineage: lineage, bank_id: globalBank.externalBankId, bank_generation: uuid("2") };
const unselectedTarget = { provider_lineage: lineage, bank_id: characterBank.externalBankId, bank_generation: uuid("3") };
const keys = ["entity_labels", "observations_instructions", "reflect_mission", "retain_mission"];
const snapshotBody = {
  contract_version: "1.0.0", target, selectors: { config_keys: keys, model_ids: [], directives: [] },
  config: keys.map((key) => ({ key, stored: { kind: "absent" }, inherited: key === "entity_labels" ? [] : "" })),
  models: [], directives: [],
};
const before = { ...snapshotBody, snapshot_hash: lifecycle("snapshot", snapshotBody) };
const projection = { ...snapshotBody, config: snapshotBody.config.map((entry) => entry.key !== "retain_mission" ? entry
  : { ...entry, stored: { kind: "value", value: "Preserve my explicit guidance." } }) };
const after = { ...projection, snapshot_hash: lifecycle("snapshot", projection) };
const applyBody = { contract_version: "1.0.0", target, request_id: uuid("4"), expected_snapshot: before,
  changes: { config: [{ key: "retain_mission", stored: { kind: "value", value: "Preserve my explicit guidance." } }], models: [], directives: [] },
  refresh: [], initialization: null };
const apply = { ...applyBody, request_hash: lifecycle("request", applyBody) };
const receiptBody = { contract_version: "1.0.0", target, request_id: apply.request_id, request_hash: apply.request_hash,
  before_snapshot_hash: before.snapshot_hash, after_snapshot_hash: after.snapshot_hash, changes: apply.changes,
  children: [], journal_before: 10, journal_after: 11, initialization_proof_hash: null };
const receipt = { ...receiptBody, receipt_hash: lifecycle("receipt", receiptBody) };
const tuple = { request_id: receipt.request_id, request_hash: receipt.request_hash, receipt_hash: receipt.receipt_hash };
const inventoryValue = shared.hindsightTemplateBackupReceiptsValue(target, [tuple]);
const emptyInventoryValue = shared.hindsightTemplateBackupReceiptsValue(unselectedTarget, []);
const receiptInventory = { count: 1, digest: hash("receipts", inventoryValue) };
const emptyInventory = { count: 0, digest: hash("receipts", emptyInventoryValue) };
const rawRequest = { version: 2, backupId: uuid("5"), createdAt: at, providerLineageId: lineage,
  nativeBankIds: [target.bank_id, unselectedTarget.bank_id], operationIds: ["template-receipt:" + apply.request_id],
  requestHash: "0".repeat(64), templates: [{ target, selected: { request: apply, receiptHash: receipt.receipt_hash } },
    { target: unselectedTarget, selected: null }] };
const request = shared.normalizeHindsightBackupRequestV2(shared.HindsightBackupNativeRequestV2Schema.parse(rawRequest));
request.requestHash = hash("request", shared.hindsightTemplateBackupRequestValue(request));
const databaseValue = shared.hindsightTemplateBackupDatabaseValue(projection);
const inheritedValue = shared.hindsightTemplateBackupInheritedValue(projection);
const projectionHashes = { databaseDefinitionHash: hash("database", databaseValue), inheritedConfigHash: hash("inherited", inheritedValue),
  definitionProjectionHash: lifecycle("definition", projection) };
const context = { schema: "public", tenantId: null, apiKeyId: null, tenantExtension: "fixture.AuthoritativeTenant" };
const configuration = { version: 1, source: "authenticated-service", observationId: uuid("6"), observedAt: at,
  schema: "public", contextHash: hash("context", context), requestHash: request.requestHash,
  inheritedConfigHash: projectionHashes.inheritedConfigHash, observationHash: "0".repeat(64) };
configuration.observationHash = hash("observation", shared.hindsightTemplateBackupObservationValue(target, configuration));
const selectedBankProof = { target, receiptInventory, selected: { state: "selected", requestId: apply.request_id,
  requestHash: apply.request_hash, receiptHash: receipt.receipt_hash, ...projectionHashes, configurationObservation: configuration } };
const unselectedBankProof = { target: unselectedTarget, receiptInventory: emptyInventory, selected: { state: "unselected" } };
const nativeBase = { providerLineage: lineage, alembicRevision: "fixture-b3", upstreamCommit: "fixture-source",
  compatibilityBuild: shared.HINDSIGHT_TEMPLATE_BACKUP_BUILD,
  banks: [target, unselectedTarget].map((entry) => ({ bankId: entry.bank_id, bankGeneration: entry.bank_generation,
    currentCursor: 20, minimumAvailableCursor: 0, application: { nativeCursor: 20, stateCursor: 5 } })),
  receipts: { count: request.operationIds.length, digest: sha([...request.operationIds].sort().join("\n")), missingCount: 0, missingSample: [] } };
const proofBody = shared.HindsightBackupNativeProofBodyV2Schema.parse({ ...nativeBase, version: 2, requestHash: request.requestHash,
  templates: [selectedBankProof, unselectedBankProof] });
const proof = { ...proofBody, zipSha256: sha("fixture ZIP bytes"), zipBytes: 4096 };
const archiveProof = { version: 2, backupId: request.backupId, requestHash: request.requestHash, proof: proofBody,
  entries: [{ name: "memory_template_receipts.bin", bytes: 128, sha256: sha("fixture receipt COPY bytes") }] };
const observationRequest = { version: 2, nonce: uuid("7"), request };
const observationResponse = { version: 2, nonce: observationRequest.nonce, requestHash: request.requestHash, schema: "public", proof: proofBody };
const nativeResponse = { version: 2, backupId: request.backupId, requestHash: request.requestHash, schema: "public", proof: proofBody,
  artifact: { location: "native-host", fileName: "taki-backup-" + request.backupId + ".zip", sha256: proof.zipSha256, bytes: proof.zipBytes } };
const historyValue = { identity: { target, scope: "global", canonicalIdentity: "global" },
  enrollments: [], users: [], selections: [], currentSelectionRevision: 1 };
const defaultsValue = { providerLineage: lineage, currentRevision: 1, history: [], catalogs: [] };
const holdValue = { authorityEpochId: "fixture-epoch", plans: [], holds: [], dispatches: [], publications: [], quarantines: [] };
const selected = { selectionRevision: 1, selectionHash: sha("fixture selection document"), templateRevision: "none",
  enrollmentRevision: 1, userRevision: 1, requestId: apply.request_id, requestHash: apply.request_hash, receiptHash: receipt.receipt_hash,
  publication: { publicationId: uuid("8"), planId: uuid("9"), planHash: sha("fixture original plan"), operationId: uuid("a"), selectionIdentity: sha("fixture selection identity") },
  ...projectionHashes };
const attestationBody = { version: 1, authorityEpochId: "fixture-epoch", providerLineageId: lineage,
  defaultsHash: hash("defaults", defaultsValue), hold: { state: "clear", digest: hash("hold", holdValue) },
  banks: [{ target, canonicalIdentity: "global", scope: "global", characterId: null, historyHash: hash("history", historyValue), receiptInventory, selected },
    { target: unselectedTarget, canonicalIdentity: "character:demo", scope: "character", characterId: "demo",
      historyHash: hash("history", { ...historyValue, identity: { target: unselectedTarget, scope: "character", canonicalIdentity: "character:demo" }, currentSelectionRevision: 0 }),
      receiptInventory: emptyInventory, selected: null }] };
const attestation = { ...attestationBody, attestationHash: hash("attestation", attestationBody) };
const manifestBase = { backupId: request.backupId, createdAt: at, operationId: uuid("a"), route: "native-endpoint",
  core: { file: "core.sqlite", sha256: sha("fixture Core bytes"), bytes: 8192, pages: 2, migrationHead: 59 },
  native: { location: "native-host", file: nativeResponse.artifact.fileName, nativeManifestVersion: "2", schema: "public", proof },
  authority: { epochId: "fixture-epoch", activationTransactionId: "fixture-activation", providerLineageId: lineage,
    replicaCheckpointDigest: sha("fixture checkpoint"), configFingerprint: sha("fixture connection"), deploymentMode: "existing-instance" },
  banks: attestation.banks.map((bank) => ({ bankId: bank.canonicalIdentity, nativeBankId: bank.target.bank_id, scope: bank.scope,
    characterId: bank.characterId, bankGeneration: bank.target.bank_generation,
    core: { replicaCursor: 11, applicationNativeCursor: 11, applicationStateCursor: 4, checkpointHash: sha("fixture application checkpoint") } })),
  terminalOperations: { count: nativeBase.receipts.count, digest: nativeBase.receipts.digest },
  custody: { storeId: "fixture-custody", refs: [], connectionMarker: sha("fixture credential presence marker") }, sensitive: true, verifiedAt: at };
const manifest = shared.HindsightBackupManifestV2Schema.parse({ version: 2, ...manifestBase, requestHash: request.requestHash, templates: attestation });
const transitionValue = { attestationHash: attestation.attestationHash, banks: [] };
const values = [["request", shared.hindsightTemplateBackupRequestValue(request)], ["receipts", inventoryValue], ["receipts", emptyInventoryValue],
  ["database", databaseValue], ["inherited", inheritedValue], ["context", context],
  ["observation", shared.hindsightTemplateBackupObservationValue(target, configuration)], ["attestation", attestationBody],
  ["history", historyValue], ["defaults", defaultsValue], ["hold", holdValue], ["transition", transitionValue]];
const vectors = values.map(([domain, value]) => ({ domain, value, canonical: shared.hindsightTemplateBackupHashJson(domain, value), hash: hash(domain, value) }));
const without = (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
const invalidCases = [
  { name: "request-missing-version", component: "TakiBackupRequestV2", value: without(request, "version") },
  { name: "request-v1", component: "TakiBackupRequestV2", value: { ...request, version: 1 } },
  { name: "request-snake-alias", component: "TakiBackupRequestV2", value: { ...without(request, "backupId"), backup_id: request.backupId } },
  { name: "request-bank-omitted", component: "TakiBackupRequestV2", value: { ...request, templates: request.templates.slice(0, 1) } },
  { name: "request-duplicate-bank", component: "TakiBackupRequestV2", value: { ...request, templates: [request.templates[0], request.templates[0]] } },
  { name: "proof-missing-templates", component: "TakiBackupProofV2", value: without(proof, "templates") },
  { name: "proof-missing-zip-digest", component: "TakiBackupProofV2", value: without(proof, "zipSha256") },
  { name: "proof-body-cannot-be-endpoint", component: "TakiBackupProofV2", value: proofBody },
  { name: "observation-cannot-carry-zip", component: "TemplateBackupObservationResponse", value: { ...observationResponse, proof } },
  { name: "observation-wrong-schema", component: "TemplateBackupObservationResponse", value: { ...observationResponse, schema: "other" } },
  { name: "observation-missing-nonce", component: "TemplateBackupObservationResponse", value: without(observationResponse, "nonce") },
  { name: "unselected-cannot-assert-projection", component: "TemplateBackupBankProofV2", value: { ...unselectedBankProof, selected: { state: "unselected", definitionProjectionHash: projectionHashes.definitionProjectionHash } } },
  { name: "selected-needs-context", component: "TemplateBackupBankProofV2", value: { ...selectedBankProof, selected: { ...selectedBankProof.selected,
    configurationObservation: without(configuration, "contextHash") } } },
];
const v1Request = shared.HindsightBackupNativeRequestV1Schema.parse({ version: 1, backupId: request.backupId.toUpperCase(), createdAt: at,
  providerLineageId: lineage.toUpperCase(), nativeBankIds: request.nativeBankIds, operationIds: request.operationIds });
const v1Proof = shared.HindsightBackupNativeProofV1Schema.parse({ ...nativeBase, zipSha256: proof.zipSha256, zipBytes: proof.zipBytes });
const v1Archive = shared.HindsightBackupArchiveProofV1Schema.parse({ version: 1, backupId: request.backupId, proof: nativeBase, entries: archiveProof.entries });
const v1Manifest = shared.HindsightBackupManifestV1Schema.parse({ version: 1, ...manifestBase, native: { ...manifestBase.native, proof: v1Proof } });
const fixture = { wireOnly: true, request, original: { before, apply, receipt, after, projection }, selectedBankProof, unselectedBankProof,
  proofBody, proof, nativeResponse, archiveProof, observationRequest, observationResponse, attestation, manifest, vectors, invalidCases,
  legacy: { request: JSON.stringify(v1Request), proof: JSON.stringify(v1Proof), archive: JSON.stringify(v1Archive), manifest: JSON.stringify(v1Manifest) } };
const output = new URL("../../../../packages/shared/src/fixtures/hindsight-template-backup-v2.json", import.meta.url);
writeFileSync(output, JSON.stringify(fixture, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify({ fixture: output.pathname, bytes: Buffer.byteLength(JSON.stringify(fixture)), vectors: vectors.length,
  invalidCases: invalidCases.length }) + "\n");

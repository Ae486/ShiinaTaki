/** Validate existing real D78 capture/import/readiness on a new private SQLite copy; no native/model calls. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { createHindsightCutoverRunRepo } from "../../../../packages/core/src/db/hindsight-cutover-run-repo.ts";
import { createHindsightLocalCoverageRepo } from "../../../../packages/core/src/db/hindsight-local-coverage-repo.ts";
import { readHindsightCurrentCaptureByManifest } from "../../../../packages/core/src/db/hindsight-current-capture-repo.ts";
import { readHindsightCurrentPreparation } from "../../../../packages/core/src/db/hindsight-current-preparation-repo.ts";
import { readHindsightCurrentImport } from "../../../../packages/core/src/db/hindsight-current-import-repo.ts";
import { createHindsightReplicaRepo } from "../../../../packages/core/src/db/hindsight-replica-repo.ts";
import { hindsightCheckpointSetDigest, promoteHindsightAuthority } from "../../../../packages/core/src/db/hindsight-authority-repo.ts";
import { carryHindsightActivationCustody } from "../../../../packages/core/src/db/hindsight-activation-custody.ts";
import { readHindsightApplicationBootstrapEvidence } from "../../../../packages/core/src/db/hindsight-application-bootstrap-evidence.ts";
import { canonicalPayloadHash } from "../../../../packages/core/src/memory/legacy-migration/legacy-identities.ts";

const baseline = resolve("H:/TakiAgent/.trellis/.runtime/stage4-conversion-source");
const source = join(baseline, "preflight-3bc850be-7c99-4673-a92d-030ffda63cf6", "validation.sqlite");
assert(!existsSync(`${source}-wal`) || statSync(`${source}-wal`).size === 0, "closed baseline WAL required");
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const beforeHash = hash(source);
const root = join(baseline, `proof-${randomUUID()}`);
mkdirSync(root); // Inherits the private real-data baseline ACL.
const database = join(root, "validation.sqlite");
copyFileSync(source, database);
const db = openDatabase({ path: database, migrations: [] });
const result = { root, nativeCalls: 0, llmCalls: 0, conversionExecuted: false, activationExecuted: false };
const activateCopy = process.argv.includes("--activate-copy");
assert(process.argv.slice(2).every((arg) => arg === "--activate-copy"), "unsupported probe argument");
try {
  const runRows = db.prepare("SELECT run_id,expected_predecessor_epoch_id FROM hindsight_cutover_runs").all();
  assert.equal(runRows.length, 1);
  const run = runRows[0];
  const coverageRepo = createHindsightLocalCoverageRepo(db);
  const manifest = coverageRepo.selected(String(run.run_id));
  assert(manifest);
  coverageRepo.assertCurrent(manifest.manifestId);
  const capture = readHindsightCurrentCaptureByManifest(db, manifest.manifestId);
  assert(capture);
  assert.equal(capture.sources.length, 722);
  assert.equal(capture.records.length, 722);
  const preparedRows = db.prepare("SELECT preparation_id FROM hindsight_current_preparations ORDER BY preparation_id").all();
  assert.equal(preparedRows.length, 2);
  let checkedOriginalMappings = 0;
  let transferCount = 0;
  for (const row of preparedRows) {
    const prepared = readHindsightCurrentPreparation(db, String(row.preparation_id));
    assert.equal(prepared.captureId, capture.captureId);
    assert.equal(prepared.manifestId, manifest.manifestId);
    assert.equal(prepared.gaps.length, 0);
    const imported = readHindsightCurrentImport(db, prepared.preparationId);
    assert(imported);
    transferCount++;
    for (const mapping of imported.mappings) {
      const original = mapping.target_kind === "bank"
        ? capture.banks.find((value) => value.bankId === prepared.sourceBankId)
        : mapping.target_kind === "document"
          ? capture.sources.find((value) => value.bankId === prepared.sourceBankId && value.documentId === mapping.source.source_id)
          : mapping.target_kind === "memory_unit"
            ? capture.records.find((value) => value.unit.bankId === prepared.sourceBankId && value.unit.memoryId === mapping.source.source_id)
            : undefined;
      assert(original, "every original Bank/source/unit mapping must have its captured record");
      assert.equal(canonicalPayloadHash(original), mapping.source.source_payload_hash, "original payload hash mismatch");
      checkedOriginalMappings++;
    }
  }
  const revision = Number(db.prepare("SELECT revision FROM hindsight_connection_state WHERE singleton=1").get().revision);
  const verified = createHindsightCutoverRunRepo(db).verify({ runId: String(run.run_id), expectedRevision: revision,
    expectedEpochId: String(run.expected_predecessor_epoch_id) });
  Object.assign(result, { captureValid: true, currentCoverageMatches: true, sources: capture.sources.length,
    memories: capture.records.length, banks: capture.banks.length, transferCount, checkedOriginalMappings,
    invalidated: capture.records.filter((record) => record.unit.state === "invalidated").length,
    readiness: { eligible: verified.eligible, blockingCodes: verified.blockingCodes },
    currentAuthority: db.prepare("SELECT mode FROM memory_authority_selection WHERE singleton=1").get().mode,
    activationReceipts: Number(db.prepare("SELECT count(*) AS count FROM hindsight_authority_activation_receipts").get().count) });
  if (activateCopy) {
    assert(verified.eligible, "existing actual capture/import/readiness must pass before copied activation");
    const now = new Date().toISOString();
    const replica = createHindsightReplicaRepo(db);
    const banks = db.prepare("SELECT external_bank_id,template_digest FROM hindsight_bank_setup ORDER BY external_bank_id").all()
      .map((row) => ({ bankId: String(row.external_bank_id), templateDigest: String(row.template_digest),
        checkpoint: replica.checkpoint(String(row.external_bank_id)) }));
    assert(banks.every((bank) => bank.checkpoint));
    const ready = db.prepare("SELECT config_fingerprint,checkpoint_set_digest FROM hindsight_cutover_runs WHERE run_id=:run")
      .get({ run: String(run.run_id) });
    assert.equal(hindsightCheckpointSetDigest(banks), ready.checkpoint_set_digest);
    const lease = createHindsightCutoverRunRepo(db).acquireLease({ runId: String(run.run_id), owner: randomUUID(), now,
      expiresAt: new Date(Date.parse(now) + 600_000).toISOString() });
    const hindsightEpochId = randomUUID();
    let custody;
    const promoted = promoteHindsightAuthority(db, { lease, predecessorEpochId: String(run.expected_predecessor_epoch_id),
      hindsightEpochId, transactionId: randomUUID(), configFingerprint: String(ready.config_fingerprint),
      checkpointSetDigest: String(ready.checkpoint_set_digest), banks, now,
      beforeCommit() { custody = carryHindsightActivationCustody(db, {
        predecessorEpochId: String(run.expected_predecessor_epoch_id), hindsightEpochId, now }); } });
    assert.equal(promoted.selection.mode, "hindsight");
    let originalSources = 0;
    let originalPolicies = 0;
    let originalInvalidated = 0;
    let blocks = 0;
    for (const row of preparedRows) {
      const prepared = readHindsightCurrentPreparation(db, String(row.preparation_id));
      const checkpoint = replica.checkpoint(prepared.bankId);
      assert(checkpoint);
      const evidence = readHindsightApplicationBootstrapEvidence(db, { bankId: prepared.bankId,
        bankScope: prepared.bankScope, authorityEpochId: hindsightEpochId,
        namespace: { application_id: "taki", provider_lineage: checkpoint.providerLineage,
          bank_generation: checkpoint.bankGeneration } });
      assert(evidence, "the actual new receipt must admit the original D78 evidence reader");
      originalSources += evidence.sources.size;
      originalPolicies += evidence.memories.size;
      originalInvalidated += [...evidence.memories.values()].filter((item) => item.value.unit.state === "invalidated").length;
      blocks += evidence.blocks.length;
    }
    assert.equal(originalSources, 722);
    assert.equal(originalPolicies, 722);
    assert.equal(originalInvalidated, 21);
    Object.assign(result, { activationExecuted: true, currentAuthority: promoted.selection.mode, custody,
      activationReceipts: Number(db.prepare("SELECT count(*) AS count FROM hindsight_authority_activation_receipts").get().count),
      bootstrap: { originalSources, originalPolicies, originalInvalidated, blocks, realReceiptValidated: true },
      nativeApplicationArtifactsPublished: false, runtimeStarted: false });
  }
} catch (error) {
  result.errorType = error?.constructor?.name ?? "UnknownError";
  writeFileSync(join(root, "failure.log"), String(error?.stack ?? error), "utf8");
} finally {
  db.close();
  result.sourceHashUnchanged = hash(source) === beforeHash;
  writeFileSync(join(root, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result));
}
process.exitCode = !result.errorType && result.sourceHashUnchanged ? 0 : 1;

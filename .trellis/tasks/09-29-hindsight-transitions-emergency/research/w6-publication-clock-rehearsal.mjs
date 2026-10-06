/** Owned-copy publication diagnostic: real clocks and producers, no runtime/Native/model startup. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

if (process.argv.length === 2) { console.log(JSON.stringify({ executed: false })); process.exit(0); }
assert.deepEqual(process.argv.slice(2), ["--rehearse-reviewed-proven-copy"]);
const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const source = join(repo, ".trellis/.runtime/stage4-w6/db280d150f6340618b340a70439b43f7/core/taki.db");
const sourceSha = "5d0071986151d6762cc400263b969c75fb7865a0b8f282921a585b23b24b82fe";
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
assert.equal(digest(source), sourceSha);
for (const suffix of ["-wal", "-shm", "-journal"]) assert(!existsSync(source + suffix));
const root = join(repo, ".trellis/.runtime/stage4-w6-publication", randomUUID());
mkdirSync(root, { recursive: true }); assert.equal(realpathSync(root).toLowerCase(), root.replaceAll("/", "\\").toLowerCase());
const copy = join(root, "core.sqlite"); copyFileSync(source, copy, constants.COPYFILE_EXCL);
assert.equal(digest(copy), sourceSha);
const resultPath = join(root, "result.json");
const result = { version: 1, root, startedAt: new Date().toISOString(), completed: false, stages: [],
  scope: "Synthetic repository-level recovery admission on exact actual Core copy; production candidate/proof/publication only",
  startsRuntime: false, startsNative: false, modelCalls: 0, sourceSha256: sourceSha };
const save = () => writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n"); save();
console.log(JSON.stringify({ resultPath }));
const { openDatabase } = await import("../../../../packages/core/src/db/sqlite.ts");
const { createMemoryOperationRepo } = await import("../../../../packages/core/src/db/memory-operation-repo.ts");
const { readTransitionIntent, readTransitionAttempt, claimTransition, requireTransitionLease, renewTransitionLease } = await import("../../../../packages/core/src/db/memory-transition-repo.ts");
const { admitTransitionRecovery } = await import("../../../../packages/core/src/db/memory-transition-recovery-repo.ts");
const { readTransitionDocument } = await import("../../../../packages/core/src/db/memory-transition-document-repo.ts");
const { MemorySurvivingBankEvidenceSchema } = await import("../../../../packages/shared/src/index.ts");
const { prepareEmergencyCandidate, readVerifiedEmergencyCandidate } = await import("../../../../packages/core/src/db/memory-transition-emergency-candidate.ts");
const { buildEmergencyPublicationProof, readVerifiedEmergencyPublication } = await import("../../../../packages/core/src/db/memory-transition-emergency-publication.ts");
const { recordTransitionProof, readTransitionReceipt } = await import("../../../../packages/core/src/db/memory-transition-evidence-repo.ts");
const { publishMemoryTransition, verifyInstalledTransitionLocal } = await import("../../../../packages/core/src/db/memory-transition-publication-repo.ts");
const { assertEmergencyConfiguration } = await import("../../../../packages/core/src/memory/transitions/transition-current-identity.ts");
const { transitionLocalHash } = await import("../../../../packages/core/src/memory/transitions/transition-local-encoding.ts");
const db = openDatabase({ path: copy, migrations: [] });
const tid = "0faf660d-9d8c-4215-ae5f-954f9f574734";
const now = () => new Date().toISOString();
let currentStage = "initialize-repository-fixture";
let lease;
try {
  const intent = readTransitionIntent(db, tid); const prior = readTransitionAttempt(db, tid);
  assert(intent && prior && prior.phase === "proven" && prior.generation === 2);
  assert.equal(readTransitionReceipt(db, tid), undefined);
  const operations = createMemoryOperationRepo(db, now);
  const retained = [intent.operationId, prior.operationId].map((id) => [id, transitionLocalHash(operations.get(id))]);
  const operationId = randomUUID();
  const request = { ...intent.request, requestId: randomUUID(),
    recovery: { transitionId: tid, expectedGeneration: prior.generation, expectedReceiptId: null } };
  // This deliberately starts below operator preview/admission. It isolates the publication clock boundary;
  // the separate actual driver remains responsible for genuine operator admission, binding and restart.
  db.transaction(() => {
    const family = db.prepare("SELECT family FROM memory_operations WHERE operation_id=:id").get({ id: intent.operationId }).family;
    operations.insertAdmitted({ operationId, kind: request.kind, family, authorityEpochId: intent.request.expected.predecessorEpochId,
      request, producer: { kind: "transition", transitionId: tid, requestId: request.requestId }, bootId: "owned-publication-rehearsal" });
    admitTransitionRecovery(db, { version: 1, operationId, transitionId: tid, request,
      actorId: "owned-publication-rehearsal", admittedAt: now() });
    operations.transition({ operationId, expectedState: "admitted", patch: { state: "running" } });
  });
  lease = claimTransition(db, { transitionId: tid, operationId, ownerId: "owned-publication-rehearsal", now: now(), leaseMs: 300_000 });
  const work = () => ({ lease, now: now(), currentTime: now, assertConfiguration: () => {
    requireTransitionLease(db, { lease, now: now() }); assertEmergencyConfiguration(db, intent.request.expected);
  } });
  const stage = (name, fn, refresh = false) => {
    currentStage = name;
    renewTransitionLease(db, { lease, now: now() });
    const started = performance.now(); const value = fn();
    if (refresh) {
      const next = readTransitionAttempt(db, tid);
      assert.equal(next.attemptId, lease.attemptId); assert.equal(next.operationId, lease.operationId);
      assert.equal(next.generation, lease.generation); lease = next;
    }
    requireTransitionLease(db, { lease, now: now() });
    const record = { name, elapsedMs: performance.now() - started, finishedAt: now(), leaseUntil: readTransitionAttempt(db, tid).leaseUntil };
    result.stages.push(record); save(); console.log(JSON.stringify(record)); return value;
  };
  const evidence = intent.request.expected.banks.map((bank) => readTransitionDocument(db, "surviving_evidence", {
    transitionId: tid, slot: bank.nativeBankId, schema: MemorySurvivingBankEvidenceSchema }));
  assert(evidence.every(Boolean));
  const candidate = stage("candidate", () => prepareEmergencyCandidate(db, { ...work(), evidence }));
  assert.equal(candidate.candidateId, "c10685da68d8d5f6e8861f2c322d14b7ef1e823053d0b0aaeace5fbafb336c10");
  const proof = stage("proof", () => buildEmergencyPublicationProof(db, { ...work(), candidateId: candidate.candidateId }));
  recordTransitionProof(db, { ...work(), proof }); lease = readTransitionAttempt(db, tid);
  const receipt = stage("publication-commit", () => publishMemoryTransition(db, { ...work(), candidateId: candidate.candidateId }), true);
  // Mirror the actual driver's two independent post-COMMIT reads before binding. The recorded time is their
  // combined cost, not one reader's latency and not an excuse to reuse verification across independent entries.
  stage("fresh-independent-readback", () => {
    const publication = readVerifiedEmergencyPublication(db, receipt.receiptId);
    assert.equal(publication.candidateId, candidate.candidateId);
    const rebuilt = readVerifiedEmergencyCandidate(db, candidate.candidateId);
    verifyInstalledTransitionLocal(db, rebuilt);
  });
  assert.deepEqual(retained, retained.map(([id]) => [id, transitionLocalHash(operations.get(id))]));
  assert.equal(readTransitionReceipt(db, tid).receiptId, receipt.receiptId);
  result.receiptId = receipt.receiptId; result.candidateId = candidate.candidateId;
  result.counts = { banks: candidate.state.banks.length, sources: candidate.state.sources.length, records: candidate.state.records.length };
  result.completed = true;
} catch (error) {
  result.error = { stage: currentStage, code: String(error?.message).match(/^MEMORY_[A-Z_]+$/)?.[0] ?? "W6_REHEARSAL_REFUSED",
    sourceFrames: String(error?.stack).split("\n").filter((line) => line.includes("at ") && /packages\/core|w6-publication-clock-rehearsal/.test(line)).slice(0, 8) };
  process.exitCode = 1;
} finally {
  db.close(); result.sourceUnchanged = digest(source) === sourceSha; result.finishedAt = now();
  result.stoppedCopySha256 = digest(copy); save(); console.log(JSON.stringify(result)); assert(result.sourceUnchanged);
}

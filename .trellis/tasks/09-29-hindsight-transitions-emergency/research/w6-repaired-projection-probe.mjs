/** Read-only reconstruction diagnostic for the exact stopped, sealed W6 failure. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openReadonlyDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { readTransitionIntent } from "../../../../packages/core/src/db/memory-transition-repo.ts";
import { readEmergencyCapture, readEmergencyIncident } from "../../../../packages/core/src/db/memory-transition-emergency-repo.ts";
import { captureSurvivingBankEvidence } from "../../../../packages/core/src/db/memory-transition-surviving-capture.ts";
import { readTransitionPublishedNativeBaseline, readTransitionLocalAncestors } from "../../../../packages/core/src/db/memory-transition-candidate-repo.ts";
import { readSurvivingBaselinePolicies } from "../../../../packages/core/src/db/memory-transition-surviving-policy.ts";
import { projectSurvivingLocalBank } from "../../../../packages/core/src/memory/transitions/transition-local-projection.ts";
import { verifySurvivingBankEvidence } from "../../../../packages/core/src/memory/transitions/transition-surviving-evidence.ts";
import { projectPendingSources } from "../../../../packages/core/src/memory/transitions/transition-pending-sources.ts";
import { historicalRows, sortState } from "../../../../packages/core/src/memory/transitions/transition-local-candidate.ts";
import { requireTransitionLocalClosure } from "../../../../packages/core/src/db/memory-transition-local-capture.ts";
import { MemoryTransitionLocalStateSchema } from "../../../../packages/shared/src/index.ts";
import { transitionLocalHash } from "../../../../packages/core/src/memory/transitions/transition-local-encoding.ts";

if (process.argv.length === 2) { console.log(JSON.stringify({ executed: false })); process.exit(0); }
assert.deepEqual(process.argv.slice(2), ["--inspect-reviewed-stopped-copy"]);
const root = "H:/TakiAgent/.trellis/.runtime/stage4-w6/db280d150f6340618b340a70439b43f7";
const transitionId = "0faf660d-9d8c-4215-ae5f-954f9f574734";
const corePath = `${root}/core/taki.db`;
const sealedPath = `${root}/core/backups/incident-05f6c765-b099-4894-a191-32c83969a481/core.sqlite`;
const expected = ["41fb3b3d289575f7cd8e276b8c9fea696a8a89581b4c3aac5b31d21688afec76", "cc6dc6567eb3dc88512134f6444945c8c8bdf779a8352f0cd6bf599897569e6b"];
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const hashes = () => [corePath, sealedPath].map(digest);
assert.deepEqual(hashes(), expected);
for (const path of [corePath, sealedPath]) for (const suffix of ["-wal", "-shm", "-journal"]) assert(!existsSync(path + suffix));
const output = fileURLToPath(new URL("./w6-repaired-projection-result.json", import.meta.url));
assert(!existsSync(output), "W6_PROBE_RESULT_ALREADY_EXISTS");
const report = { startedAt: new Date().toISOString(), completed: false, banks: [], unchanged: false };
const db = openReadonlyDatabase(corePath);
const sealed = openReadonlyDatabase(sealedPath);
let stage = "read-original-identity";
try {
  const intent = readTransitionIntent(db, transitionId);
  const capture = readEmergencyCapture(db, transitionId);
  const incident = readEmergencyIncident(db, transitionId);
  assert(intent && capture && incident?.transition);
  const epochId = randomUUID(); // In-memory output address only: no reservation or candidate is written.
  const scopes = [];
  const state = { banks: [], sources: [], records: [], derived: [], blocks: [], history: [], historicalReferences: [], sourceAliases: [], sourceSets: [] };
  let pendingCount = 0;
  for (const bank of intent.request.expected.banks) {
    stage = "capture-and-verify";
    const evidence = captureSurvivingBankEvidence(sealed, { capture, bank, lineage: intent.request.expected.sourceLineageId });
    const covered = incident.transition.banks.find((row) => row.bankId === evidence.bankId);
    assert.equal(evidence.evidenceId, covered?.survivingEvidenceId);
    assert.equal(evidence.checkpointHash, covered?.checkpointHash);
    const context = verifySurvivingBankEvidence(evidence);
    const head = context.heads.find((row) => row.object_kind === "bank"); assert(head);
    const body = context.body(head); assert.equal(body?.body_schema, "application-bank.v1");
    const original = body.value.original_bank; assert(original);
    assert.equal(transitionLocalHash(body.value.scope), transitionLocalHash(bank.scope));
    const scope = { scope: bank.scope, nativeBankId: evidence.bankId, nativeGeneration: evidence.namespace.bank_generation,
      localBankId: original.bankId, origin: "original", originEpochId: original.authorityEpochId, evidenceId: evidence.evidenceId };
    scopes.push(scope);
    stage = "read-committed-policy";
    const nativeBaseline = readTransitionPublishedNativeBaseline(db, { epochId: capture.predecessorEpochId, nativeBankId: evidence.bankId });
    const survivingPolicies = readSurvivingBaselinePolicies(db, { evidence, predecessorEpochId: capture.predecessorEpochId, baseline: nativeBaseline });
    stage = "project-bank";
    const projected = projectSurvivingLocalBank({ evidence, scope, epochId, createdAt: capture.createdAt,
      nativeBaseline, survivingPolicies, previous: nativeBaseline?.mappings, localEpochIds: readTransitionLocalAncestors(db, capture.predecessorEpochId) });
    state.banks.push(projected.bank);
    for (const key of ["sources", "records", "derived", "historicalReferences", "sourceAliases", "sourceSets"]) state[key].push(...projected[key]);
    state.history.push(...projected.initialPolicies);
    const blocks = new Map();
    for (const artifact of evidence.artifacts.filter((row) => row.key.artifact_kind === "block")) {
      const key = JSON.stringify(artifact.key); const prior = blocks.get(key);
      if (!prior || prior.revision < artifact.revision) blocks.set(key, artifact);
    }
    for (const artifact of blocks.values()) {
      if (artifact.tombstoned) continue;
      const value = context.reader.body(artifact.body_ref).content;
      assert.equal(value.body_schema, "application-block.v1");
      assert.equal(transitionLocalHash(value.value.scope), transitionLocalHash(scope.scope));
      state.blocks.push(value.value);
    }
    pendingCount += projectPendingSources({ context, scope, evidenceId: evidence.evidenceId, evidenceHash: evidence.evidenceId }).length;
    report.banks.push({ sources: projected.sources.length, records: projected.records.length, reusedPolicies: survivingPolicies.size, incidentMatched: true });
    console.log(JSON.stringify({ stage: "bank-projected", ...report.banks.at(-1) }));
  }
  stage = "full-closure-and-schema";
  state.history.push(...historicalRows(db, scopes)); sortState(state); requireTransitionLocalClosure(state);
  MemoryTransitionLocalStateSchema.parse(state);
  report.counts = Object.fromEntries(Object.entries(state).map(([key, rows]) => [key, rows.length]));
  report.pendingSources = pendingCount;
  report.completed = true;
} catch (error) {
  report.error = { stage, name: error?.name, code: String(error?.message).match(/^MEMORY_[A-Z_]+$/)?.[0] ?? "W6_PROBE_REFUSED",
    sourceFrames: String(error?.stack).split("\n").filter((line) => line.includes("at ") && /packages\/core|w6-repaired-projection-probe/.test(line)).slice(0, 8) };
  process.exitCode = 1;
} finally {
  sealed.close(); db.close();
  report.hashesAfter = hashes(); report.unchanged = JSON.stringify(report.hashesAfter) === JSON.stringify(expected);
  report.finishedAt = new Date().toISOString();
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report));
  assert(report.unchanged);
}

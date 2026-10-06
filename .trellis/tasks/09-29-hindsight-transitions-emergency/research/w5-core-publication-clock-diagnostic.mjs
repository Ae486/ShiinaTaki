/** No-network production builder/proof/COMMIT/reconstruction replay on a newly allocated private copy. */
import { backup, DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { readTransitionAttempt, readTransitionIntent, requireTransitionLease, updateTransitionAttempt } from "../../../../packages/core/src/db/memory-transition-repo.ts";
import { recordTransitionProof } from "../../../../packages/core/src/db/memory-transition-evidence-repo.ts";
import { buildTransitionLocalCandidate } from "../../../../packages/core/src/memory/transitions/transition-local-candidate.ts";
import { assertTransitionConfiguration } from "../../../../packages/core/src/memory/transitions/transition-current-identity.ts";
import { buildTransitionPublicationProof } from "../../../../packages/core/src/db/memory-transition-publication-proof.ts";
import { publishMemoryTransition } from "../../../../packages/core/src/db/memory-transition-publication-repo.ts";
import { readVerifiedTransitionPublication } from "../../../../packages/core/src/db/memory-transition-publication-reader.ts";

const source = resolve(process.argv[2]); const output = resolve(process.argv[3]);
if (existsSync(output)) throw new Error("OUTPUT_ALREADY_EXISTS");
const implementationManifest = process.argv[4] ? resolve(process.argv[4]) : null;
if (implementationManifest) {
  for (const entry of JSON.parse(readFileSync(implementationManifest, "utf8")).files) {
    if (createHash("sha256").update(readFileSync(entry.path)).digest("hex") !== entry.sha256) throw new Error("SOURCE_MANIFEST_MISMATCH");
  }
}
const copyRoot = resolve(".trellis/.runtime", `w5-core-publication-diagnostic-${randomUUID()}`);
mkdirSync(copyRoot); const destination = join(copyRoot, "application.sqlite");
const checksum = () => createHash("sha256").update(readFileSync(source)).digest("hex");
const result = { sourceSha256Before: checksum(), copyRoot, historicalStateOverride: "exact current recovery operation viewed as running",
  implementationManifestSha256: implementationManifest ? createHash("sha256").update(readFileSync(implementationManifest)).digest("hex") : null,
  timings: [], guards: [] };
const original = new DatabaseSync(source, { readOnly: true });
try { await backup(original, destination); } finally { original.close(); }
const copy = openDatabase({ path: destination, migrations: [] }); let operationId;
const db = { ...copy, prepare(sql) {
  const statement = copy.prepare(sql);
  if (sql === "SELECT state FROM memory_operations WHERE operation_id=:id") return { ...statement,
    get(params) { return params?.id === operationId ? { state: "running" } : statement.get(params); } };
  return statement;
} };
function safeFailure(error) {
  const codes = ["MEMORY_TRANSITION_LEASE_LOST", "MEMORY_TRANSITION_STALE", "MEMORY_TRANSITION_PROOF_INVALID", "MEMORY_TRANSITION_CONFLICT"];
  return { code: codes.includes(error?.message) ? error.message : "UNCLASSIFIED",
    stack: String(error?.stack ?? "").split("\n").filter((line) => /^\s+at /.test(line)) };
}
let stage = "setup"; const started = performance.now();
function timed(name, run) {
  stage = name; const beginning = performance.now(); const value = run();
  const timing = { stage, ms: Math.round(performance.now() - beginning), totalMs: Math.round(performance.now() - started) };
  result.timings.push(timing); console.log(JSON.stringify(timing)); return value;
}
try {
  const reservation = db.prepare("SELECT * FROM memory_transition_candidate_reservations").get();
  let lease = readTransitionAttempt(db, reservation.transition_id); operationId = lease.operationId;
  const intent = readTransitionIntent(db, reservation.transition_id); const historyStart = reservation.created_at;
  result.remainingLeaseMsAtStart = Date.parse(lease.leaseUntil) - Date.parse(historyStart);
  function guard() {
    const elapsedMs = Math.round(performance.now() - started);
    const liveNow = new Date(Date.parse(historyStart) + elapsedMs).toISOString();
    const record = { stage, elapsedMs, liveNow, liveClockPass: true };
    try { requireTransitionLease(db, { lease, now: liveNow }); }
    catch (error) { record.liveClockPass = false; record.failure = safeFailure(error); }
    result.guards.push(record);
    requireTransitionLease(db, { lease, now: historyStart });
    assertTransitionConfiguration(db, intent.request.expected, intent.request.expected.configFingerprint);
  }
  const input = () => ({ lease, now: historyStart, assertConfiguration: guard });
  const candidate = timed("builder", () => buildTransitionLocalCandidate(db, { ...input(),
    evidenceIds: db.prepare("SELECT id FROM memory_transition_native_evidence ORDER BY slot").all().map((row) => row.id) }));
  const proof = timed("proof", () => buildTransitionPublicationProof(db, { ...input(), candidateId: candidate.candidateId }));
  guard(); recordTransitionProof(db, { ...input(), proof });
  lease = readTransitionAttempt(db, intent.transitionId);
  lease = updateTransitionAttempt(db, { ...input(), patch: { phase: "proven" } });
  const receipt = timed("publication", () => publishMemoryTransition(db, { ...input(), candidateId: candidate.candidateId }));
  lease = readTransitionAttempt(db, intent.transitionId); guard();
  const publication = timed("reconstruction", () => readVerifiedTransitionPublication(db, receipt.receiptId));
  result.passed = publication.candidateId === candidate.candidateId;
  result.counts = { banks: candidate.state.banks.length, records: candidate.state.records.length,
    sources: candidate.state.sources.length, sourceSets: candidate.state.sourceSets.length,
    candidates: db.prepare("SELECT count(*) AS n FROM memory_transition_candidates").get().n,
    receipts: db.prepare("SELECT count(*) AS n FROM memory_transition_receipts").get().n,
    publications: db.prepare("SELECT count(*) AS n FROM memory_transition_publications").get().n };
  result.committedEpochMatches = db.prepare("SELECT active_epoch_id FROM canonical_memory_authority_state").get().active_epoch_id === candidate.targetEpochId;
} catch (error) { result.failure = { stage, ...safeFailure(error) }; console.log(JSON.stringify(result.failure)); process.exitCode = 1; }
finally {
  copy.close(); result.sourceSha256After = checksum(); result.sourceUnchanged = result.sourceSha256Before === result.sourceSha256After;
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ passed: result.passed, timings: result.timings,
    expiredGuards: result.guards.filter((g) => !g.liveClockPass).length, sourceUnchanged: result.sourceUnchanged }));
}

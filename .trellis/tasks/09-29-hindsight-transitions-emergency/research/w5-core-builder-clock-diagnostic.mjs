/** Replay the original builder on a new private SQLite copy; original evidence and source remain untouched. */
import { backup, DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { readTransitionAttempt, requireTransitionLease } from "../../../../packages/core/src/db/memory-transition-repo.ts";
import { buildTransitionLocalCandidate } from "../../../../packages/core/src/memory/transitions/transition-local-candidate.ts";

const source = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const copyRoot = resolve(".trellis/.runtime", `w5-core-builder-diagnostic-${randomUUID()}`);
mkdirSync(copyRoot);
const destination = join(copyRoot, "application.sqlite");
const checksum = () => createHash("sha256").update(readFileSync(source)).digest("hex");
const result = { sourceSha256Before: checksum(), copyRoot, historicalStateOverride: "exact current recovery operation viewed as running", guards: [] };
const original = new DatabaseSync(source, { readOnly: true });
try { await backup(original, destination); } finally { original.close(); }
const copy = openDatabase({ path: destination, migrations: [] });
let operationId;
const db = { ...copy, prepare(sql) {
  const statement = copy.prepare(sql);
  if (sql === "SELECT state FROM memory_operations WHERE operation_id=:id") {
    return { ...statement, get(params) { return params?.id === operationId ? { state: "running" } : statement.get(params); } };
  }
  return statement;
} };
function errorDetails(error) {
  return { errorName: error?.name, code: /^[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "REDACTED_MESSAGE",
    stack: String(error?.stack ?? "").split("\n").filter((line) => /^\s+at /.test(line)),
    issues: error?.issues?.map(({ path, code }) => ({ path, code })) };
}
try {
  const reservation = db.prepare("SELECT * FROM memory_transition_candidate_reservations").get();
  const lease = readTransitionAttempt(db, reservation.transition_id);
  operationId = lease.operationId;
  const historyStart = reservation.created_at;
  const started = performance.now();
  result.historicalStart = historyStart;
  result.leaseUntil = lease.leaseUntil;
  result.remainingLeaseMsAtStart = Date.parse(lease.leaseUntil) - Date.parse(historyStart);
  const candidate = buildTransitionLocalCandidate(db, { lease, now: historyStart,
    evidenceIds: db.prepare("SELECT id FROM memory_transition_native_evidence ORDER BY slot").all().map((row) => row.id),
    assertConfiguration() {
      const elapsedMs = Math.round(performance.now() - started);
      const liveNow = new Date(Date.parse(historyStart) + elapsedMs).toISOString();
      const guard = { ordinal: result.guards.length + 1, elapsedMs, liveNow };
      try { requireTransitionLease(db, { lease, now: liveNow }); guard.liveClockPass = true; }
      catch (error) { guard.liveClockPass = false; guard.liveClockError = errorDetails(error); }
      result.guards.push(guard); console.log(JSON.stringify(guard));
      // Keep only this diagnostic's historical clock frozen so later data
      // invariants can be tested even if the real elapsed-time guard fails.
      requireTransitionLease(db, { lease, now: historyStart });
    },
  });
  result.builderMs = Math.round(performance.now() - started);
  result.frozenClockBuilderPassed = true;
  result.candidateCounts = { banks: candidate.state.banks.length, records: candidate.state.records.length,
    sources: candidate.state.sources.length, sourceSets: candidate.state.sourceSets.length };
  result.copyCandidateRows = db.prepare("SELECT count(*) AS count FROM memory_transition_candidates").get().count;
  result.copyBaselineRows = db.prepare("SELECT count(*) AS count FROM memory_transition_baselines").get().count;
} catch (error) { result.failure = errorDetails(error); console.log(JSON.stringify(result.failure)); process.exitCode = 1; }
finally {
  copy.close(); result.sourceSha256After = checksum(); result.sourceUnchanged = result.sourceSha256Before === result.sourceSha256After;
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ builderMs: result.builderMs, frozenClockBuilderPassed: result.frozenClockBuilderPassed,
    expiredGuards: result.guards.filter((g) => !g.liveClockPass).map((g) => g.ordinal), sourceUnchanged: result.sourceUnchanged }));
}

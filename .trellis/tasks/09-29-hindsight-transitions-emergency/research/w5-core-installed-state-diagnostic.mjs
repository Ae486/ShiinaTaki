/** Compare real candidate and installed Local rows on another private copy; never print payloads or logical IDs. */
import { backup, DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { readTransitionCandidate } from "../../../../packages/core/src/db/memory-transition-candidate-repo.ts";
import { readTransitionIntent } from "../../../../packages/core/src/db/memory-transition-repo.ts";
import { installTransitionLocalCandidate } from "../../../../packages/core/src/db/memory-transition-local-staging.ts";
import { publishTransitionRepresentations } from "../../../../packages/core/src/db/memory-transition-representation.ts";
import { discoverTransitionLocal } from "../../../../packages/core/src/db/memory-transition-local-capture.ts";
import { transitionLocalHash } from "../../../../packages/core/src/memory/transitions/transition-local-encoding.ts";

const source = resolve(process.argv[2]); const output = resolve(process.argv[3]);
if (existsSync(output)) throw new Error("OUTPUT_ALREADY_EXISTS");
const checksum = () => createHash("sha256").update(readFileSync(source)).digest("hex");
const copyRoot = resolve(".trellis/.runtime", `w5-core-installed-diagnostic-${randomUUID()}`);
mkdirSync(copyRoot); const destination = join(copyRoot, "application.sqlite");
const result = { sourceSha256Before: checksum(), copyRoot, comparisons: [] };
const original = new DatabaseSync(source, { readOnly: true });
try { await backup(original, destination); } finally { original.close(); }
const db = openDatabase({ path: destination, migrations: [] });
try {
  const candidate = readTransitionCandidate(db, String(db.prepare("SELECT id FROM memory_transition_candidates").get().id));
  const intent = readTransitionIntent(db, candidate.transitionId);
  db.prepare("INSERT INTO canonical_memory_authority_epochs VALUES(:epoch,'local',:lineage,'closed',:previous,:now,:now,'planned-switch')")
    .run({ epoch: candidate.targetEpochId, lineage: intent.request.expected.targetLineageId, previous: candidate.predecessorEpochId, now: candidate.createdAt });
  installTransitionLocalCandidate(db, candidate.candidateId);
  db.prepare("UPDATE canonical_memory_authority_epochs SET status='closed',ended_at=:now WHERE epoch_id=:previous")
    .run({ now: candidate.createdAt, previous: candidate.predecessorEpochId });
  db.prepare("UPDATE canonical_memory_authority_epochs SET status='active',ended_at=NULL WHERE epoch_id=:epoch").run({ epoch: candidate.targetEpochId });
  db.prepare("UPDATE canonical_memory_authority_state SET active_epoch_id=:epoch").run({ epoch: candidate.targetEpochId });
  publishTransitionRepresentations(db, { candidate, provider: "local", now: candidate.createdAt });
  const installed = discoverTransitionLocal(db, candidate.targetEpochId).state;
  for (const key of ["banks", "sources", "records", "derived", "blocks", "historicalReferences", "sourceAliases", "sourceSets"]) {
    const expected = candidate.state[key]; const actual = installed[key];
    const expectedHashes = expected.map(transitionLocalHash); const actualHashes = actual.map(transitionLocalHash);
    const entry = { key, expectedCount: expected.length, actualCount: actual.length,
      sameSequence: transitionLocalHash(expected) === transitionLocalHash(actual),
      sameMultiset: transitionLocalHash([...expectedHashes].sort()) === transitionLocalHash([...actualHashes].sort()),
      sameSet: new Set([...expectedHashes, ...actualHashes]).size === new Set(expectedHashes).size };
    if (!entry.sameSequence && !entry.sameMultiset) {
      const changed = expected.filter((_, index) => !actualHashes.includes(expectedHashes[index]));
      entry.changedCount = changed.length;
      if (key === "records") entry.fieldMismatches = changed.slice(0, 3).map((record) => {
        const stored = actual.find((item) => item.unit.memoryId === record.unit.memoryId && item.unit.bankId === record.unit.bankId);
        return !stored ? ["missing"] : ["unit", "policy", "provenance"].filter((field) => transitionLocalHash(record[field]) !== transitionLocalHash(stored[field]));
      });
    }
    result.comparisons.push(entry); console.log(JSON.stringify(entry));
  }
} catch (error) { result.failure = { name: error.name, code: /^[A-Z0-9_]+$/.test(error.message) ? error.message : "REDACTED",
  stack: String(error.stack).split("\n").filter((line) => /^\s+at /.test(line)) }; process.exitCode = 1; }
finally { db.close(); result.sourceSha256After = checksum(); result.sourceUnchanged = result.sourceSha256Before === result.sourceSha256After;
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify({ failure: result.failure, sourceUnchanged: result.sourceUnchanged })); }

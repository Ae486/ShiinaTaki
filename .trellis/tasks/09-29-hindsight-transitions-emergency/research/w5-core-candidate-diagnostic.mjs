/** Read-only replay of saved evidence and pure projection; never starts a service or changes the source DB. */
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readTransitionNativeEvidence, readTransitionLocalAncestors } from "../../../../packages/core/src/db/memory-transition-candidate-repo.ts";
import { readTransitionIntent } from "../../../../packages/core/src/db/memory-transition-repo.ts";
import { transitionProjectionContext, projectTransitionLocalBank } from "../../../../packages/core/src/memory/transitions/transition-local-projection.ts";
import { readBlocks, sortState } from "../../../../packages/core/src/memory/transitions/transition-local-candidate.ts";
import { requireTransitionLocalClosure } from "../../../../packages/core/src/db/memory-transition-local-capture.ts";

const source = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const checksum = () => createHash("sha256").update(readFileSync(source)).digest("hex");
const before = checksum();
const raw = new DatabaseSync(source, { readOnly: true });
const db = { prepare(sql) {
  if (!/^SELECT\b/i.test(sql.trim())) throw new Error("DIAGNOSTIC_MUTATION_REFUSED");
  const statement = raw.prepare(sql);
  return { get: (params) => params ? statement.get(params) : statement.get(),
    all: (params) => params ? statement.all(params) : statement.all(), run() { throw new Error("DIAGNOSTIC_MUTATION_REFUSED"); } };
} };
const results = { before, stages: [] };
const state = { banks: [], sources: [], records: [], derived: [], blocks: [], history: [], historicalReferences: [], sourceAliases: [], sourceSets: [] };
function stage(name, call) {
  const started = performance.now();
  try {
    const value = call(); results.stages.push({ name, ok: true, ms: Math.round(performance.now() - started) });
    console.log(JSON.stringify(results.stages.at(-1))); return value;
  } catch (error) {
    const failure = { name, ok: false, ms: Math.round(performance.now() - started), errorName: error?.name,
      code: /^[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "REDACTED_MESSAGE",
      stack: String(error?.stack ?? "").split("\n").filter((line) => /^\s+at /.test(line)),
      issues: error?.issues?.map(({ path, code }) => ({ path, code })) };
    results.stages.push(failure); console.log(JSON.stringify(failure)); throw error;
  }
}
try {
  const reservation = raw.prepare("SELECT * FROM memory_transition_candidate_reservations").get();
  const intent = readTransitionIntent(db, reservation.transition_id);
  const localEpochIds = readTransitionLocalAncestors(db, intent.request.expected.predecessorEpochId);
  for (const [index, row] of raw.prepare("SELECT id,slot FROM memory_transition_native_evidence ORDER BY slot").all().entries()) {
    const tag = `bank${index + 1}`;
    const evidence = stage(`${tag}.readAndVerifySavedEvidence`, () => readTransitionNativeEvidence(db, row.id));
    const context = stage(`${tag}.projectionContext`, () => transitionProjectionContext(evidence));
    const head = context.heads.find((head) => head.object_kind === "bank");
    const body = context.body(head);
    const original = body?.body_schema === "application-bank.v1" ? body.value.original_bank : null;
    const admitted = intent.request.expected.banks.find((bank) => bank.nativeBankId === row.slot);
    const scope = { scope: admitted.scope, localBankId: original?.bankId ?? randomUUID(), nativeBankId: row.slot,
      nativeGeneration: evidence.status.request.bank_generation, evidenceId: row.id,
      origin: original ? "original" : "new", originEpochId: original?.authorityEpochId ?? null };
    results.stages.push({ name: `${tag}.scopeFacts`, originalBankPresent: Boolean(original),
      originalEpochIsAncestor: Boolean(original && localEpochIds.includes(original.authorityEpochId)),
      kind: scope.scope.kind });
    const projection = stage(`${tag}.pureLocalProjection`, () => projectTransitionLocalBank({ evidence, scope,
      epochId: reservation.target_epoch_id, createdAt: reservation.created_at, localEpochIds }));
    state.banks.push(projection.bank); state.sources.push(...projection.sources); state.records.push(...projection.records);
    state.derived.push(...projection.derived); state.historicalReferences.push(...projection.historicalReferences);
    state.sourceAliases.push(...projection.sourceAliases); state.sourceSets.push(...projection.sourceSets);
    state.history.push(...projection.initialPolicies);
    state.blocks.push(...stage(`${tag}.readBlocks`, () => readBlocks(evidence, scope)));
  }
  stage("combinedLocalClosure", () => { sortState(state); requireTransitionLocalClosure(state); });
} catch { results.failed = true; }
finally {
  raw.close(); results.after = checksum(); results.sourceUnchanged = before === results.after;
  writeFileSync(output, JSON.stringify(results, null, 2) + "\n");
}
if (results.failed || !results.sourceUnchanged) process.exitCode = 1;

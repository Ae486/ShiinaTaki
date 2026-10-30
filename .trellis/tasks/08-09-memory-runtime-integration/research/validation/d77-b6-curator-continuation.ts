/**
 * INPUT: the copied acceptance runtime and its original durable unfinished policy work
 * OUTPUT: bounded real-model continuation, reopen evidence and truthful per-target outcomes
 * POS: task-only verification; no queue rewriting, synthetic clock or whole-library completion claim
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { HindsightPolicyWorkKeySchema, type HindsightPolicyWorkKey } from "../../../../../packages/core/src/db/hindsight-policy-work-contract.ts";
import { readPolicyWork } from "../../../../../packages/core/src/db/hindsight-policy-work-storage.ts";
import { getBlock } from "../../../../../packages/core/src/memory/block-registry.ts";
import { bodyFor } from "./d77-owner-acceptance-storage.ts";
import { controller, event, openRuntime, ROOT, traffic, type AcceptanceRuntime, type AcceptanceRuntimeOptions } from "./d77-owner-acceptance-context.ts";

type Owner = { current: AcceptanceRuntime };
type WriteEvidence = (name: string, value: unknown) => void;

function initialCohort(runtime: AcceptanceRuntime): HindsightPolicyWorkKey[] {
  const path = join(ROOT, "b6-closeout-original-curator-cohort.json");
  if (existsSync(path)) return HindsightPolicyWorkKeySchema.array().length(4).parse(JSON.parse(readFileSync(path, "utf8")));
  const keys = runtime.db.prepare(`SELECT authority_epoch_id,bank_id,provider_lineage,bank_generation,work_id
    FROM hindsight_policy_work WHERE state IN ('ready','claimed','saved') ORDER BY created_at,work_id`).all().map((row) =>
    HindsightPolicyWorkKeySchema.parse({ authorityEpochId: row.authority_epoch_id, bankId: row.bank_id, workId: row.work_id,
      namespace: { provider_lineage: row.provider_lineage, bank_generation: row.bank_generation, application_id: "taki" } }));
  assert.equal(keys.length, 4, "B6_ORIGINAL_CURATOR_COHORT_CHANGED");
  for (const key of keys) assert.ok(readPolicyWork(runtime.db, key));
  writeFileSync(path, `${JSON.stringify(keys, null, 2)}\n`, { flag: "wx" });
  return keys;
}

function cohortState(runtime: AcceptanceRuntime, keys: readonly HindsightPolicyWorkKey[]) {
  return keys.map((key) => {
    const record = readPolicyWork(runtime.db, key); assert.ok(record, "B6_CURATOR_WORK_DISAPPEARED");
    let assessment: string | null = null;
    let attempts: number | null = null;
    let assessmentRetryAt: string | null = null;
    if (record.target.kind === "policy") {
      const body = bodyFor(runtime, key.bankId, "memory_unit", record.target.native.version.object_id).content;
      assert.equal(body.body_schema, "application-memory.v1");
      if (body.body_schema !== "application-memory.v1") throw new Error("B6_CURATOR_POLICY_BODY_MISSING");
      assessment = body.value.assessment.state; attempts = body.value.assessment.attempts;
      assessmentRetryAt = body.value.assessment.next_attempt_at;
    }
    return { key, kind: record.target.kind, state: record.state, claims: record.claims, workRevision: record.revision,
      resultKind: record.result?.kind ?? null, commandRequestId: record.commandRequestId,
      promptHash: record.prompt?.promptHash ?? null, nextAttemptAt: record.nextAttemptAt,
      lastFailure: record.lastFailure, assessment, attempts, assessmentRetryAt };
  });
}

function userBlocks(runtime: AcceptanceRuntime) {
  return runtime.db.prepare("SELECT * FROM taki_memory_blocks ORDER BY scope_kind,character_id,block_id").all()
    .filter((row) => getBlock(String(row.block_id))?.writer === "user");
}

function recovered(before: ReturnType<typeof cohortState>, current: ReturnType<typeof cohortState>) {
  return current.every((item, index) => {
    const prior = before[index]!;
    assert.deepEqual(item.key, prior.key); assert.equal(item.commandRequestId, prior.commandRequestId);
    const terminal = item.state === "completed" || item.state === "superseded";
    if (prior.state === "completed" || prior.state === "superseded") return terminal;
    const retry = (item.state === "ready" || item.state === "saved") && item.nextAttemptAt !== null && item.lastFailure !== null;
    return item.workRevision > prior.workRevision && item.claims > prior.claims && (terminal || retry);
  });
}

function completedPolicies(runtime: AcceptanceRuntime) {
  return runtime.db.prepare(`SELECT authority_epoch_id,bank_id,provider_lineage,bank_generation,work_id
    FROM hindsight_policy_work WHERE state='completed' AND work_kind='policy' ORDER BY created_at,work_id`).all().flatMap((row) => {
    const key = HindsightPolicyWorkKeySchema.parse({ authorityEpochId: row.authority_epoch_id, bankId: row.bank_id, workId: row.work_id,
      namespace: { provider_lineage: row.provider_lineage, bank_generation: row.bank_generation, application_id: "taki" } });
    const record = readPolicyWork(runtime.db, key); assert.ok(record);
    return record.result?.kind === "assessment" ? [record] : [];
  });
}

function newAssessmentProofs(runtime: AcceptanceRuntime, known: Set<string>) {
  return completedPolicies(runtime).filter((record) => !known.has(record.key.workId)).map((record) => {
    assert.equal(record.target.kind, "policy"); assert.equal(record.result?.kind, "assessment");
    if (record.target.kind !== "policy" || record.result?.kind !== "assessment") throw new Error("B6_CURATOR_RESULT_MISSING");
    const stored = bodyFor(runtime, record.key.bankId, "memory_unit", record.target.native.version.object_id);
    assert.deepEqual(stored.head.version, record.result.body.assessment.target);
    assert.equal(stored.content.body_schema, "application-memory.v1");
    if (stored.content.body_schema !== "application-memory.v1") throw new Error("B6_CURATOR_POLICY_BODY_MISSING");
    assert.deepEqual(stored.content.value, record.result.body, "B6_CURATOR_ASSESSMENT_NOT_APPLIED");
    return { workId: record.key.workId, commandRequestId: record.commandRequestId,
      native: stored.head.version, artifact: stored.head.bound_artifact, promptHash: record.result.prompt.promptHash };
  });
}

export async function verifyCuratorContinuation(input: {
  owner: Owner; options: AcceptanceRuntimeOptions; evidence: WriteEvidence;
}) {
  const keys = initialCohort(input.owner.current);
  const before = cohortState(input.owner.current, keys);
  const blocks = userBlocks(input.owner.current); const nativeDispatches = traffic.nativeDispatches;
  input.evidence("curator-before.json", { cohort: before, reportClassCap: 3,
    maxSteps: input.options.curatorMaxSteps ?? 4, timeoutMs: input.options.curatorTimeoutMs ?? 60000 });
  let current = before;
  const passes = [];
  const appliedAssessments: ReturnType<typeof newAssessmentProofs> = [];
  for (let pass = 1; pass <= 3; pass++) {
    const known = new Set(completedPolicies(input.owner.current).map((record) => record.key.workId));
    const started = performance.now();
    const outcome = await input.owner.current.subsystem.curator.runNow(input.owner.current.characterId);
    current = cohortState(input.owner.current, keys);
    const assessed = newAssessmentProofs(input.owner.current, known);
    assert.equal(assessed.length, outcome.assessed, "B6_CURATOR_ASSESSMENT_COUNT_WITHOUT_APPLIED_PROOF");
    appliedAssessments.push(...assessed);
    assert.deepEqual(userBlocks(input.owner.current), blocks, "B6_CURATOR_CHANGED_USER_BLOCK");
    assert.equal(traffic.nativeDispatches, nativeDispatches, "B6_CURATOR_DISPATCHED_NATIVE_MUTATION");
    const result = { pass, outcome, elapsedMs: Math.round(performance.now() - started), cohort: current, appliedAssessments: assessed };
    passes.push(result); input.evidence(`curator-pass-${pass}.json`, result);
    event("B6_CURATOR_CONTINUATION_PASS", { pass, status: outcome.status, assessed: outcome.assessed,
      pending: outcome.pending, originalWorkTerminal: current.filter((item) => item.state === "completed" || item.state === "superseded").length,
      originalPoliciesAssessed: current.filter((item) => item.assessment === "assessed").length });
    // Reopen before the next pass: persisted state, not a surviving promise,
    // must carry recovery. The production retry timestamps remain untouched.
    const { path, endpoint } = input.owner.current;
    await input.owner.current.close();
    input.owner.current = await openRuntime(path, endpoint, input.options);
    assert.deepEqual(cohortState(input.owner.current, keys), current, "B6_CURATOR_REOPEN_CHANGED_STATE");
    if (recovered(before, current) && appliedAssessments.length > 0) break;
    if (pass < 3) await delay(65_000, undefined, { signal: controller.signal });
  }
  const originalPoliciesAllAssessed = current.filter((item) => item.kind === "policy").every((item) => item.assessment === "assessed");
  const boundedContinuationPassed = recovered(before, current) && appliedAssessments.length > 0;
  const summary = { boundedContinuationPassed, originalWork: keys.length, originalWorkRecovered: recovered(before, current),
    originalPoliciesAssessed: current.filter((item) => item.assessment === "assessed").length,
    originalWorkTerminal: current.filter((item) => item.state === "completed" || item.state === "superseded").length,
    originalPoliciesAllAssessed, eventualCompletionProven: originalPoliciesAllAssessed
      && current.every((item) => item.state === "completed" || item.state === "superseded"),
    appliedAssessments, passes, userBlocksPreserved: true, nativeMutationDispatched: false, wholeLibraryReviewed: false };
  input.evidence("curator-summary.json", summary);
  assert.ok(summary.boundedContinuationPassed, "B6_CURATOR_BOUNDED_CONTINUATION_NOT_PROVEN");
  return summary;
}

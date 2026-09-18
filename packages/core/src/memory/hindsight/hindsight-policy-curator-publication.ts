/**
 * INPUT:  a claimed saved policy/Block result and the common durable application writer
 * OUTPUT: original-command recovery, verified replica refresh and truthful committed-effect counts
 * POS:    core/memory/hindsight — no model call or direct Block/replica write; delayed publication preserves proposals
 */
import type { TakiApplicationCommand } from "@taki/shared";
import { policyWorkClaim } from "../../db/hindsight-policy-work-repo.ts";
import { policyWorkValueHash, type HindsightPolicyWorkRecord } from "../../db/hindsight-policy-work-contract.ts";
import { prepareHindsightApplicationBody } from "./hindsight-application-body-transfer.ts";
import type { HindsightPolicyCuratorRun } from "./hindsight-policy-curator-context.ts";
import { assertCuratorWorkCurrent } from "./hindsight-policy-curator-targets.ts";
import { awaitCuratorWork } from "./hindsight-policy-curator-lifetime.ts";

export async function publishCuratorWork(run: HindsightPolicyCuratorRun, record: HindsightPolicyWorkRecord): Promise<void> {
  run.alive(); const result = record.result;
  if (!result) throw new Error("MEMORY_INTEGRITY_ERROR");
  const claim = policyWorkClaim(record);
  try {
    if (result.kind === "block-unchanged") {
      assertCuratorWorkCurrent(run, { scope: record.key, target: record.target, exactPolicy: false });
      run.deps.work.complete(claim); return;
    }
    const key = { authorityEpochId: record.key.authorityEpochId, bankId: record.key.bankId, requestId: record.commandRequestId };
    let job = run.deps.writer.get(key);
    if (!job || job.state === "prepared") {
      assertCuratorWorkCurrent(run, { scope: record.key, target: record.target, exactPolicy: false });
    }
    job ??= run.deps.writer.prepare({ key, namespace: record.key.namespace,
      intent: { kind: "hindsight-policy-work", workId: record.key.workId, resultHash: policyWorkValueHash(result) },
      create: () => commandPlan(record) });
    const remote = await awaitCuratorWork(run, () => run.deps.writer.run({ key, context: run.call() }));
    run.alive();
    if (remote.status === "pending") { deferPublication(run, record); return; }
    if (remote.status === "refused") {
      run.deps.work.supersede(claim); run.outcome.status = "failed"; return;
    }
    await awaitCuratorWork(run, () => run.deps.refreshBank(record.key.bankId, run.call()));
    run.alive();
    if (!run.deps.writer.applied(remote.job)) { deferPublication(run, record); return; }
    run.deps.work.complete(claim);
    if (result.kind === "assessment") { run.outcome.assessed++; run.outcome.edits++; }
    else if (result.kind === "block-update") { run.outcome.blocks++; run.outcome.edits++; }
    else run.outcome.status = "failed";
    if (run.outcome.status === "clean") run.outcome.status = "ran";
  } catch (error) {
    if (run.stopped()) return;
    const revisionConflict = error instanceof Error && error.message === "MEMORY_REVISION_MISMATCH";
    const prepared = run.deps.writer.get({ authorityEpochId: record.key.authorityEpochId,
      bankId: record.key.bankId, requestId: record.commandRequestId });
    // Only this owner resumes its outbox commands. A prepared command has not crossed the dispatch fence;
    // preserve its evidence while retiring stale work instead of repeatedly proposing it from changed inputs.
    if (revisionConflict && (!prepared || prepared.state === "prepared")) {
      run.deps.work.supersede(claim); run.outcome.status = "failed";
    } else deferPublication(run, record);
  }
}

function commandPlan(record: HindsightPolicyWorkRecord) {
  const result = record.result;
  if (!result || result.kind === "block-unchanged") throw new Error("MEMORY_INTEGRITY_ERROR");
  const body = prepareHindsightApplicationBody({ bankId: record.key.bankId, namespace: record.key.namespace,
    schema: result.kind === "block-update" ? "application-block.v1" : "application-memory.v1", value: result.body });
  const artifact = record.target.artifact;
  const expected = artifact ? { key: artifact.key, revision: artifact.revision, record_hash: artifact.record_hash } : null;
  const command: TakiApplicationCommand = { command: "put_artifact",
    key: artifact?.key ?? { artifact_kind: "block", artifact_id: record.target.kind === "block" ? record.target.blockId : "" },
    expected_artifact: expected, body_ref: body.ref,
    binding: record.target.kind === "policy" ? { kind: "exact_native", native: record.target.native.version } : { kind: "core_block" },
    expected_native: record.target.kind === "policy" ? record.target.native.version : null,
    actor: { kind: "background", actor_ref: "taki-policy-curator" } };
  return { commands: [command], bodies: [body] };
}
function deferPublication(run: HindsightPolicyCuratorRun, record: HindsightPolicyWorkRecord): void {
  if (run.stopped()) return;
  run.deps.work.defer({ claim: policyWorkClaim(record), failure: "publication_pending" });
  run.outcome.pending++; run.outcome.status = "failed";
}

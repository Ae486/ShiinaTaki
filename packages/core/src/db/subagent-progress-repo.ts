/**
 * INPUT: accepted work/user input and actual task-model intent/completed-step witnesses
 * OUTPUT: durable per-work intervals and unique completed counts across Runs and SDK segments
 * POS: core/db — progress facts; never counts Utility requests, tools or reconstructed transcripts
 */
import { SubagentWorkProgressSchema, type EffectLifecycle, type SubagentCheckInPolicy } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { readSubagentExecution, readSubagentInput } from "./subagent-readers.ts";
import { readRunById } from "./run-readers.ts";

export function createSubagentProgressRepo(db: Database) {
  return {
    get: (workInputId: string) => readSubagentProgress(db, workInputId),
    ensure(workInputId: string, policy: SubagentCheckInPolicy, tracking: "work_start" | "post_upgrade") {
      const root = readSubagentInput(db, workInputId);
      if (root.kind !== "work") throw new Error("SUBAGENT_WORK_MISMATCH");
      db.prepare(`INSERT OR IGNORE INTO subagent_work_progress(work_input_id,interval_steps,parent_approval_limit,tracking)
        VALUES(:work,:steps,:approvals,:tracking)`).run({ work: workInputId, steps: policy.steps, approvals: policy.parentApprovals, tracking });
      return readSubagentProgress(db, workInputId)!;
    },
    intent(input: { workInputId: string; stepNumber: number; effect: EffectLifecycle }) {
      const { effect } = input;
      const execution = readSubagentExecution(db, effect.runId);
      if (effect.kind !== "model" || effect.state !== "intent_committed" || effect.attemptId !== readRunById(db, effect.runId).activeAttemptId
        || input.workInputId !== execution.work_input_id) throw new Error("SUBAGENT_STEP_INTENT_MISMATCH");
      if (!readSubagentProgress(db, input.workInputId)) return;
      db.prepare(`INSERT INTO subagent_task_steps(model_effect_id,work_input_id,run_id,attempt_id,step_number)
        VALUES(:effect,:work,:run,:attempt,:step)`).run({ effect: effect.effectId, work: input.workInputId,
        run: effect.runId, attempt: effect.attemptId, step: input.stepNumber });
    },
    complete(input: { runId: string; attemptId: string; stepNumber: number; modelEffectId?: string }) {
      const row = db.prepare(`SELECT s.*,e.kind,e.state FROM subagent_task_steps s JOIN run_effects e ON e.effect_id=s.model_effect_id
        WHERE s.run_id=:run AND s.attempt_id=:attempt AND s.step_number=:step
        AND (:effect IS NULL OR s.model_effect_id=:effect) ORDER BY s.rowid DESC LIMIT 1`)
        .get({ run: input.runId, attempt: input.attemptId, step: input.stepNumber, effect: input.modelEffectId ?? null });
      if (!row) {
        const execution = readSubagentExecution(db, input.runId);
        if (readSubagentProgress(db, String(execution.work_input_id))) throw new Error("SUBAGENT_STEP_WITNESS_REQUIRED");
        return null;
      }
      if (row.kind !== "model" || row.state !== "terminal") throw new Error("SUBAGENT_STEP_INCOMPLETE_EFFECT");
      const work = String(row.work_input_id);
      if (row.completed_ordinal === null) {
        db.prepare("UPDATE subagent_work_progress SET completed_steps=completed_steps+1 WHERE work_input_id=:work").run({ work });
        db.prepare(`UPDATE subagent_task_steps SET completed_ordinal=(SELECT completed_steps FROM subagent_work_progress WHERE work_input_id=:work)
          WHERE model_effect_id=:effect`).run({ work, effect: String(row.model_effect_id) });
      }
      return readSubagentProgress(db, work);
    },
  };
}

export function readSubagentProgress(db: Database, workInputId: string) {
  const row = db.prepare("SELECT * FROM subagent_work_progress WHERE work_input_id=:work").get({ work: workInputId });
  return row ? SubagentWorkProgressSchema.parse({ workInputId, completedSteps: row.completed_steps,
    intervalStartSteps: row.interval_start_steps, intervalSteps: row.interval_steps, parentApprovalLimit: row.parent_approval_limit,
    consecutiveParentApprovals: row.consecutive_parent_approvals, tracking: row.tracking }) : null;
}

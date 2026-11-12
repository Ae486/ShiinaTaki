/**
 * INPUT: completed task-model frontier, canonical work progress and retained worker evidence
 * OUTPUT: one atomic factual progress event, input wait and typed check-in sidecar
 * POS: core/db — Runtime check-in acceptance; never fabricates a worker collector or synthesis call
 */
import { SubagentCheckInSchema } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { readSubagentProgress } from "./subagent-progress-repo.ts";
import { readSubagent, readSubagentInput } from "./subagent-readers.ts";
import { acceptSubagentEvent } from "./subagent-event-repo.ts";

export function acceptDueSubagentCheckIn(db: Database, workInputId: string): string | null {
  const progress = readSubagentProgress(db, workInputId);
  if (!progress || progress.completedSteps - progress.intervalStartSteps < progress.intervalSteps) return null;
  const root = readSubagentInput(db, workInputId);
  const child = readSubagent(db, root.subagentId);
  if (child.stopOrigin) return null;
  const wait = db.prepare("SELECT event_id FROM subagent_input_waits WHERE work_input_id=:work AND state='open'").get({ work: workInputId });
  if (wait) return null;
  const prior = db.prepare("SELECT event_id FROM subagent_checkins WHERE work_input_id=:work AND interval_start_steps=:start")
    .get({ work: workInputId, start: progress.intervalStartSteps });
  if (prior) return String(prior.event_id);
  const step = db.prepare(`SELECT * FROM subagent_task_steps WHERE work_input_id=:work AND completed_ordinal=:ordinal`)
    .get({ work: workInputId, ordinal: progress.completedSteps });
  if (!step) throw new Error("SUBAGENT_CHECKIN_WITNESS_REQUIRED");
  const { workInputId: omittedWork, tracking: omittedTracking, ...interval } = progress;
  void omittedWork; void omittedTracking;
  const sidecar = SubagentCheckInSchema.parse({ ...interval,
    requiredActor: progress.consecutiveParentApprovals >= progress.parentApprovalLimit ? "user" : "parent_or_user", reportKind: "core_snapshot" });
  const eventId = acceptSubagentEvent(db, { subagentId: child.subagentId, workInputId, kind: "needs_input",
    producerRunId: String(step.run_id), producerAttemptId: String(step.attempt_id), producerKey: `checkin:${progress.intervalStartSteps}`,
    body: progressSnapshot(db, { workInputId, label: child.label, completedSteps: progress.completedSteps, requiredActor: sidecar.requiredActor }),
    sourceContext: { generatedBy: { runId: String(step.run_id), attemptId: String(step.attempt_id), subagentId: child.subagentId } },
    suppressionReason: null });
  db.prepare("INSERT INTO subagent_input_waits(event_id,work_input_id,state) VALUES(:event,:work,'open')").run({ event: eventId, work: workInputId });
  db.prepare(`INSERT INTO subagent_checkins(event_id,work_input_id,interval_start_steps,completed_steps,model_effect_id,checkin_json)
    VALUES(:event,:work,:start,:completed,:effect,:json)`).run({ event: eventId, work: workInputId, start: progress.intervalStartSteps,
    completed: progress.completedSteps, effect: String(step.model_effect_id), json: JSON.stringify(sidecar) });
  return eventId;
}

function progressSnapshot(db: Database, input: { workInputId: string; label: string; completedSteps: number; requiredActor: string }): string {
  const params = { work: input.workInputId };
  const latest = db.prepare(`SELECT m.run_id,m.seq,m.content,m.parts_json FROM run_messages m JOIN subagent_executions e ON e.run_id=m.run_id
    WHERE e.work_input_id=:work AND m.role='assistant' AND m.entry_kind='output' AND length(m.content)>0
    AND (m.parts_json IS NULL OR EXISTS(SELECT 1 FROM json_each(m.parts_json) p WHERE json_extract(p.value,'$.type')='text'))
    ORDER BY m.seq DESC LIMIT 1`).get(params);
  const summary = db.prepare("SELECT summary_text,through_seq FROM subagent_context_summaries WHERE work_input_id=:work ORDER BY revision DESC LIMIT 1").get(params);
  const tools = db.prepare(`SELECT r.run_id,r.attempt_id,r.step_number,r.tool_call_id,r.tool_name,substr(r.output_json,1,400) AS preview
    FROM subagent_tool_results r JOIN subagent_executions e ON e.run_id=r.run_id WHERE e.work_input_id=:work ORDER BY r.rowid DESC LIMIT 4`).all(params);
  const pending = db.prepare("SELECT count(*) AS total FROM subagent_inputs WHERE work_input_id=:work AND consumed_run_id IS NULL").get(params);
  return JSON.stringify({ reportKind: "Core progress snapshot", label: input.label, completedModelSteps: input.completedSteps,
    latestWorkerText: latest ? { text: workerText(latest).slice(0, 3000), reference: `run:${String(latest.run_id)}:message:${String(latest.seq)}` } : null,
    olderTaskSummary: summary ? { text: String(summary.summary_text).slice(0, 2000), throughSeq: summary.through_seq } : null,
    recentToolEvidence: tools.map((tool) => ({ name: tool.tool_name, preview: tool.preview,
      reference: { runId: tool.run_id, attemptId: tool.attempt_id, stepNumber: tool.step_number, toolCallId: tool.tool_call_id } })),
    pendingInputs: Number(pending?.total ?? 0), remainingWork: "Not independently established by this factual snapshot; inspect worker evidence.",
    requiredActor: input.requiredActor, nextAction: "Explicitly continue or redirect this exact check-in event and work." });
}

function workerText(row: import("./sqlite.ts").SqlRow): string {
  if (row.parts_json === null) return String(row.content);
  const parts: Array<{ type: string; text?: string }> = JSON.parse(String(row.parts_json));
  return parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
}

/**
 * INPUT: accepted exact child input, authenticated sender and captured next-interval policy
 * OUTPUT: check-in authority validation, interval continuation and trusted user reset facts
 * POS: core/db — synchronous participant in input acceptance; ordinary messages never resolve a check-in
 */
import { SubagentCheckInSchema, type SubagentInputRequest, type SubagentCheckInPolicy } from "@taki/shared";
import type { Database } from "./sqlite.ts";

export function validateCheckInInput(db: Database, request: SubagentInputRequest): boolean {
  if (request.input.kind === "work" || !request.input.replyToEventId) return false;
  const row = db.prepare(`SELECT c.checkin_json FROM subagent_checkins c JOIN subagent_input_waits w USING(event_id)
    WHERE c.event_id=:event AND c.work_input_id=:work AND w.state='open'`)
    .get({ event: request.input.replyToEventId, work: request.input.workInputId });
  if (!row) return false;
  if (request.input.kind !== "continue") throw new Error("SUBAGENT_CHECKIN_CONTINUE_REQUIRED");
  if (request.sender.kind === "core") throw new Error("SUBAGENT_CHECKIN_AUTHORITY_REQUIRED");
  const checkIn = SubagentCheckInSchema.parse(JSON.parse(String(row.checkin_json)));
  if (checkIn.requiredActor === "user" && request.sender.kind !== "user") throw new Error("SUBAGENT_CHECKIN_USER_REQUIRED");
  return true;
}

export function applyCheckInInput(db: Database, input: {
  request: SubagentInputRequest; inputId: string; checkIn: boolean; policy: SubagentCheckInPolicy;
}): void {
  const { request } = input;
  if (request.input.kind === "work") return;
  const work = request.input.workInputId;
  if (request.sender.kind === "user") {
    db.prepare(`UPDATE subagent_work_progress SET consecutive_parent_approvals=0,last_user_input_id=:input WHERE work_input_id=:work`)
      .run({ work, input: input.inputId });
    db.prepare(`UPDATE subagent_user_attention SET resolved_input_id=:input WHERE resolved_input_id IS NULL
      AND event_id IN (SELECT e.event_id FROM subagent_events e WHERE e.work_input_id=:work
      AND (e.event_id=:reply OR NOT EXISTS(SELECT 1 FROM subagent_input_waits w WHERE w.event_id=e.event_id AND w.state='open')))`)
      .run({ work, input: input.inputId, reply: request.input.replyToEventId ?? null });
  }
  if (!input.checkIn) return;
  db.prepare(`UPDATE subagent_work_progress SET interval_start_steps=completed_steps,interval_steps=:steps,parent_approval_limit=:limit,
    consecutive_parent_approvals=consecutive_parent_approvals+:increment WHERE work_input_id=:work`)
    .run({ work, steps: input.policy.steps, limit: input.policy.parentApprovals, increment: request.sender.kind === "parent" ? 1 : 0 });
}

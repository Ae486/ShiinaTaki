/**
 * INPUT: completed private collector witnesses and canonical Run terminal facts
 * OUTPUT: immutable ordered events and exact durable input dependencies
 * POS: core/db — acceptance owner; dispatch, publication and model delivery are separate
 */
import { randomUUID } from "node:crypto";
import { SubagentEventSchema, SubagentInputWaitSchema, type SourceContext, type SubagentWorkToken } from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";
import { digestRunValue } from "./run-row-mappers.ts";
import { latestWorkSeq, readSubagent, readSubagentExecution } from "./subagent-readers.ts";
import { readRunById } from "./run-readers.ts";

export interface AcceptedSubagentEvent {
  throughWorkSeq?: number;
  eventId?: string; subagentId: string; workInputId: string; kind: "message" | "needs_input" | "final" | "interrupted";
  producerRunId: string; producerAttemptId: string; producerKey: string; body: string | null;
  sourceContext: SourceContext; suppressionReason: string | null; acceptedAt?: string;
}

export function acceptSubagentEvent(db: Database, input: AcceptedSubagentEvent): string {
  let id = "";
  db.transaction(() => { id = acceptEvent(db, input); });
  return id;
}

function acceptEvent(db: Database, input: AcceptedSubagentEvent): string {
  const previous = db.prepare(`SELECT event_id,body_digest FROM subagent_events
    WHERE producer_run_id=:run AND producer_attempt_id=:attempt AND producer_key=:key`)
    .get({ run: input.producerRunId, attempt: input.producerAttemptId, key: input.producerKey });
  const digest = digestRunValue({ body: input.body, sourceContext: input.sourceContext, kind: input.kind });
  if (previous) {
    if (previous.body_digest !== digest) throw new Error("SUBAGENT_EVENT_CONFLICT");
    return String(previous.event_id);
  }
  const eventId = input.eventId ?? randomUUID();
  db.prepare(`INSERT INTO subagent_events(event_id,character_id,subagent_id,work_input_id,kind,producer_run_id,
    producer_attempt_id,producer_key,body,body_digest,source_context_json,eligible,suppression_reason,accepted_at)
    VALUES(:id,:character,:child,:work,:kind,:run,:attempt,:key,:body,:digest,:source,:eligible,:reason,:at)`)
    .run({ id: eventId, character: readSubagent(db, input.subagentId).characterId, child: input.subagentId,
      work: input.workInputId, kind: input.kind, run: input.producerRunId, attempt: input.producerAttemptId,
      key: input.producerKey, body: input.body, digest, source: JSON.stringify(input.sourceContext),
      eligible: input.suppressionReason === null ? 1 : 0, reason: input.suppressionReason,
      at: input.acceptedAt ?? new Date().toISOString() });
  const execution = readSubagentExecution(db, input.producerRunId);
  if (execution.subagent_id !== input.subagentId || execution.work_input_id !== input.workInputId) throw new Error("SUBAGENT_EVENT_SCOPE_MISMATCH");
  db.prepare("INSERT INTO subagent_event_frontiers(event_id,through_work_seq) VALUES(:id,:through)")
    .run({ id: eventId, through: input.throughWorkSeq ?? Number(execution.through_work_seq) });
  return eventId;
}

export function createSubagentEventRepo(db: Database) {
  return {
    get: (eventId: string) => readSubagentEvent(db, eventId),
    list(input: { characterId: string; afterSeq?: number; limit?: number }) {
      return db.prepare(`SELECT event_id FROM subagent_events WHERE character_id=:character AND seq>:after
        ORDER BY seq LIMIT :limit`).all({ character: input.characterId, after: input.afterSeq ?? 0,
        limit: Math.max(1, Math.min(input.limit ?? 50, 100)) }).map((row) => readSubagentEvent(db, String(row.event_id)));
    },
    wait(workInputId: string) {
      const row = db.prepare("SELECT * FROM subagent_input_waits WHERE work_input_id=:work ORDER BY rowid DESC LIMIT 1").get({ work: workInputId });
      return row ? SubagentInputWaitSchema.parse({ eventId: row.event_id, workInputId: row.work_input_id,
        state: row.state, answerInputId: row.answer_input_id }) : null;
    },
    acceptInteraction(input: { runId: string; attemptId: string; token: SubagentWorkToken; stepNumber: number;
      toolCallId: string; kind: "message" | "needs_input"; text: string }): string | undefined {
      let eventId: string | undefined;
      db.transaction(() => {
        const row = readSubagentExecution(db, input.runId);
        const run = readRunById(db, input.runId);
        const child = readSubagent(db, input.token.subagentId);
        if (run.activeAttemptId !== input.attemptId || run.state !== "running" || child.stopOrigin
          || digestRunValue(input.token) !== digestRunValue(JSON.parse(String(row.work_token_json)))) return;
        // A newly queued correction must be consumed before the child can enter a terminal wait.
        if (input.kind === "needs_input" && latestWorkSeq(db, input.token.workInputId) !== input.token.throughWorkSeq) return;
        const completed = db.prepare(`SELECT parts_json FROM run_messages WHERE run_id=:run AND attempt_id=:attempt
          AND step_number=:step AND entry_kind='output' AND role='tool'`).all({ run: input.runId, attempt: input.attemptId, step: input.stepNumber });
        if (!completed.some((part) => matchingResult(part, input.toolCallId))) throw new Error("SUBAGENT_INTERACTION_WITNESS_REQUIRED");
        eventId = acceptSubagentEvent(db, { subagentId: child.subagentId, workInputId: input.token.workInputId,
          kind: input.kind, producerRunId: input.runId, producerAttemptId: input.attemptId,
          throughWorkSeq: input.token.throughWorkSeq,
          producerKey: `interaction:${input.stepNumber}:${input.toolCallId}`, body: input.text,
          sourceContext: { generatedBy: { runId: input.runId, attemptId: input.attemptId, subagentId: child.subagentId } },
          suppressionReason: row.completion_policy === "record_only" ? "record_only" : null });
        if (input.kind === "needs_input") db.prepare(`INSERT OR IGNORE INTO subagent_input_waits(event_id,work_input_id,state)
          VALUES(:event,:work,'open')`).run({ event: eventId, work: input.token.workInputId });
      });
      return eventId;
    },
  };
}

function matchingResult(row: SqlRow, toolCallId: string): boolean {
  if (row.parts_json === null) return false;
  const parts: unknown = JSON.parse(String(row.parts_json));
  return Array.isArray(parts) && parts.some((part: unknown) => typeof part === "object" && part !== null
    && "type" in part && part.type === "tool-result" && "toolCallId" in part && part.toolCallId === toolCallId
    && "toolName" in part && part.toolName === "interact_parent");
}

export function readSubagentEvent(db: Database, eventId: string) {
  const row = db.prepare(`SELECT e.*,EXISTS(SELECT 1 FROM subagent_event_actions a WHERE a.event_id=e.event_id) AS handled,
    EXISTS(SELECT 1 FROM subagent_inbox_members m JOIN subagent_inbox_deliveries d USING(consumer_id) WHERE m.event_id=e.event_id) AS delivered,
    EXISTS(SELECT 1 FROM subagent_inbox_members m JOIN subagent_inbox_consumers c USING(consumer_id)
      WHERE m.event_id=e.event_id AND c.state='reconciliation_needed') AS reconcile
    FROM subagent_events e WHERE event_id=:id`).get({ id: eventId });
  if (!row) throw new Error("SUBAGENT_EVENT_NOT_FOUND");
  return SubagentEventSchema.parse({ eventId: row.event_id, seq: row.seq, characterId: row.character_id,
    subagentId: row.subagent_id, workInputId: row.work_input_id, kind: row.kind, producerRunId: row.producer_run_id,
    producerAttemptId: row.producer_attempt_id, producerKey: row.producer_key, body: row.body,
    bodyDigest: row.body_digest, sourceContext: JSON.parse(String(row.source_context_json)), acceptedAt: row.accepted_at,
    throughWorkSeq: db.prepare("SELECT through_work_seq FROM subagent_event_frontiers WHERE event_id=:id").get({ id: eventId })?.through_work_seq ?? null,
    eligible: row.eligible === 1, suppressionReason: row.suppression_reason,
    state: row.handled === 1 ? "handled" : row.delivered === 1 ? "delivered" : "accepted",
    reconciliationNeeded: row.handled !== 1 && row.reconcile === 1 });
}
export type SubagentEventRepo = ReturnType<typeof createSubagentEventRepo>;

/**
 * INPUT: explicit authenticated recovery target and fresh linked Run admission
 * OUTPUT: atomic successor association and inspectable original action evidence
 * POS: core/db — private reconciliation lineage; original intent/action rows and grants never move
 */
import type { Database } from "./sqlite.ts";
import type { RunLinkedAdmission, RunLinkedState } from "./run-linked-state.ts";
import { readRunById } from "./run-readers.ts";
import { createSubagentInboxRepo } from "./subagent-inbox-repo.ts";
import { digestRunValue } from "./run-row-mappers.ts";

export function assertSubagentInboxResumable(db: Database, input: { characterId: string; consumerId: string }): void {
  const consumer = db.prepare("SELECT * FROM subagent_inbox_consumers WHERE consumer_id=:id AND character_id=:character")
    .get({ id: input.consumerId, character: input.characterId });
  if (!consumer || consumer.state !== "reconciliation_needed") throw new Error("SUBAGENT_INBOX_RECONCILIATION_REQUIRED");
  const run = readRunById(db, String(consumer.run_id));
  if (["queued", "running", "waiting", "recovering", "cancel_requested"].includes(run.state)) throw new Error("SUBAGENT_INBOX_NOT_QUIESCENT");
  if (db.prepare(`SELECT 1 FROM run_effects WHERE run_id=:run AND kind<>'model'
    AND (state<>'terminal' OR outcome='outcome_unknown') LIMIT 1`).get({ run: run.runId })) throw new Error("SUBAGENT_INBOX_UNCERTAIN_EFFECT");
  if (db.prepare(`WITH RECURSIVE successors(id) AS (
    SELECT consumer_id FROM subagent_inbox_resumes WHERE previous_consumer_id=:id
    UNION ALL SELECT r.consumer_id FROM subagent_inbox_resumes r JOIN successors s ON r.previous_consumer_id=s.id)
    SELECT 1 FROM subagent_inbox_consumers c JOIN successors s ON c.consumer_id=s.id WHERE c.state<>'released' LIMIT 1`)
    .get({ id: input.consumerId })) throw new Error("SUBAGENT_INBOX_ALREADY_RESUMING");
}

export function linkSubagentInboxResume(db: Database, input: Parameters<RunLinkedState["onAdmitTx"]>[0],
  link: Extract<RunLinkedAdmission, { kind: "agent-inbox" }>): void {
  const previous = db.prepare(`SELECT c.run_id FROM subagent_inbox_resumes r JOIN subagent_inbox_consumers c USING(consumer_id)
    WHERE r.previous_consumer_id=:id AND r.operation_key=:key`).get({ id: link.resumesConsumerId, key: link.operationKey });
  if (previous) {
    if (previous.run_id !== input.run.runId) throw new Error("SUBAGENT_INBOX_RESUME_CONFLICT");
    return;
  }
  link.validateTx();
  assertSubagentInboxResumable(db, { characterId: input.run.characterId, consumerId: link.resumesConsumerId });
  const prior = createSubagentInboxRepo(db).get(link.resumesConsumerId);
  const receipts = readActionReceipts(db, link.resumesConsumerId);
  const instructions = "Core private worker inbox. This is an explicit reconciliation of the same event batch. Prior accepted actions are historical facts; "
    + "do not repeat them. Handle only missing dispositions. No previous speech or source grant is restored.\n"
    + "Use read_agent_inbox detail=action for complete prior action/result pages, detail=event for the report.\n"
    + JSON.stringify({ events: prior.events.map((event) => ({ eventId: event.eventId, subagentId: event.subagentId,
      workInputId: event.workInputId, kind: event.kind, state: event.state })),
    actions: receipts.map((receipt) => ({ ...receipt, result: receipt.result.slice(0, 200), resultComplete: receipt.resultComplete && receipt.result.length <= 200 })) });
  db.prepare(`INSERT INTO subagent_inbox_consumers(consumer_id,character_id,run_id,attempt_id,mode,state,projection_json,projection_digest,created_at)
    VALUES(:id,:character,:run,:attempt,'idle','claimed',:projection,:digest,:at)`).run({ id: link.consumerId,
    character: input.run.characterId, run: input.run.runId, attempt: input.attempt.attemptId,
    projection: JSON.stringify({ instructions }), digest: digestRunValue(instructions), at: new Date().toISOString() });
  db.prepare(`INSERT INTO subagent_inbox_members(consumer_id,event_id,event_digest)
    SELECT :id,event_id,event_digest FROM subagent_inbox_members WHERE consumer_id=:previous`)
    .run({ id: link.consumerId, previous: link.resumesConsumerId });
  db.prepare("INSERT INTO subagent_inbox_resumes(previous_consumer_id,operation_key,consumer_id) VALUES(:previous,:key,:id)")
    .run({ previous: link.resumesConsumerId, key: link.operationKey, id: link.consumerId });
}

export function readSubagentInboxRecovery(db: Database, input: { characterId: string; afterId?: string; limit: number }) {
  const rows = db.prepare(`SELECT c.* FROM subagent_inbox_consumers c WHERE character_id=:character
    AND state='reconciliation_needed' AND (:after IS NULL OR consumer_id>:after) ORDER BY consumer_id LIMIT :limit`)
    .all({ character: input.characterId, after: input.afterId ?? null, limit: input.limit + 1 });
  const entries = rows.slice(0, input.limit).map((row) => {
    const consumerId = String(row.consumer_id); let reason = "missing_disposition";
    try { assertSubagentInboxResumable(db, { characterId: input.characterId, consumerId }); }
    catch (error) { reason = error instanceof Error ? error.message : "SUBAGENT_INBOX_UNAVAILABLE"; }
    return { consumerId, runId: String(row.run_id), reason, canResume: reason === "missing_disposition",
      events: createSubagentInboxRepo(db).get(consumerId).events.map((event) => ({ eventId: event.eventId, kind: event.kind, state: event.state })),
      actions: readActionReceipts(db, consumerId) };
  });
  return { entries, nextCursor: rows.length > input.limit ? entries.at(-1)?.consumerId ?? null : null };
}

function readActionReceipts(db: Database, consumerId: string) {
  return db.prepare(`SELECT a.event_id,a.operation_key,a.action_json,a.result_json FROM subagent_event_actions a
    JOIN subagent_inbox_members m USING(event_id) WHERE m.consumer_id=:id ORDER BY a.created_at`)
    .all({ id: consumerId }).map((row) => ({ eventId: String(row.event_id), operationKey: String(row.operation_key),
      kind: String((JSON.parse(String(row.action_json)) as { kind: string }).kind),
      result: String(row.result_json).slice(0, 2000), resultComplete: String(row.result_json).length <= 2000 }));
}

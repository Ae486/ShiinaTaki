/**
 * INPUT: canonical main-consumer Run terminal fact in the Run transaction
 * OUTPUT: atomic private tail and explicit reconciliation or safe pre-intent release
 * POS: core/db — settlement participant for genuine primary and idle inbox associations
 */
import { RunMessageBatchSchema } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import type { RunTerminalFact } from "./run-linked-state.ts";
import { appendRunMessageBatch } from "./run-message-repo.ts";

export function settleSubagentInboxTerminal(db: Database, fact: RunTerminalFact): void {
  const consumer = db.prepare("SELECT * FROM subagent_inbox_consumers WHERE run_id=:run AND attempt_id=:attempt")
    .get({ run: fact.run.runId, attempt: fact.attempt.attemptId });
  if (!consumer || consumer.settled_at !== null) return;
  const id = String(consumer.consumer_id);
  if (consumer.terminal_messages_json !== null) appendRunMessageBatch(db, { runId: fact.run.runId, attemptId: fact.attempt.attemptId,
    batch: RunMessageBatchSchema.parse(JSON.parse(String(consumer.terminal_messages_json))) });
  const delivered = db.prepare("SELECT 1 FROM subagent_inbox_deliveries WHERE consumer_id=:id LIMIT 1").get({ id });
  const outstanding = db.prepare(`SELECT 1 FROM subagent_inbox_members m WHERE consumer_id=:id
    AND NOT EXISTS(SELECT 1 FROM subagent_event_actions a WHERE a.event_id=m.event_id) LIMIT 1`).get({ id });
  db.prepare("UPDATE subagent_inbox_consumers SET state=:state,settled_at=:at WHERE consumer_id=:id")
    .run({ id, state: !delivered ? "released" : outstanding ? "reconciliation_needed" : "settled", at: fact.at });
}

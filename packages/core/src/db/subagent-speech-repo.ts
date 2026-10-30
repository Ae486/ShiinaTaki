/**
 * INPUT: immutable delivered speech proposal action and the separate publication owner's outcome
 * OUTPUT: exact proposal readback and durable publication status without changing handled evidence
 * POS: core/db — delegation/publication join; no grants are reconstructed from stored rows
 */
import { PreparedPublicationResultSchema, SubagentInboxActionSchema, type PreparedPublicationResult } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { readSubagentEvent } from "./subagent-event-repo.ts";
import { digestRunValue } from "./run-row-mappers.ts";
import type { TimelineEntry } from "@taki/shared";

export function readSubagentSpeechProposal(db: Database, input: { eventId: string; consumerRunId: string; actionId: string }) {
  const row = db.prepare(`SELECT a.*,c.run_id,c.attempt_id FROM subagent_event_actions a
    JOIN subagent_inbox_consumers c USING(consumer_id)
    JOIN subagent_inbox_members m ON m.consumer_id=a.consumer_id AND m.event_id=a.event_id
    JOIN subagent_inbox_deliveries d ON d.consumer_id=a.consumer_id AND d.model_effect_id=a.model_effect_id
    JOIN subagent_events e ON e.event_id=a.event_id AND e.body_digest=m.event_digest
    WHERE a.event_id=:event AND a.operation_key=:action AND c.run_id=:run`)
    .get({ event: input.eventId, action: input.actionId, run: input.consumerRunId });
  if (!row) throw new Error("SUBAGENT_SPEECH_PROPOSAL_NOT_FOUND");
  const action = SubagentInboxActionSchema.parse(JSON.parse(String(row.action_json)));
  if (action.kind !== "speech_proposed") throw new Error("SUBAGENT_SPEECH_PROPOSAL_NOT_FOUND");
  const event = readSubagentEvent(db, input.eventId);
  if (event.throughWorkSeq === null) throw new Error("SUBAGENT_SPEECH_FRONTIER_UNAVAILABLE");
  return { event, throughWorkSeq: event.throughWorkSeq, consumerRunId: String(row.run_id),
    consumerAttemptId: String(row.attempt_id), actionId: String(row.operation_key), actionDigest: String(row.action_digest),
    text: action.note, createdAt: String(row.created_at) };
}

export function readSubagentSpeechPublication(db: Database, input: { eventId: string; actionId: string }): PreparedPublicationResult | null {
  const row = db.prepare("SELECT result_json FROM subagent_speech_publications WHERE event_id=:event AND action_id=:action")
    .get({ event: input.eventId, action: input.actionId });
  if (!row) return null;
  const result = PreparedPublicationResultSchema.parse(JSON.parse(String(row.result_json)));
  if (result.status !== "recorded") return result;
  const delivery = db.prepare("SELECT state FROM run_deliveries WHERE delivery_id=:delivery AND run_id=:run")
    .get({ delivery: result.deliveryId, run: result.runId });
  return delivery ? PreparedPublicationResultSchema.parse({ ...result, state: delivery.state }) : result;
}

export function recordSubagentSpeechPublication(db: Database, input: { eventId: string; actionId: string; result: PreparedPublicationResult }): void {
  const result = PreparedPublicationResultSchema.parse(input.result);
  const action = db.prepare("SELECT operation_key FROM subagent_event_actions WHERE event_id=:event").get({ event: input.eventId });
  if (action?.operation_key !== input.actionId) throw new Error("SUBAGENT_SPEECH_PROPOSAL_NOT_FOUND");
  const previous = readSubagentSpeechPublication(db, input);
  if (previous?.status === "refused") {
    if (JSON.stringify(previous) !== JSON.stringify(result)) throw new Error("SUBAGENT_PUBLICATION_CONFLICT");
    return;
  }
  if (previous?.status === "recorded") {
    if (result.status !== "recorded" || previous.runId !== result.runId || previous.deliveryId !== result.deliveryId
      || previous.state !== result.state) throw new Error("SUBAGENT_PUBLICATION_CONFLICT");
    return;
  }
  db.prepare(`INSERT INTO subagent_speech_publications(event_id,action_id,result_json) VALUES(:event,:action,:result)
    ON CONFLICT(event_id) DO UPDATE SET result_json=excluded.result_json`)
    .run({ event: input.eventId, action: input.actionId, result: JSON.stringify(result) });
}

export function recordSubagentPrimarySpeech(db: Database, input: { consumerId: string; entries: readonly TimelineEntry[] }): void {
  db.transaction(() => {
    const consumer = db.prepare(`SELECT c.character_id FROM subagent_inbox_consumers c
      WHERE consumer_id=:id AND mode='foreground' AND EXISTS(SELECT 1 FROM subagent_inbox_deliveries d WHERE d.consumer_id=c.consumer_id)`)
      .get({ id: input.consumerId });
    if (!consumer) throw new Error("SUBAGENT_EVENT_NOT_DELIVERED");
    const references = new Set(db.prepare(`SELECT e.event_id,e.body_digest FROM subagent_inbox_members m
      JOIN subagent_events e USING(event_id) WHERE m.consumer_id=:id`).all({ id: input.consumerId })
      .map((row) => `agent-event:${String(row.event_id)}#${String(row.body_digest)}`));
    for (const entry of input.entries) {
      if (entry.role !== "assistant" || !entry.content.trim()) continue;
      if (!entry.sourceContext?.materials?.some((source) => source.reference && references.has(source.reference))) continue;
      const stored = db.prepare("SELECT character_id,role,content,source_context_json FROM timeline_messages WHERE id=:id").get({ id: entry.id });
      if (stored?.character_id !== consumer.character_id || stored?.role !== "assistant" || stored?.content !== entry.content
        || digestRunValue(stored.source_context_json ? JSON.parse(String(stored.source_context_json)) : null) !== digestRunValue(entry.sourceContext)) {
        throw new Error("SUBAGENT_PUBLIC_TEXT_WITNESS_MISMATCH");
      }
      db.prepare("INSERT OR IGNORE INTO subagent_primary_speech(consumer_id,timeline_id,text_digest) VALUES(:consumer,:row,:digest)")
        .run({ consumer: input.consumerId, row: entry.id, digest: digestRunValue(entry.content) });
    }
  });
}

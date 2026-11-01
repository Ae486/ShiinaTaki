/**
 * INPUT: durable unresolved user escalations, exact user-required waits and reconciliation consumers
 * OUTPUT: bounded stable operator attention page with explicit recovery eligibility
 * POS: core/db — Home runtime observation; reads never resolve or replay work
 */
import { SubagentAttentionResultSchema } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { assertSubagentInboxResumable } from "./subagent-inbox-recovery-repo.ts";

export function readSubagentAttention(db: Database, input: { characterId: string; afterId?: string; limit: number }) {
  const rows = db.prepare(`WITH attention AS (
    SELECT 'retry:'||e.event_id AS attention_id,'inbox_retry_exhausted' AS kind,e.subagent_id,e.work_input_id,e.event_id,NULL AS consumer_id,
      'Automatic pre-intent retries were exhausted. Retry inbox handling with fresh authority.' AS reason
    FROM subagent_inbox_retry_failures r JOIN subagent_events e ON e.character_id=r.character_id
    WHERE r.character_id=:character AND e.seq=(SELECT min(p.seq) FROM subagent_events p WHERE p.character_id=:character AND p.eligible=1
      AND NOT EXISTS(SELECT 1 FROM subagent_event_actions a WHERE a.event_id=p.event_id)
      AND NOT EXISTS(SELECT 1 FROM subagent_inbox_members m JOIN subagent_inbox_consumers c USING(consumer_id) WHERE m.event_id=p.event_id AND c.state<>'released'))
    UNION ALL
    SELECT 'event:'||a.event_id,'needs_user_input',e.subagent_id,e.work_input_id,e.event_id,NULL,
      substr(json_extract(x.action_json,'$.note'),1,2000) AS reason
    FROM subagent_user_attention a JOIN subagent_events e USING(event_id) JOIN subagent_event_actions x USING(event_id)
    WHERE a.resolved_input_id IS NULL AND e.character_id=:character
    UNION ALL
    SELECT 'checkin:'||c.event_id,'check_in_user',e.subagent_id,e.work_input_id,e.event_id,NULL,'Direct user continuation is required for this check-in.'
    FROM subagent_checkins c JOIN subagent_input_waits w USING(event_id) JOIN subagent_events e USING(event_id)
    WHERE w.state='open' AND json_extract(c.checkin_json,'$.requiredActor')='user' AND e.character_id=:character
    UNION ALL
    SELECT 'consumer:'||c.consumer_id||':'||e.event_id,'reconciliation_needed',e.subagent_id,e.work_input_id,e.event_id,c.consumer_id,'missing_disposition'
    FROM subagent_inbox_consumers c JOIN subagent_inbox_members m USING(consumer_id) JOIN subagent_events e USING(event_id)
    WHERE c.state='reconciliation_needed' AND c.character_id=:character
      AND NOT EXISTS(SELECT 1 FROM subagent_event_actions a WHERE a.event_id=e.event_id)
      AND NOT EXISTS(SELECT 1 FROM subagent_inbox_resumes r JOIN subagent_inbox_consumers n ON n.consumer_id=r.consumer_id
        WHERE r.previous_consumer_id=c.consumer_id AND n.state<>'released')
  ) SELECT a.*,s.label,s.stop_origin FROM attention a JOIN subagent_conversations s USING(subagent_id)
    WHERE (:after IS NULL OR attention_id>:after) ORDER BY attention_id LIMIT :limit`)
    .all({ character: input.characterId, after: input.afterId ?? null, limit: input.limit + 1 });
  const entries = rows.slice(0, input.limit).map((row) => {
    let reason = String(row.reason ?? "User attention required");
    let canResume = row.kind === "reconciliation_needed" || row.kind === "inbox_retry_exhausted";
    if (row.kind === "reconciliation_needed") {
      try { assertSubagentInboxResumable(db, { characterId: input.characterId, consumerId: String(row.consumer_id) }); }
      catch (error) { canResume = false; reason = error instanceof Error ? error.message : "SUBAGENT_INBOX_UNAVAILABLE"; }
    }
    return { attentionId: String(row.attention_id), kind: row.kind, subagentId: row.subagent_id, workInputId: row.work_input_id,
      label: row.label, eventId: row.event_id, consumerId: row.consumer_id, reason, canResume };
  });
  return SubagentAttentionResultSchema.parse({ entries, nextCursor: rows.length > input.limit ? entries.at(-1)?.attentionId ?? null : null });
}

/**
 * INPUT: durable maintenance operations, auxiliary usage and old all-call cache baselines
 * OUTPUT: optional proved call association and regular-call summary-window baselines
 * POS: core/db/migrations — additive observation metadata; original usage and execution records stay intact
 */
import type { Migration } from "../migration-runner.ts";

export const maintenanceMonitorMigration068: Migration = { version: 68, sql: `
ALTER TABLE auxiliary_model_calls ADD COLUMN operation_json TEXT;
CREATE INDEX auxiliary_model_calls_operation ON auxiliary_model_calls
 (json_extract(operation_json,'$.kind'),json_extract(operation_json,'$.operationId'),
  json_extract(operation_json,'$.characterId'),started_at,call_id);
ALTER TABLE cache_usage_baselines ADD COLUMN population TEXT;
INSERT INTO cache_usage_baselines
 (character_id,summary_revision,operation_id,summary_committed_at,boundary,observed_requests,paired_requests,input_tokens,cache_read_tokens,population)
WITH observations AS (
 SELECT recorded_at AS settled_at,input_tokens,cache_read_tokens,
  CASE WHEN (cache_read_observed=1 OR (cache_read_observed IS NULL AND cache_read_tokens>0))
   AND typeof(input_tokens)='integer' AND input_tokens>0 AND input_tokens<=9007199254740991
   AND typeof(cache_read_tokens)='integer' AND cache_read_tokens>=0 AND cache_read_tokens<=input_tokens THEN 1 ELSE 0 END AS paired
 FROM run_usage UNION ALL
 SELECT finished_at,input_tokens,cache_read_tokens,
  CASE WHEN typeof(input_tokens)='integer' AND input_tokens>0 AND input_tokens<=9007199254740991
   AND typeof(cache_read_tokens)='integer' AND cache_read_tokens>=0 AND cache_read_tokens<=input_tokens THEN 1 ELSE 0 END
 FROM auxiliary_model_calls WHERE status<>'started' AND NOT(source='utility' AND label IN ('tidy','compact'))
), boundaries AS (
 SELECT s.* FROM conversation_summary s JOIN conversation_compaction_operations o
 ON o.operation_id=s.last_operation_id AND o.character_id=s.character_id
  AND o.state='committed' AND o.committed_summary_revision=s.revision
 WHERE julianday(s.updated_at) IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM observations u WHERE julianday(u.settled_at) IS NULL
    OR julianday(u.settled_at)=julianday(s.updated_at))
)
SELECT s.character_id,s.revision,s.last_operation_id,s.updated_at,'historical',
 COUNT(u.settled_at),COALESCE(SUM(u.paired),0),
 TOTAL(CASE WHEN u.paired=1 THEN u.input_tokens ELSE 0 END),
 TOTAL(CASE WHEN u.paired=1 THEN u.cache_read_tokens ELSE 0 END),'regular-model-requests'
FROM boundaries s LEFT JOIN observations u ON julianday(u.settled_at)<julianday(s.updated_at)
GROUP BY s.character_id HAVING TOTAL(CASE WHEN u.paired=1 THEN u.input_tokens ELSE 0 END)<=9007199254740991
ON CONFLICT(character_id) DO UPDATE SET summary_revision=excluded.summary_revision,operation_id=excluded.operation_id,
 summary_committed_at=excluded.summary_committed_at,boundary=excluded.boundary,observed_requests=excluded.observed_requests,
 paired_requests=excluded.paired_requests,input_tokens=excluded.input_tokens,cache_read_tokens=excluded.cache_read_tokens,
 population=excluded.population;
` };

/**
 * INPUT:  immutable Run usage and terminal auxiliary calls after migration 065
 * OUTPUT: nullable cache provenance and summary-bound aggregate baselines with conservative historical seeds
 * POS:    core/db/migrations — additive metric metadata; never changes summaries or original usage
 */
import type { Migration } from "../migration-runner.ts";

export const cacheUsageWindowMigration066: Migration = { version: 66, sql: `
ALTER TABLE run_usage ADD COLUMN cache_read_observed INTEGER CHECK(cache_read_observed IN (0,1));
CREATE TABLE cache_usage_baselines (
 character_id TEXT PRIMARY KEY,
 summary_revision INTEGER NOT NULL CHECK(summary_revision>0),
 operation_id TEXT NOT NULL,
 summary_committed_at TEXT NOT NULL,
 boundary TEXT NOT NULL CHECK(boundary IN ('captured','historical')),
 observed_requests INTEGER NOT NULL CHECK(observed_requests>=0 AND observed_requests<=9007199254740991),
 paired_requests INTEGER NOT NULL CHECK(paired_requests>=0 AND paired_requests<=observed_requests),
 input_tokens INTEGER NOT NULL CHECK(input_tokens>=0 AND input_tokens<=9007199254740991),
 cache_read_tokens INTEGER NOT NULL CHECK(cache_read_tokens>=0 AND cache_read_tokens<=input_tokens)
) STRICT;
INSERT INTO cache_usage_baselines
WITH observations AS (
 SELECT recorded_at AS settled_at,input_tokens,cache_read_tokens,
   CASE WHEN input_tokens>0 AND input_tokens<=9007199254740991
     AND cache_read_tokens>0 AND cache_read_tokens<=input_tokens THEN 1 ELSE 0 END AS paired
 FROM run_usage
 UNION ALL
 SELECT finished_at,input_tokens,cache_read_tokens,
   CASE WHEN input_tokens>0 AND input_tokens<=9007199254740991
     AND cache_read_tokens>=0 AND cache_read_tokens<=input_tokens THEN 1 ELSE 0 END
 FROM auxiliary_model_calls WHERE status<>'started'
), boundaries AS (
 SELECT s.* FROM conversation_summary s
 JOIN conversation_compaction_operations o ON o.operation_id=s.last_operation_id
   AND o.character_id=s.character_id AND o.state='committed' AND o.committed_summary_revision=s.revision
 WHERE julianday(s.updated_at) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM observations u WHERE julianday(u.settled_at) IS NULL
     OR julianday(u.settled_at)=julianday(s.updated_at))
)
SELECT s.character_id,s.revision,s.last_operation_id,s.updated_at,'historical',
 COUNT(u.settled_at),COALESCE(SUM(u.paired),0),
 TOTAL(CASE WHEN u.paired=1 THEN u.input_tokens ELSE 0 END),
 TOTAL(CASE WHEN u.paired=1 THEN u.cache_read_tokens ELSE 0 END)
FROM boundaries s LEFT JOIN observations u ON julianday(u.settled_at)<julianday(s.updated_at)
GROUP BY s.character_id
HAVING TOTAL(CASE WHEN u.paired=1 THEN u.input_tokens ELSE 0 END)<=9007199254740991;
` };

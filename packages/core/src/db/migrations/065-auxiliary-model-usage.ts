/**
 * INPUT:  provider-independent auxiliary call metadata after migration 064
 * OUTPUT: additive observed-call lifecycle and nullable provider usage counters
 * POS:    core/db/migrations — separate from canonical Run usage and raw model content
 */
import type { Migration } from "../migration-runner.ts";

const countCheck = (column: string) =>
  `CHECK(${column} IS NULL OR (${column}>=0 AND ${column}<=9007199254740991))`;

export const auxiliaryModelUsageMigration065: Migration = { version: 65, sql: `
CREATE TABLE auxiliary_model_calls (
 call_id TEXT PRIMARY KEY,
 task_id TEXT,
 source TEXT NOT NULL CHECK(source IN ('utility','image-description','screenshot-description')),
 label TEXT NOT NULL,
 provider TEXT NOT NULL,
 model_id TEXT NOT NULL,
 started_at TEXT NOT NULL,
 finished_at TEXT,
 updated_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('started','completed','failed','cancelled','interrupted')),
 response_id TEXT,
 input_tokens INTEGER ${countCheck("input_tokens")},
 no_cache_tokens INTEGER ${countCheck("no_cache_tokens")},
 cache_read_tokens INTEGER ${countCheck("cache_read_tokens")},
 cache_write_tokens INTEGER ${countCheck("cache_write_tokens")},
 output_tokens INTEGER ${countCheck("output_tokens")},
 reasoning_tokens INTEGER ${countCheck("reasoning_tokens")},
 total_tokens INTEGER ${countCheck("total_tokens")}
) STRICT;
CREATE INDEX auxiliary_model_calls_started ON auxiliary_model_calls(started_at DESC,call_id DESC);
CREATE INDEX auxiliary_model_calls_status ON auxiliary_model_calls(status,started_at);
` };

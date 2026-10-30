/**
 * INPUT: existing Timeline speech and staged delivery records through migration 056
 * OUTPUT: optional immutable source sidecars without changing legacy text, identity or receipts
 * POS: core/db/migrations — additive publication evidence; source descriptions grant no authority
 */
import type { Migration } from "../migration-runner.ts";

export const sourceContextMigration057: Migration = {
  version: 57,
  ensureNullableTextColumns: [
    { table: "timeline_messages", column: "source_context_json" },
    { table: "run_deliveries", column: "source_context_json" },
  ],
  sql: `
CREATE TRIGGER IF NOT EXISTS timeline_source_context_immutable BEFORE UPDATE OF source_context_json ON timeline_messages
WHEN NEW.source_context_json IS NOT OLD.source_context_json
BEGIN SELECT RAISE(ABORT, 'timeline source context is immutable'); END;
CREATE TRIGGER IF NOT EXISTS delivery_source_context_immutable BEFORE UPDATE OF source_context_json ON run_deliveries
WHEN NEW.source_context_json IS NOT OLD.source_context_json
BEGIN SELECT RAISE(ABORT, 'delivery source context is immutable'); END;
`,
};

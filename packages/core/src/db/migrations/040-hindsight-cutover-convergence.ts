/**
 * INPUT:  a recognized early or current 023 schema after the append-only 039 tail
 * OUTPUT: complete current B4 schema, preserving Local authority, canonical/B2 rows and every old receipt
 * POS:    core/db/migrations — 040 convergence; unknown schemas or unmappable historical imports refuse atomically
 */
import type { Migration } from "../migration-runner.ts";
import { currentHindsightCutoverSchema040, earlyHindsightCutoverSchema040 } from "./040-hindsight-cutover-schema.ts";

const oldNames = new Set(earlyHindsightCutoverSchema040.map(({ name }) => name));
const missingEarlyObjects = currentHindsightCutoverSchema040.map(({ name }) => name).filter((name) => !oldNames.has(name));
const shadowMarker = "memory_authority_selection_pre_040";

export const hindsightCutoverConvergenceMigration040: Migration = {
  version: 40,
  sql: "SELECT 1;",
  schemaBranches: [
    {
      name: "current-023",
      schema: currentHindsightCutoverSchema040,
      absentObjects: [shadowMarker],
      sql: "SELECT 1;",
    },
    {
      name: "early-023-empty-imports",
      schema: earlyHindsightCutoverSchema040,
      absentObjects: [...missingEarlyObjects, shadowMarker],
      replacedTables: ["memory_authority_selection", "hindsight_import_operations", "hindsight_import_facts"],
      emptyTables: ["hindsight_import_operations", "hindsight_import_facts"],
      // Old content_hash never proved both of the new identities, and no historical lease fence is known.
      // Only empty import tables can be replaced. The marker copy preserves every existing column verbatim;
      // NULL provider fields permit Local/legacy mode and cannot activate Hindsight.
      sql: `
ALTER TABLE memory_authority_selection RENAME TO ${shadowMarker};
DROP TABLE hindsight_import_facts;
DROP TABLE hindsight_import_operations;
${currentHindsightCutoverSchema040.map(({ sql }) => sql).join("\n")}
INSERT INTO memory_authority_selection
 (singleton,mode,active_epoch_id,verified_snapshot_id,activation_transaction_id,provider_lineage_id,replica_checkpoint_digest,updated_at)
 SELECT singleton,mode,active_epoch_id,verified_snapshot_id,activation_transaction_id,NULL,NULL,updated_at
 FROM ${shadowMarker};
DROP TABLE ${shadowMarker};
`,
    },
  ],
};

/**
 * INPUT:  migration 060 and every current template, authority and paired-checkpoint dependency
 * OUTPUT: transactional random identity stamps, cheap tokens and exact declarative trigger verification
 * POS:    Core SQLite invalidation schema; follows 059's clock pattern without changing its config contract
 */
import type { Migration } from "../migration-runner.ts";

const tables = [
  "hindsight_bank_setup", "hindsight_template_enrollments", "hindsight_template_bases",
  "hindsight_template_users", "hindsight_template_selections", "hindsight_template_applied",
  "hindsight_template_defaults", "hindsight_template_default_history", "memory_authority_selection",
  "canonical_memory_authority_state", "canonical_memory_authority_epochs",
  "hindsight_application_replica_checkpoints", "hindsight_replica_sync_checkpoints",
];

const triggers = tables.flatMap((table) => ["INSERT", "UPDATE", "DELETE"].map((operation) => {
  const name = `${table}_runtime_identity_${operation.toLowerCase()}`;
  const sql = `CREATE TRIGGER ${name} AFTER ${operation} ON ${table}
BEGIN UPDATE hindsight_runtime_identity_clock SET stamp=randomblob(16) WHERE singleton=1; END`;
  return { table, name, sql };
}));

export const HINDSIGHT_RUNTIME_IDENTITY_STAMP_SQL = `
SELECT hex(stamp) AS stamp, (SELECT schema_version FROM pragma_schema_version) AS schema_version
FROM hindsight_runtime_identity_clock WHERE singleton=1`;

// Full checks and changed-schema guards verify definitions and the token in the same snapshot.
// These literals are exclusively the fixed declarations above, never application or user input.
export const HINDSIGHT_RUNTIME_IDENTITY_TOKEN_SQL = `
WITH required(name,table_name,definition) AS (VALUES ${triggers.map(({ name, table, sql }) =>
  `('${name}','${table}','${sql}')`).join(",")})
SELECT hex(stamp) AS stamp, (SELECT schema_version FROM pragma_schema_version) AS schema_version,
 NOT EXISTS(SELECT 1 FROM required r LEFT JOIN sqlite_schema s ON s.name=r.name
  AND s.type='trigger' AND s.tbl_name=r.table_name WHERE s.sql IS NOT r.definition) AS trusted
FROM hindsight_runtime_identity_clock WHERE singleton=1`;

export const hindsightRuntimeIdentityMigration061: Migration = {
  version: 61,
  sql: `
CREATE TABLE hindsight_runtime_identity_clock (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), stamp BLOB NOT NULL CHECK(length(stamp)=16)
) STRICT;
INSERT INTO hindsight_runtime_identity_clock VALUES(1,randomblob(16));
${triggers.map(({ sql }) => `${sql};`).join("\n")}`,
};

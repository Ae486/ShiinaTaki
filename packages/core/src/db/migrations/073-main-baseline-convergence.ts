/**
 * INPUT: exact main063, T4072/068 and evidenced mixed/early-delegation schema shapes
 * OUTPUT: missing main Hindsight feature groups without rewriting historical receipts or existing clocks
 * POS: core/db/migrations — one guarded transaction; current complete main groups are verified no-ops
 */
import type { Migration, MigrationSchemaBranch } from "../migration-runner.ts";
import { MAIN_SCHEMA, T4_SCHEMA, T4_WITHOUT_MODELS_SCHEMA, UNION_SCHEMA, GROUP_77_OBJECT_NAMES } from "./073-convergence-schema.generated.ts";
import { delegationContextSchema069, delegationFrontierSchema069 } from "./069-delegation-schema.ts";
import { convergenceAbsentObjects, convergenceUnquotedTimeline } from "./convergence-schema.ts";
import { MAIN_MISSING_SQL } from "./convergence-sql.ts";
import { FROZEN_T4_SCHEMA, FROZEN_SOURCE_BACKUP_NAMES, FROZEN_SOURCE_REPAIR_SQL, FROZEN_SOURCE_REPLACED_TABLES } from "./073-frozen-source-phase.ts";

const contextNames = new Set(delegationContextSchema069.map(({ name }) => name));
const frontierNames = new Set(delegationFrontierSchema069.map(({ name }) => name));
const modelNames = new Set(GROUP_77_OBJECT_NAMES);
const branches: MigrationSchemaBranch[] = [{ name: "main063-current", schema: MAIN_SCHEMA,
  absentObjects: convergenceAbsentObjects(UNION_SCHEMA, MAIN_SCHEMA), sql: "SELECT 1;" },
  { name: "main063-current-unquoted-timeline", schema: convergenceUnquotedTimeline(MAIN_SCHEMA),
    absentObjects: convergenceAbsentObjects(UNION_SCHEMA, MAIN_SCHEMA), sql: "SELECT 1;" },
  { name: "frozen-t4072-unchecked-source-unquoted-timeline", schema: FROZEN_T4_SCHEMA,
    absentObjects: [...convergenceAbsentObjects(UNION_SCHEMA, FROZEN_T4_SCHEMA), ...FROZEN_SOURCE_BACKUP_NAMES],
    replacedTables: [...FROZEN_SOURCE_REPLACED_TABLES, "memory_authority_selection", "hindsight_replica_manual_requests", "memory_transition_quarantined_replica_requests"],
    sql: `${FROZEN_SOURCE_REPAIR_SQL}\n${MAIN_MISSING_SQL}` },
];

for (const [prefix, schema, create] of [
  ["t4072", T4_SCHEMA, true], ["t4068", T4_WITHOUT_MODELS_SCHEMA, true],
  ["mixed-current", UNION_SCHEMA, false],
  ["mixed-pre-model", UNION_SCHEMA.filter(({ name }) => !modelNames.has(name)), false],
] as const) {
  for (const context of [false, true]) for (const frontier of [false, true]) {
    const present = schema.filter(({ name }) => (context || !contextNames.has(name)) && (frontier || !frontierNames.has(name)));
    branches.push({ name: `${prefix}-context-${context}-frontier-${frontier}`, schema: present,
      absentObjects: convergenceAbsentObjects(UNION_SCHEMA, present),
      ...(create ? { replacedTables: ["memory_authority_selection", "hindsight_replica_manual_requests", "memory_transition_quarantined_replica_requests"] } : {}),
      sql: create ? MAIN_MISSING_SQL : "SELECT 1;" });
  }
}

export const mainBaselineConvergenceMigration073: Migration = { version: 73, sql: "SELECT 1;", schemaBranches: branches };

/**
 * INPUT: absent or exact current/early-context private T4 delegation schema groups
 * OUTPUT: current private evidence tables plus only provable missing historical frontiers
 * POS: core/db/migrations — current nonempty tables never receive the older rebuild/backfill chain
 */
import type { Migration } from "../migration-runner.ts";
import { T4_SCHEMA, GROUP_75_OBJECT_NAMES } from "./073-convergence-schema.generated.ts";
import { delegationSchemaConvergenceMigration069 } from "./069-delegation-schema-convergence.ts";
import { convergenceAbsentObjects, convergenceOwnedSchema } from "./convergence-schema.ts";
import { DELEGATION_MISSING_SQL } from "./convergence-sql.ts";

const known = convergenceOwnedSchema(T4_SCHEMA, GROUP_75_OBJECT_NAMES);
const repairs = delegationSchemaConvergenceMigration069.schemaBranches!.map((branch) => {
  const absent = new Set(branch.absentObjects);
  const schema = known.filter(({ name }) => !absent.has(name));
  return { name: `private-${branch.name}`, schema, absentObjects: convergenceAbsentObjects(known, schema), sql: branch.sql };
});
export const delegationConvergenceMigration075: Migration = { version: 75, sql: "SELECT 1;", schemaBranches: [
  { name: "private-absent", schema: [], absentObjects: known.map(({ name }) => name),
    replacedTables: ["subagent_inputs", "subagent_executions", "run_messages"], sql: DELEGATION_MISSING_SQL },
  ...repairs,
] };

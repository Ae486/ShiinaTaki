/**
 * INPUT: exact absent/current primary-source, usage, Tidy and maintenance observation groups
 * OUTPUT: complete factual observation metadata without resetting existing rows or clocks
 * POS: core/db/migrations — conservative original seeds run only while the whole observation group is absent
 */
import type { Migration } from "../migration-runner.ts";
import { T4_SCHEMA, DELEGATION_STAGE_SCHEMA, GROUP_76_OBJECT_NAMES } from "./073-convergence-schema.generated.ts";
import { convergenceAbsentObjects, convergenceOwnedSchema, convergenceUnquotedTimeline } from "./convergence-schema.ts";
import { OBSERVATION_MISSING_SQL } from "./convergence-sql.ts";

const known = convergenceOwnedSchema(T4_SCHEMA, GROUP_76_OBJECT_NAMES);
const missing = convergenceOwnedSchema(DELEGATION_STAGE_SCHEMA, GROUP_76_OBJECT_NAMES);
export const memoryObservationConvergenceMigration076: Migration = { version: 76, sql: "SELECT 1;", schemaBranches: [
  { name: "observation-absent", schema: missing, absentObjects: convergenceAbsentObjects(known, missing), sql: OBSERVATION_MISSING_SQL },
  { name: "observation-absent-unquoted-timeline", schema: convergenceUnquotedTimeline(missing), absentObjects: convergenceAbsentObjects(known, missing), sql: OBSERVATION_MISSING_SQL },
  { name: "observation-current", schema: known, absentObjects: [], sql: "SELECT 1;" },
  { name: "observation-current-unquoted-timeline", schema: convergenceUnquotedTimeline(known), absentObjects: [], sql: "SELECT 1;" },
] };

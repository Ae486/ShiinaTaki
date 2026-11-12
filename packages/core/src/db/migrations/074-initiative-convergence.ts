/**
 * INPUT: exact absent/current T4 initiative, Timezone and source-context groups
 * OUTPUT: complete initiative schema while preserving existing settings and immutable publication sidecars
 * POS: core/db/migrations — additive group; current final or pre-primary-source shapes are no-ops
 */
import type { Migration } from "../migration-runner.ts";
import { MAIN_SCHEMA, T4_SCHEMA, INITIATIVE_STAGE_SCHEMA, GROUP_74_OBJECT_NAMES } from "./073-convergence-schema.generated.ts";
import { convergenceAbsentObjects, convergenceOwnedSchema, convergenceUnquotedTimeline } from "./convergence-schema.ts";
import { INITIATIVE_MISSING_SQL } from "./convergence-sql.ts";

const known = convergenceOwnedSchema(T4_SCHEMA, GROUP_74_OBJECT_NAMES);
const missing = convergenceOwnedSchema(MAIN_SCHEMA, GROUP_74_OBJECT_NAMES);
const interim = convergenceOwnedSchema(INITIATIVE_STAGE_SCHEMA, GROUP_74_OBJECT_NAMES);
export const initiativeConvergenceMigration074: Migration = { version: 74, sql: "SELECT 1;", schemaBranches: [
  { name: "initiative-absent", schema: missing, absentObjects: convergenceAbsentObjects(known, missing), sql: INITIATIVE_MISSING_SQL },
  { name: "initiative-absent-unquoted-timeline", schema: convergenceUnquotedTimeline(missing), absentObjects: convergenceAbsentObjects(known, missing), sql: INITIATIVE_MISSING_SQL },
  { name: "initiative-current-pre-primary", schema: interim, absentObjects: convergenceAbsentObjects(known, interim), sql: "SELECT 1;" },
  { name: "initiative-current-pre-primary-unquoted-timeline", schema: convergenceUnquotedTimeline(interim), absentObjects: convergenceAbsentObjects(known, interim), sql: "SELECT 1;" },
  { name: "initiative-current", schema: known, absentObjects: [], sql: "SELECT 1;" },
  { name: "initiative-current-unquoted-timeline", schema: convergenceUnquotedTimeline(known), absentObjects: [], sql: "SELECT 1;" },
] };

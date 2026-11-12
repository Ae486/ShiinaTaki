/**
 * INPUT: absent or exact current model profiles, owned secret references and search-policy metadata
 * OUTPUT: supported model/configuration recovery storage with existing drafts and references intact
 * POS: core/db/migrations — additive metadata; no credential read, model call or fabricated historical policy
 */
import type { Migration } from "../migration-runner.ts";
import { T4_SCHEMA, GROUP_77_OBJECT_NAMES } from "./073-convergence-schema.generated.ts";
import { convergenceOwnedSchema } from "./convergence-schema.ts";
import { MODEL_MISSING_SQL } from "./convergence-sql.ts";

const known = convergenceOwnedSchema(T4_SCHEMA, GROUP_77_OBJECT_NAMES);
export const modelConfigurationConvergenceMigration077: Migration = { version: 77, sql: "SELECT 1;", schemaBranches: [
  { name: "model-configuration-absent", schema: [], absentObjects: known.map(({ name }) => name), sql: MODEL_MISSING_SQL },
  { name: "model-configuration-current", schema: known, absentObjects: [], sql: "SELECT 1;" },
] };

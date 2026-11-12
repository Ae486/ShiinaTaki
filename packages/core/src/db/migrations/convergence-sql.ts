/**
 * INPUT: immutable main/T4 historical SQL for entirely absent feature groups
 * OUTPUT: creation-only higher-migration SQL; existing complete groups use verified no-op branches
 * POS: core/db/migrations — no lower receipt replay or mutation of already-current feature tables
 */
import type { Migration } from "../migration-runner.ts";
import { MAIN_HISTORICAL_MIGRATIONS } from "./historical-main.ts";
import { T4_HISTORICAL_MIGRATIONS } from "./historical-t4.ts";

export const MAIN_MISSING_SQL = missingGroupSql(MAIN_HISTORICAL_MIGRATIONS.filter(({ version }) => version > 48));
export const INITIATIVE_MISSING_SQL = missingGroupSql(T4_HISTORICAL_MIGRATIONS.filter(({ version }) =>
  (version >= 49 && version <= 55) || version === 57));
export const DELEGATION_MISSING_SQL = missingGroupSql(T4_HISTORICAL_MIGRATIONS.filter(({ version }) =>
  version === 56 || version === 58 || (version >= 60 && version <= 63) || version === 69));
export const OBSERVATION_MISSING_SQL = missingGroupSql(T4_HISTORICAL_MIGRATIONS.filter(({ version }) => version >= 64 && version <= 68));
export const MODEL_MISSING_SQL = missingGroupSql(T4_HISTORICAL_MIGRATIONS.filter(({ version }) => version >= 70));

function missingGroupSql(migrations: readonly Migration[]): string {
  return migrations.flatMap((migration) => {
    // These inputs are used only after an exact higher-level ABSENT group match. Every
    // rebuild therefore transforms tables created earlier in this same transaction.
    const branch = migration.schemaBranches?.length === 1 ? migration.schemaBranches[0]
      : migration.schemaBranches?.find(({ name }) => name === "current-058-current-060");
    if (migration.schemaBranches && !branch) throw new Error("UNKNOWN_CONVERGENCE_CREATION_BRANCH");
    return [...migration.ensureNullableTextColumns?.map(({ table, column }) =>
      `ALTER TABLE "${table}" ADD COLUMN "${column}" TEXT;`) ?? [], branch?.sql ?? "", migration.sql];
  }).join("\n");
}

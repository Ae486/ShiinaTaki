/**
 * INPUT: frozen known schema constants and the explicit owned object-name set
 * OUTPUT: exact group signatures, including every known attached index and trigger
 * POS: core/db/migrations — declarative branch construction; the existing runner owns validation/transactions
 */
import type { MigrationSchemaObject } from "../migration-runner.ts";
import { T4_SCHEMA } from "./073-convergence-schema.generated.ts";

type FrozenObject = (typeof T4_SCHEMA)[number];

export function convergenceOwnedSchema(schema: readonly FrozenObject[], names: readonly string[]): MigrationSchemaObject[] {
  const owned = new Set(names);
  const tables = new Set(schema.filter(({ type, name }) => type === "table" && owned.has(name)).map(({ name }) => name));
  return schema.filter((object) => owned.has(object.name) || tables.has(object.table));
}

export function convergenceAbsentObjects(known: readonly MigrationSchemaObject[], present: readonly MigrationSchemaObject[]): string[] {
  const names = new Set(present.map(({ name }) => name));
  return known.map(({ name }) => name).filter((name) => !names.has(name));
}

/** Historical 035 added this exact bare identifier; quoted literals remain globally significant. */
export function convergenceUnquotedTimeline(schema: readonly MigrationSchemaObject[]): MigrationSchemaObject[] {
  return schema.map((object) => object.name === "timeline_messages"
    ? { ...object, sql: object.sql.replace('"presentation" TEXT', "presentation TEXT") } : object);
}

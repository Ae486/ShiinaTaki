/**
 * INPUT:  supported archive manifest and independently observed stopped-target table/column inventory
 * OUTPUT: strict complete same-version shape validation and explicit unsupported/omitted-data refusal
 * POS:    candidate pre-admission; generic Native restore's skip/drop behavior is never used as completeness evidence
 */
import { HindsightCandidateSchemaInventorySchema, type HindsightCandidateArchiveManifest,
  type HindsightCandidateSchemaInventory } from "@taki/shared";
import { templateEqual } from "../hindsight/template-lifecycle/template-integrity.ts";
import { HINDSIGHT_CANDIDATE_ALEMBIC, HINDSIGHT_CANDIDATE_BUILD, HINDSIGHT_CANDIDATE_CLASSIFIED,
  HINDSIGHT_CANDIDATE_TABLES, HINDSIGHT_CANDIDATE_UPSTREAM } from "./hindsight-candidate-profile.ts";
import { refuse } from "./hindsight-candidate-refusal.ts";

export function assertCandidateVersion(value: Pick<HindsightCandidateSchemaInventory, "alembicRevision" | "compatibilityBuild" | "upstreamCommit">) {
  if (value.compatibilityBuild !== HINDSIGHT_CANDIDATE_BUILD || value.alembicRevision !== HINDSIGHT_CANDIDATE_ALEMBIC
    || value.upstreamCommit !== HINDSIGHT_CANDIDATE_UPSTREAM) refuse("unsupported", "schema");
}

export function admitCandidateSchema(manifest: HindsightCandidateArchiveManifest, raw: HindsightCandidateSchemaInventory) {
  const parsed = HindsightCandidateSchemaInventorySchema.safeParse(raw);
  if (!parsed.success) refuse("unsupported", "schema");
  const target = parsed.data;
  assertCandidateVersion(target);
  if (manifest.taki?.version !== 2) refuse("unsupported", "manifest");
  assertCandidateVersion(manifest.taki.proof);
  if (manifest.schema !== target.schema) refuse("unsupported", "schema");
  const tables = new Map(target.tables.map((table) => [table.name, table]));
  for (const name of HINDSIGHT_CANDIDATE_TABLES.keys()) {
    const archived = manifest.tables[name]; const restored = tables.get(name);
    if (!archived || !restored) refuse("omitted_required_data", "table", { name });
    assertColumns(name, archived.columns.map(({ name, type_name }) => ({ name, typeName: type_name })), restored.columns);
  }
  for (const name of Object.keys(manifest.tables)) if (!HINDSIGHT_CANDIDATE_TABLES.has(name)) refuse("unsupported", "table", { name });
  for (const name of tables.keys()) {
    if (!HINDSIGHT_CANDIDATE_TABLES.has(name) && !HINDSIGHT_CANDIDATE_CLASSIFIED.has(name)) refuse("unsupported", "table", { name });
  }
  for (const name of HINDSIGHT_CANDIDATE_CLASSIFIED.keys()) if (!tables.has(name)) refuse("omitted_required_data", "table", { name });
  assertBodyColumns(target);
  const dimension = vectorDimension(target, "memory_units");
  if (dimension !== vectorDimension(target, "mental_models")) refuse("unsupported", "column", { name: "embedding" });
  return { ...target, tables: [...target.tables].sort((left, right) => left.name.localeCompare(right.name, "en")) };
}

function assertColumns(name: string, source: HindsightCandidateSchemaInventory["tables"][number]["columns"],
  target: HindsightCandidateSchemaInventory["tables"][number]["columns"]) {
  if (source.length !== target.length || source.some((column) => !target.some((other) => other.name === column.name))) {
    refuse("omitted_required_data", "column", { name });
  }
  if (!templateEqual(source, target)) refuse("unsupported", "column", { name });
}

function assertBodyColumns(target: HindsightCandidateSchemaInventory) {
  for (const [table, column, type] of [["documents", "file_storage_key", "text"], ["file_storage", "storage_key", "text"],
    ["file_storage", "data", "bytea"]]) {
    const value = target.tables.find((value) => value.name === table)?.columns.find((value) => value.name === column);
    if (!value) refuse("omitted_required_data", "column", { name: `${table}.${column}` });
    if (value.typeName !== type) refuse("unsupported", "column", { name: `${table}.${column}` });
  }
}

function vectorDimension(target: HindsightCandidateSchemaInventory, table: string) {
  const value = target.tables.find((value) => value.name === table)?.columns.find((value) => value.name === "embedding");
  const dimension = /^vector\(([1-9][0-9]*)\)$/.exec(value?.typeName ?? "")?.[1];
  if (!dimension) refuse("unsupported", "column", { name: `${table}.embedding` });
  return dimension;
}

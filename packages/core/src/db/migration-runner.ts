/**
 * INPUT:  a Database wrapper + ordered SQL migrations with optional column guards or exact schema branches
 * OUTPUT: runMigrations(db, migrations) -> the versions applied this run; one transaction each, tracked
 * POS:    core/db — startup migration runner; TS-constant migrations (no fs); receives the wrapper (no node:sqlite here)
 */
import type { Database, SqlRow, SqlStatement } from "./sqlite.ts";

export interface Migration {
  version: number;
  sql: string;
  /** Run before sql in the same transaction; existing columns must match the additive definition exactly. */
  ensureNullableTextColumns?: readonly MigrationNullableTextColumn[];
  /** Select exactly one known schema before any DDL; branch SQL and the receipt share the transaction. */
  schemaBranches?: readonly MigrationSchemaBranch[];
}

export interface MigrationNullableTextColumn {
  table: string;
  column: string;
}

export interface MigrationSchemaObject {
  type: "table" | "index";
  name: string;
  sql: string;
}

export interface MigrationSchemaBranch {
  name: string;
  schema: readonly MigrationSchemaObject[];
  absentObjects: readonly string[];
  /** Rebuilding may discard these definitions only when no unknown incoming foreign key exists. */
  replacedTables?: readonly string[];
  /** Historical data without a proven mapping must never receive invented identities/defaults. */
  emptyTables?: readonly string[];
  sql: string;
}

export function runMigrations(db: Database, migrations: Migration[]): number[] {
  db.exec("CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT");
  const current = currentVersion(db);
  const record = db.prepare("INSERT INTO migrations (version, applied_at) VALUES (:version, :applied_at)");
  const applied: number[] = [];
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    applyMigration(db, record, migration);
    applied.push(migration.version);
  }
  return applied;
}

function currentVersion(db: Database): number {
  const version = db.prepare("SELECT max(version) AS version FROM migrations").get()?.version;
  return typeof version === "number" ? version : 0;
}

function applyMigration(db: Database, record: SqlStatement, migration: Migration): void {
  try {
    db.transaction(() => {
      if (migration.schemaBranches) applySchemaBranch(db, migration.schemaBranches);
      for (const column of migration.ensureNullableTextColumns ?? []) ensureNullableTextColumn(db, column);
      db.exec(migration.sql);
      record.run({ version: migration.version, applied_at: new Date().toISOString() });
    });
  } catch (error) {
    // Fatal-fast at boot with a precise message; the transaction has already rolled back.
    throw new Error(`migration ${migration.version} failed`, { cause: error });
  }
}

function applySchemaBranch(db: Database, branches: readonly MigrationSchemaBranch[]): void {
  const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL").all();
  const matches = branches.filter((branch) => matchesSchemaBranch(schema, branch));
  if (matches.length !== 1) throw new Error("unsupported migration schema lineage: expected exactly one recognized schema branch");
  const branch = matches[0];
  if (!branch) throw new Error("missing recognized migration schema branch");
  for (const table of branch.emptyTables ?? []) {
    if (db.prepare(`SELECT 1 FROM ${quoteIdentifier(table)} LIMIT 1`).get()) {
      throw new Error(`migration schema branch ${branch.name} requires empty ${table}: historical rows have no proven identity mapping`);
    }
  }
  assertNoUnknownIncomingReferences(db, schema, branch.replacedTables ?? []);
  db.exec(branch.sql);
}

function matchesSchemaBranch(schema: SqlRow[], branch: MigrationSchemaBranch): boolean {
  const names = new Set([...branch.schema.map((object) => foldSqlName(object.name)), ...branch.absentObjects.map(foldSqlName)]);
  const tables = new Set(branch.schema.filter((object) => object.type === "table").map((object) => foldSqlName(object.name)));
  // Include attached indexes/triggers: rebuilding a recognized table must not silently drop an unknown contract.
  const owned = schema.filter((row) => typeof row.name === "string" && (names.has(foldSqlName(row.name)) ||
    (typeof row.tbl_name === "string" && tables.has(foldSqlName(row.tbl_name)))));
  if (owned.length !== branch.schema.length) return false;
  return branch.schema.every((expected) => owned.some((row) => row.type === expected.type &&
    typeof row.name === "string" && foldSqlName(row.name) === foldSqlName(expected.name) &&
    typeof row.sql === "string" && normalizedSchemaSql(row.sql) === normalizedSchemaSql(expected.sql)));
}

function normalizedSchemaSql(sql: string): string {
  // Preserve quoted tokens byte-for-byte. Folding whole SQL would equate distinct CHECK literals and defaults.
  const tokens = schemaTokens(sql).map((token) => /^[A-Za-z_]/.test(token) ? foldSqlName(token) : token);
  if (tokens.at(-1) === ";") tokens.pop();
  return JSON.stringify(tokens);
}

function assertNoUnknownIncomingReferences(db: Database, schema: SqlRow[], replacedTables: readonly string[]): void {
  if (replacedTables.length === 0) return;
  const replaced = new Set(replacedTables.map(foldSqlName));
  for (const row of schema) {
    if ((row.type === "view" || row.type === "trigger") && typeof row.sql === "string" &&
      schemaTokens(row.sql).some((token) => replaced.has(sqlTokenName(token)))) {
      throw new Error(`unsupported incoming schema reference from ${String(row.name)} to a replaced migration table`);
    }
    if (row.type !== "table" || typeof row.name !== "string" || replaced.has(foldSqlName(row.name))) continue;
    const references = db.prepare("SELECT \"table\" FROM pragma_foreign_key_list(:table)").all({ table: row.name });
    if (references.some((reference) => typeof reference.table === "string" && replaced.has(foldSqlName(reference.table)))) {
      throw new Error(`unsupported incoming foreign key from ${row.name} to a replaced migration table`);
    }
  }
}

function ensureNullableTextColumn(db: Database, { table, column }: MigrationNullableTextColumn): void {
  // xinfo also exposes generated/hidden columns; they must not masquerade as a writable historical column.
  const existing = db.prepare(`SELECT type, "notnull", dflt_value, pk, hidden
    FROM pragma_table_xinfo(:table) WHERE name = :column COLLATE NOCASE`).get({ table, column });
  if (!existing) {
    db.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} TEXT`);
  } else if (
    typeof existing.type !== "string" || existing.type.toUpperCase() !== "TEXT" ||
    existing.notnull !== 0 || existing.dflt_value !== null || existing.pk !== 0 || existing.hidden !== 0
  ) {
    throw new Error(`incompatible migration column ${table}.${column}: expected ordinary nullable TEXT without default or primary key`);
  }
  // xinfo omits CHECK, UNIQUE, REFERENCES and COLLATE. Accept only the historical bare declaration,
  // and refuse constraints that can make an apparently nullable/writable TEXT column behave differently.
  if (!hasBareTextDeclaration(db, { table, column }) || hasColumnConstraints(db, { table, column })) {
    throw new Error(`incompatible migration column ${table}.${column}: expected unconstrained bare TEXT`);
  }
}

function hasBareTextDeclaration(db: Database, { table, column }: MigrationNullableTextColumn): boolean {
  const sql = db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=:table COLLATE NOCASE")
    .get({ table })?.sql;
  if (typeof sql !== "string") return false;
  const declarations = tableDeclarations(sql);
  const declaration = declarations.find((tokens) => sqlTokenName(tokens[0]) === foldSqlName(column));
  if (!declaration || declaration.length !== 2 || sqlTokenName(declaration[1]) !== "text") return false;
  // A sibling/table constraint mentioning this column is outside the bare-column contract. Do not try
  // to evaluate arbitrary SQLite expressions to decide whether their extra restrictions are harmless.
  return declarations.every((tokens) => tokens === declaration || !referencesColumn(tokens, column));
}

function hasColumnConstraints(db: Database, { table, column }: MigrationNullableTextColumn): boolean {
  // SQLite also accepts single-quoted identifiers in key declarations; pragma results distinguish
  // those actual column bindings from string literals in CHECK expressions.
  if (db.prepare(`SELECT "from" FROM pragma_foreign_key_list(:table)
    WHERE "from"=:column COLLATE NOCASE`).get({ table, column })) return true;
  if (db.prepare(`SELECT columns.name FROM pragma_index_list(:table) AS indexes
    JOIN pragma_index_xinfo(indexes.name) AS columns
    WHERE indexes."unique"=1 AND columns."key"=1 AND columns.name=:column COLLATE NOCASE`)
    .get({ table, column })) return true;
  const indexes = db.prepare(`SELECT sql FROM sqlite_schema WHERE type='index' AND tbl_name=:table COLLATE NOCASE
    AND name IN (SELECT name FROM pragma_index_list(:table) WHERE "unique"=1)`).all({ table });
  return indexes.some(({ sql }) => {
    if (sql === null) return false; // Autoindexes belong to declarations already checked above.
    if (typeof sql !== "string") return true;
    const tokens = schemaTokens(sql);
    const start = tokens.indexOf("(");
    return start < 0 || referencesColumn(tokens.slice(start + 1), column);
  });
}

function tableDeclarations(sql: string): string[][] {
  const tokens = schemaTokens(sql);
  if (tokens[0]?.toUpperCase() !== "CREATE" || tokens[1]?.toUpperCase() !== "TABLE") return [];
  const declarations: string[][] = [];
  let declaration: string[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token === "(" && depth++ === 0) continue;
    if (token === ")" && --depth === 0) return [...declarations, declaration];
    if (token === "," && depth === 1) {
      declarations.push(declaration);
      declaration = [];
    } else if (depth > 0) {
      declaration.push(token);
    }
  }
  return [];
}

function schemaTokens(sql: string): string[] {
  // This is only a declaration recognizer, not a general SQL parser. Quoted text stays one token so
  // commas/parentheses/constraint words inside strings, identifiers and comments cannot change boundaries.
  const tokens = sql.match(/--[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"]|"")*"|'(?:[^']|'')*'|`(?:[^`]|``)*`|\[[^\]]*\]|[A-Za-z_\u0080-\u{10FFFF}][\w$\u0080-\u{10FFFF}]*|[^\s]/gu) ?? [];
  return tokens.filter((token) => !token.startsWith("--") && !token.startsWith("/*"));
}

function referencesColumn(tokens: string[], column: string): boolean {
  return tokens.some((token) => !token.startsWith("'") && sqlTokenName(token) === foldSqlName(column));
}

function sqlTokenName(token: string | undefined): string {
  if (!token) return "";
  const quote = token.charAt(0);
  if (quote === '"' || quote === "'" || quote === "`") {
    return foldSqlName(token.slice(1, -1).replaceAll(quote + quote, quote));
  }
  return foldSqlName(quote === "[" ? token.slice(1, -1) : token);
}

function foldSqlName(value: string): string {
  // SQLite's identifier matching and NOCASE fold ASCII only.
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

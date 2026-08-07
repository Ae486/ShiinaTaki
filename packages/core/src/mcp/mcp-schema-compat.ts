/**
 * INPUT:  ListToolsResult definitions returned by an MCP server
 * OUTPUT: deep-cloned definitions with verified optional-nullable properties narrowed, plus per-tool skip issues
 * POS:    core/mcp — provider-neutral compatibility seam before the installed SDK builds executable tools
 */
import type { ListToolsResult } from "@ai-sdk/mcp";

export type McpSchemaCompatibilityIssueCode =
  | "DEFAULT_TYPE_MISMATCH"
  | "MALFORMED_REQUIRED"
  | "NULL_UNSUPPORTED"
  | "REQUIRED_NULLABLE_UNSUPPORTED"
  | "UNION_UNSUPPORTED";

export interface McpSchemaCompatibilityIssue {
  toolName: string;
  code: McpSchemaCompatibilityIssueCode;
  path: string;
}

export interface PreparedMcpToolDefinitions {
  definitions: ListToolsResult;
  skipped: McpSchemaCompatibilityIssue[];
}

type JsonRecord = Record<string, unknown>;
type SchemaContext = { kind: "root" | "property" | "items"; required: boolean };
type SchemaLocation = { path: string; context: SchemaContext };
type SchemaIssue = Omit<McpSchemaCompatibilityIssue, "toolName">;
type SchemaResult = { ok: true; schema: JsonRecord } | { ok: false; issue: SchemaIssue };

export function prepareMcpToolDefinitions(definitions: ListToolsResult): PreparedMcpToolDefinitions {
  const tools: ListToolsResult["tools"] = [];
  const skipped: McpSchemaCompatibilityIssue[] = [];
  for (const definition of definitions.tools) {
    const clone = structuredClone(definition);
    const result = prepareSchema(clone.inputSchema, "$", { kind: "root", required: true });
    if (result.ok) {
      clone.inputSchema = result.schema as typeof clone.inputSchema;
      tools.push(clone);
    } else {
      skipped.push({ toolName: definition.name, ...result.issue });
    }
  }
  return { definitions: { ...definitions, tools }, skipped };
}

function prepareSchema(schema: JsonRecord, path: string, context: SchemaContext): SchemaResult {
  const nullable = narrowNullable(schema, path, context);
  if (!nullable.ok) return nullable;
  const items = prepareItems(nullable.schema, path);
  if (!items.ok) return items;
  return prepareProperties(items.schema, path);
}

function prepareProperties(prepared: JsonRecord, path: string): SchemaResult {
  const properties = isRecord(prepared.properties) ? prepared.properties : undefined;
  const requiredResult = readRequired(prepared, path, properties);
  if (!requiredResult.ok) return requiredResult;
  if (properties === undefined) return { ok: true, schema: prepared };
  for (const [name, property] of Object.entries(properties)) {
    if (!isRecord(property)) continue;
    const propertyPath = `${path}.properties.${name}`;
    const result = prepareSchema(property, propertyPath, {
      kind: "property",
      required: requiredResult.names.has(name),
    });
    if (!result.ok) return result;
    properties[name] = result.schema;
  }
  return { ok: true, schema: prepared };
}

function prepareItems(schema: JsonRecord, path: string): SchemaResult {
  if (isRecord(schema.items)) {
    const result = prepareSchema(schema.items, `${path}.items`, { kind: "items", required: true });
    if (!result.ok) return result;
    schema.items = result.schema;
    return { ok: true, schema };
  }
  if (!Array.isArray(schema.items)) return { ok: true, schema };
  for (const [index, item] of schema.items.entries()) {
    if (!isRecord(item)) continue;
    const result = prepareSchema(item, `${path}.items[${index}]`, { kind: "items", required: true });
    if (!result.ok) return result;
    schema.items[index] = result.schema;
  }
  return { ok: true, schema };
}

function narrowNullable(schema: JsonRecord, path: string, context: SchemaContext): SchemaResult {
  if (schema.type === "null") return issue("NULL_UNSUPPORTED", path);
  if (Array.isArray(schema.type) && schema.type.includes("null")) {
    const nonNull = schema.type.filter((type) => type !== "null");
    if (schema.type.length !== 2 || nonNull.length !== 1 || typeof nonNull[0] !== "string") {
      return issue("UNION_UNSUPPORTED", path);
    }
    const narrowed: JsonRecord = { ...schema, type: nonNull[0] };
    delete narrowed.default;
    return narrowRecognized(schema, narrowed, { path, context });
  }

  const candidates = [schema.anyOf, schema.oneOf].filter(
    (union): union is unknown[] => Array.isArray(union) && union.some(isNullTypedBranch),
  );
  if (candidates.length === 0) return { ok: true, schema };
  if (candidates.length !== 1) return issue("UNION_UNSUPPORTED", path);
  const union = candidates[0] as unknown[];
  if (context.kind === "property" && !hasOnlyNullableWrapperKeys(schema, union)) {
    return issue("UNION_UNSUPPORTED", path);
  }
  const branches = union.filter(isRecord);
  const nonNull = branches.filter((branch) => branch.type !== "null");
  const nullBranches = branches.filter(isExactNullBranch);
  if (union.length !== 2 || branches.length !== 2 || nonNull.length !== 1 || nullBranches.length !== 1) {
    return issue("UNION_UNSUPPORTED", path);
  }
  return narrowRecognized(schema, nonNull[0] as JsonRecord, { path, context });
}

function narrowRecognized(schema: JsonRecord, nonNull: JsonRecord, location: SchemaLocation): SchemaResult {
  const { path, context } = location;
  if (typeof nonNull.type !== "string" || nonNull.type === "null") return issue("UNION_UNSUPPORTED", path);
  if (context.kind !== "property") return issue("NULL_UNSUPPORTED", path);
  if (context.required) return issue("REQUIRED_NULLABLE_UNSUPPORTED", path);
  if (schema.default !== undefined && schema.default !== null) return issue("DEFAULT_TYPE_MISMATCH", path);
  const narrowed = { ...nonNull };
  if (narrowed.default === null) delete narrowed.default;
  if (typeof schema.title === "string") narrowed.title = schema.title;
  if (typeof schema.description === "string") narrowed.description = schema.description;
  return { ok: true, schema: narrowed };
}

function readRequired(
  schema: JsonRecord,
  path: string,
  properties: JsonRecord | undefined,
): { ok: true; names: Set<string> } | { ok: false; issue: SchemaIssue } {
  if (schema.required === undefined) return { ok: true, names: new Set() };
  if (!Array.isArray(schema.required)) return issue("MALFORMED_REQUIRED", `${path}.required`);
  const names = new Set<string>();
  for (const name of schema.required) {
    if (typeof name !== "string" || names.has(name) || properties === undefined || !Object.hasOwn(properties, name)) {
      return issue("MALFORMED_REQUIRED", `${path}.required`);
    }
    names.add(name);
  }
  return { ok: true, names };
}

function issue(code: McpSchemaCompatibilityIssueCode, path: string): { ok: false; issue: SchemaIssue } {
  return { ok: false, issue: { code, path } };
}

function isNullTypedBranch(value: unknown): boolean {
  return isRecord(value) && value.type === "null";
}

function isExactNullBranch(value: JsonRecord): boolean {
  if (value.type !== "null") return false;
  return Object.keys(value).every((key) => key === "type" || key === "title" || key === "description");
}

function hasOnlyNullableWrapperKeys(schema: JsonRecord, union: unknown[]): boolean {
  const unionKey = schema.anyOf === union ? "anyOf" : "oneOf";
  return Object.keys(schema).every(
    (key) => key === unionKey || key === "title" || key === "description" || key === "default",
  );
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

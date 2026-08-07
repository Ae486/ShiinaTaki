# MCP Tool Schema Compatibility Contract

## 1. Scope / Trigger

Use this contract whenever operator-configured MCP tool definitions enter the model-facing AI SDK `ToolSet`, or when a
new provider incompatibility requires another evidence-backed schema rule.

The compatibility boundary is definition preparation, not transport or provider request rewriting:

```text
MCPClient.listTools()
  -> prepare each definition independently
  -> omit incompatible definitions with a structured warning
  -> same MCPClient.toolsFromDefinitions()
  -> existing namespace, approval, execute wrapper, and tools/call path
```

This is a narrow provider-portability layer. It is not a general JSON Schema/OpenAPI converter.

## 2. Signatures

```typescript
type McpSchemaCompatibilityIssue = {
  toolName: string;
  code:
    | "DEFAULT_TYPE_MISMATCH"
    | "MALFORMED_REQUIRED"
    | "NULL_UNSUPPORTED"
    | "REQUIRED_NULLABLE_UNSUPPORTED"
    | "UNION_UNSUPPORTED";
  path: string;
};

function prepareMcpToolDefinitions(definitions: ListToolsResult): {
  definitions: ListToolsResult;
  skipped: McpSchemaCompatibilityIssue[];
};
```

Use the installed public `ListToolsResult` type. Do not import internal MCP SDK types or rebuild executable tools.

## 3. Contracts

- Deep-clone each tool definition before preparation; never mutate server-returned definitions.
- Preserve `ListToolsResult` metadata and each original definition `name`.
- Use the same `MCPClient` for `listTools()` and `toolsFromDefinitions()`. The SDK execute closure must continue sending
  the raw definition name in `tools/call`; TakiAgent namespacing changes only the model-facing record key.
- Narrow an optional nullable property only when all conditions hold:
  - the property is not present in its containing object's valid `required` array;
  - the nullable encoding is exactly `anyOf: [T, null]`, `oneOf: [T, null]`, or `type: [T, "null"]`;
  - the retained branch has one explicit non-null string `type`;
  - the wrapper default is absent or `null`;
  - an `anyOf`/`oneOf` wrapper contains no validation keywords beyond the union, `title`, `description`, and `default`.
- Preserve retained-branch constraints. Wrapper `title` and `description` take precedence. Remove `default: null` from
  both the wrapper and retained branch after narrowing.
- Leave schemas outside the recognized nullable class structurally unchanged.
- Reject only the incompatible tool; keep its same-server siblings available.
- Log one warning with only `server`, `toolName`, `code`, and `path`. Never log schema bodies, descriptions, MCP
  configuration, headers, or secrets.
- New compatibility transformations require a reproduced provider failure, a semantics-preservation argument, and
  focused fixtures. Do not add provider-name branches or retry a rejected request with a looser schema.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Optional exact `T + null`, explicit single `T.type`, absent/null default | Narrow to `T`; keep property optional |
| Required nullable property | Skip tool: `REQUIRED_NULLABLE_UNSUPPORTED` at the property path |
| Nullable root or array item | Skip tool: `NULL_UNSUPPORTED` at the exact path |
| Null-only schema | Skip tool: `NULL_UNSUPPORTED` |
| Multiple non-null branches or retained branch without one explicit type | Skip tool: `UNION_UNSUPPORTED` |
| Nullable combinator wrapper with extra validation keywords | Skip tool: `UNION_UNSUPPORTED` |
| Wrapper default is non-null | Skip tool: `DEFAULT_TYPE_MISMATCH` |
| `required` is not a unique string array of own property names | Skip tool: `MALFORMED_REQUIRED` |
| Ordinary non-null union or multi-type schema | Preserve unchanged; no unsupported general conversion is implied |

Required-name membership must use an own-property check. Prototype names such as `toString` are not declared schema
properties.

## 5. Good / Base / Bad Cases

**Good - portable optional-nullable narrowing:**

```json
{
  "properties": {
    "time_range": {
      "anyOf": [
        { "type": "string", "enum": ["day", "week", "month", "year"] },
        { "type": "null" }
      ],
      "default": null
    }
  }
}
```

The model-facing property becomes the same optional string enum without the nullable wrapper or null default.

**Base - unrelated schema:** a non-nullable object, ordinary non-null union, or other non-target schema remains deeply
equal after preparation; only the definition clone identity changes.

**Bad - semantics would change:** required nullable values, nullable array elements, `$ref + null`, multi-type retained
branches, malformed `required`, or a non-null wrapper default omit that tool and produce a structured warning.

## 6. Tests Required

- Pure unit fixtures for `anyOf`, `oneOf`, and `type: [T, "null"]` narrowing.
- Input immutability plus idempotence for both transformed and unchanged definitions.
- Rejection fixtures for every validation-matrix row, including `$ref + null`, retained multi-type branches, nested
  required sets, and prototype-name `required` entries.
- An in-memory MCP integration fixture with good/bad/good definitions from one server. Assert only bad is omitted,
  warnings contain no schema text, and surviving calls send raw MCP names.
- A fake-fetch OpenAI-compatible provider boundary test. Assert actual request `tools[].function.parameters`,
  namespaced model-facing names, retained ordinary schema, and SDK-added `additionalProperties: false`.
- Existing real stdio and Streamable HTTP MCP tests must remain green.

## 7. Wrong vs Correct

### Wrong

```typescript
// One provider-hostile definition can poison the complete request.
const tools = await client.tools();

// Picking an arbitrary union branch silently changes the remote tool contract.
const schema = input.anyOf?.[0] ?? input;
```

### Correct

```typescript
const listed = await client.listTools();
const prepared = prepareMcpToolDefinitions(listed);
for (const issue of prepared.skipped) {
  log.warn({ server, ...issue }, "mcp tool schema incompatible; skipped");
}
const tools = client.toolsFromDefinitions(prepared.definitions);
```

Only a verified, semantics-preserving nullable rule may rewrite a definition; every other recognized unsafe nullable
shape is isolated at tool granularity.

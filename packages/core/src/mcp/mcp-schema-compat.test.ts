import type { ListToolsResult } from "@ai-sdk/mcp";
import { describe, expect, it } from "vitest";
import { prepareMcpToolDefinitions } from "./mcp-schema-compat.ts";

const TAVILY_SEARCH = {
  name: "search",
  description: "Search the web for current information on any topic.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Search query." },
      time_range: {
        anyOf: [
          { type: "string", enum: ["day", "week", "month", "year"] },
          { type: "null" },
        ],
        title: "Time range",
        description: "Optional recency range.",
        default: null,
      },
    },
    required: ["query"],
  },
} satisfies ListToolsResult["tools"][number];

describe("prepareMcpToolDefinitions", () => {
  it("narrows the observed optional Tavily nullable enum to an optional scalar", () => {
    const source = { tools: [TAVILY_SEARCH] };
    const snapshot = structuredClone(source);
    const result = prepareMcpToolDefinitions(source);
    const repeated = prepareMcpToolDefinitions(result.definitions);

    expect(result.skipped).toEqual([]);
    expect(result.definitions.tools[0]?.inputSchema.properties?.time_range).toEqual({
      type: "string",
      enum: ["day", "week", "month", "year"],
      title: "Time range",
      description: "Optional recency range.",
    });
    expect(result.definitions.tools[0]?.inputSchema.required).toEqual(["query"]);
    expect(repeated).toEqual({ definitions: result.definitions, skipped: [] });
    expect(source).toEqual(snapshot);
  });

  it("applies the same rule to an optional oneOf nullable property", () => {
    const result = prepareMcpToolDefinitions({
      tools: [
        {
          name: "one_of",
          inputSchema: {
            type: "object",
            properties: {
              value: {
                oneOf: [{ type: "integer", minimum: 1, description: "Branch description." }, { type: "null" }],
                description: "Wrapper description.",
              },
            },
          },
        },
      ],
    });

    expect(result.definitions.tools[0]?.inputSchema.properties?.value).toEqual({
      type: "integer",
      minimum: 1,
      description: "Wrapper description.",
    });
  });

  it("collapses an optional two-member type array without losing constraints", () => {
    const result = prepareMcpToolDefinitions({
      tools: [
        {
          name: "type_array",
          inputSchema: {
            type: "object",
            properties: {
              value: { type: ["string", "null"], minLength: 2, description: "Optional value.", default: null },
            },
          },
        },
      ],
    });

    expect(result.definitions.tools[0]?.inputSchema.properties?.value).toEqual({
      type: "string",
      minLength: 2,
      description: "Optional value.",
    });
  });

  it("deep-clones ordinary definitions without changing them and is idempotent", () => {
    const definitions: ListToolsResult = {
      _meta: { trace: "kept" },
      tools: [
        {
          name: "ordinary",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", minLength: 1 },
              limit: { type: "integer", minimum: 1, maximum: 10 },
              choice: { anyOf: [{ type: "string" }, { type: "integer" }] },
              multi_type: { type: ["string", "integer"] },
              options: {
                type: "object",
                properties: { enabled: { type: "boolean" } },
                required: ["enabled"],
              },
            },
            required: ["query"],
          },
        },
      ],
    };
    const snapshot = structuredClone(definitions);

    const first = prepareMcpToolDefinitions(definitions);
    const second = prepareMcpToolDefinitions(first.definitions);

    expect(first).toEqual({ definitions: snapshot, skipped: [] });
    expect(second).toEqual(first);
    expect(definitions).toEqual(snapshot);
    expect(first.definitions.tools[0]).not.toBe(definitions.tools[0]);
    expect(first.definitions.tools[0]?.inputSchema).not.toBe(definitions.tools[0]?.inputSchema);
  });

  it("rejects a required nullable property instead of changing requiredness", () => {
    const result = prepareMcpToolDefinitions({
      tools: [
        {
          name: "required_nullable",
          inputSchema: {
            type: "object",
            properties: { value: { anyOf: [{ type: "string" }, { type: "null" }] } },
            required: ["value"],
          },
        },
      ],
    });

    expect(result.definitions.tools).toEqual([]);
    expect(result.skipped).toEqual([
      {
        toolName: "required_nullable",
        code: "REQUIRED_NULLABLE_UNSUPPORTED",
        path: "$.properties.value",
      },
    ]);
  });

  it("rejects nullable array items because an item cannot be omitted", () => {
    const result = prepareMcpToolDefinitions({
      tools: [
        {
          name: "nullable_items",
          inputSchema: {
            type: "object",
            properties: {
              values: { type: "array", items: { oneOf: [{ type: "string" }, { type: "null" }] } },
            },
          },
        },
      ],
    });

    expect(result.definitions.tools).toEqual([]);
    expect(result.skipped).toEqual([
      { toolName: "nullable_items", code: "NULL_UNSUPPORTED", path: "$.properties.values.items" },
    ]);
  });

  it("rejects a nullable genuine multi-type property instead of choosing a branch", () => {
    const result = prepareMcpToolDefinitions({
      tools: [
        {
          name: "genuine_union",
          inputSchema: {
            type: "object",
            properties: { value: { type: ["string", "integer", "null"] } },
          },
        },
      ],
    });

    expect(result.definitions.tools).toEqual([]);
    expect(result.skipped).toEqual([
      { toolName: "genuine_union", code: "UNION_UNSUPPORTED", path: "$.properties.value" },
    ]);
  });

  it("rejects a nullable wrapper whose retained branch has no explicit type", () => {
    const result = prepareMcpToolDefinitions({
      tools: [
        {
          name: "nullable_ref",
          inputSchema: {
            type: "object",
            properties: { value: { anyOf: [{ $ref: "#/$defs/Value" }, { type: "null" }] } },
            $defs: { Value: { type: "string" } },
          },
        },
      ],
    });

    expect(result.definitions.tools).toEqual([]);
    expect(result.skipped).toEqual([
      { toolName: "nullable_ref", code: "UNION_UNSUPPORTED", path: "$.properties.value" },
    ]);
  });

  it("rejects a nullable wrapper whose retained branch has multiple types", () => {
    const result = prepareMcpToolDefinitions({
      tools: [
        {
          name: "nullable_branch_union",
          inputSchema: {
            type: "object",
            properties: {
              value: { oneOf: [{ type: ["string", "integer"] }, { type: "null" }] },
            },
          },
        },
      ],
    });

    expect(result.definitions.tools).toEqual([]);
    expect(result.skipped).toEqual([
      { toolName: "nullable_branch_union", code: "UNION_UNSUPPORTED", path: "$.properties.value" },
    ]);
  });

  it("rejects a null-only property with its exact schema path", () => {
    const result = prepareMcpToolDefinitions({
      tools: [
        {
          name: "null_only",
          inputSchema: { type: "object", properties: { value: { type: "null" } } },
        },
      ],
    });

    expect(result.definitions.tools).toEqual([]);
    expect(result.skipped).toEqual([
      { toolName: "null_only", code: "NULL_UNSUPPORTED", path: "$.properties.value" },
    ]);
  });

  it("rejects malformed required declarations encountered during traversal", () => {
    const result = prepareMcpToolDefinitions({
      tools: [
        {
          name: "malformed_required",
          inputSchema: {
            type: "object",
            properties: {
              nested: {
                type: "object",
                properties: { present: { type: "string" } },
                required: ["missing"],
              },
            },
          },
        },
      ],
    });

    expect(result.definitions.tools).toEqual([]);
    expect(result.skipped).toEqual([
      {
        toolName: "malformed_required",
        code: "MALFORMED_REQUIRED",
        path: "$.properties.nested.required",
      },
    ]);
  });

  it("rejects malformed required even when the object has no properties map", () => {
    const result = prepareMcpToolDefinitions({
      tools: [{ name: "bad_required_shape", inputSchema: { type: "object", required: "value" } }],
    });

    expect(result.definitions.tools).toEqual([]);
    expect(result.skipped).toEqual([
      { toolName: "bad_required_shape", code: "MALFORMED_REQUIRED", path: "$.required" },
    ]);
  });

  it("rejects a nullable construct at the input-schema root", () => {
    const result = prepareMcpToolDefinitions({
      tools: [
        {
          name: "nullable_root",
          inputSchema: {
            type: "object",
            anyOf: [{ type: "object", properties: {} }, { type: "null" }],
          },
        },
      ],
    });

    expect(result.definitions.tools).toEqual([]);
    expect(result.skipped).toEqual([{ toolName: "nullable_root", code: "NULL_UNSUPPORTED", path: "$" }]);
  });

  it("rejects a recognized nullable wrapper with a non-null default", () => {
    const result = prepareMcpToolDefinitions({
      tools: [
        {
          name: "nullable_default",
          inputSchema: {
            type: "object",
            properties: {
              value: { anyOf: [{ type: "string" }, { type: "null" }], default: "fallback" },
            },
          },
        },
      ],
    });

    expect(result.definitions.tools).toEqual([]);
    expect(result.skipped).toEqual([
      { toolName: "nullable_default", code: "DEFAULT_TYPE_MISMATCH", path: "$.properties.value" },
    ]);
  });

  it("removes a null default inherited from the retained non-null branch", () => {
    const result = prepareMcpToolDefinitions({
      tools: [
        {
          name: "branch_null_default",
          inputSchema: {
            type: "object",
            properties: {
              value: { anyOf: [{ type: "string", default: null }, { type: "null" }] },
            },
          },
        },
      ],
    });

    expect(result.skipped).toEqual([]);
    expect(result.definitions.tools[0]?.inputSchema.properties?.value).toEqual({ type: "string" });
  });

  it("does not accept inherited object prototype names as declared properties", () => {
    const result = prepareMcpToolDefinitions({
      tools: [
        {
          name: "prototype_required",
          inputSchema: { type: "object", properties: {}, required: ["toString"] },
        },
      ],
    });

    expect(result.definitions.tools).toEqual([]);
    expect(result.skipped).toEqual([
      { toolName: "prototype_required", code: "MALFORMED_REQUIRED", path: "$.required" },
    ]);
  });

  it("rejects a nullable combinator wrapper with extra validation constraints", () => {
    const result = prepareMcpToolDefinitions({
      tools: [
        {
          name: "constrained_wrapper",
          inputSchema: {
            type: "object",
            properties: {
              value: { anyOf: [{ type: "string" }, { type: "null" }], minLength: 2 },
            },
          },
        },
      ],
    });

    expect(result.definitions.tools).toEqual([]);
    expect(result.skipped).toEqual([
      { toolName: "constrained_wrapper", code: "UNION_UNSUPPORTED", path: "$.properties.value" },
    ]);
  });

  it("uses each nested object's required set when preparing nullable properties", () => {
    const result = prepareMcpToolDefinitions({
      tools: [
        {
          name: "nested",
          inputSchema: {
            type: "object",
            properties: {
              options: {
                anyOf: [
                  {
                    type: "object",
                    properties: {
                      fixed: { type: "string" },
                      note: { oneOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
                    },
                    required: ["fixed"],
                  },
                  { type: "null" },
                ],
              },
            },
          },
        },
      ],
    });

    expect(result.skipped).toEqual([]);
    expect(result.definitions.tools[0]?.inputSchema.properties?.options).toEqual({
      type: "object",
      properties: {
        fixed: { type: "string" },
        note: { type: "string", minLength: 1 },
      },
      required: ["fixed"],
    });
  });
});

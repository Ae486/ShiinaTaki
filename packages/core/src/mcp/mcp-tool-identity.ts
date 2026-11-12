/**
 * INPUT:  raw MCP server keys, sanitized public configs, and AI SDK Tool closures from toolsFromDefinitions
 * OUTPUT: sanitizeKey + stableSubjectId + publicConfigFingerprint + wrapExecute — collision-safe presentation
 *         identity plus a fixed-message model-facing call failure boundary
 * POS:    core/mcp — presentation keys are never authority keys; the subject sidecar is the stable binding
 */
import { createHash } from "node:crypto";
import type { Tool } from "ai";
import type { McpServerConfig } from "@taki/shared";
import { mcpPublicConfig } from "./mcp-config.ts";

/** The raw MCP identity behind a namespaced ToolSet key; the presentation key is never an authority key. */
export interface McpToolRef {
  serverName: string;
  toolName: string;
  subjectId: string;
  subjectRevision: string;
}

/** Model-facing error envelope for a failed MCP call (error-handling spec; the model reads code + message). */
type McpToolFailure = { ok: false; code: number | string; message: string };

export function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** The stable governance subject for one server/tool binding: opaque, log-safe, key-collision-proof. */
export function stableSubjectId(serverKey: string, toolName: string): string {
  return `mcp.${createHash("sha256").update(`${serverKey}\u0000${toolName}`).digest("hex")}`;
}

/** Secret-free config fingerprint used only to invalidate transitional governance subject revisions. */
export function publicConfigFingerprint(config: McpServerConfig): string {
  return `cfg.${createHash("sha256").update(JSON.stringify(mcpPublicConfig(config))).digest("hex")}`;
}

// Spread-and-replace: keep the tool's schema/metadata/toModelOutput, only guard execute so a JSON-RPC error or a
// dropped connection becomes a structured {ok:false} the model can read. isError:true passes through.
export function wrapExecute(tool: Tool): Tool {
  const inner = tool.execute;
  if (typeof inner !== "function") return tool;
  return {
    ...tool,
    execute: async (input, options) => {
      try {
        return await inner(input, options);
      } catch (error) {
        if (options.abortSignal?.aborted) return { ok: false, code: "CANCELLED", message: "MCP tool call was cancelled" } satisfies McpToolFailure;
        return { ok: false, code: errorCode(error), message: "MCP tool call failed" } satisfies McpToolFailure;
      }
    },
  } as Tool;
}

// MCPClientError carries the JSON-RPC error code as a numeric `.code` (verified against installed mcp-client-error.ts);
// duck-typed to avoid importing an unexported class.
function errorCode(error: unknown): number | string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "number") return code;
  }
  return "MCP_CALL_FAILED";
}

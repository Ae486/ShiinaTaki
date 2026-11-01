/**
 * INPUT:  one immutable ExtensionRegistry captured for an Agent Run
 * OUTPUT: createExtensionTools() -> bounded informational discover/describe/call ToolSet
 * POS:    core/extensions — thin AI SDK bridge; execution stays in the registry's sealed governed binding
 */
import { tool, type ToolSet } from "ai";
import {
  ExtensionCallParamsSchema,
  ExtensionDescribeParamsSchema,
  ExtensionDiscoverParamsSchema,
} from "@taki/shared";
import type { ExtensionRegistry } from "./extension-registry.ts";
import { extensionDescribeModelOutput, extensionDiscoverModelOutput } from "./extension-tool-model-output.ts";

export function createExtensionTools(registry: ExtensionRegistry): ToolSet {
  const multiHost = new Set([registry.snapshot.primaryHostId, ...registry.snapshot.hosts.map((host) => host.hostId),
    ...registry.snapshot.entries.map((entry) => entry.identity.ownerHostId)]).size > 1;
  return {
    extension_discover: tool({
      description: "Search bounded metadata for extensions captured at the start of this Run. Use returned extensionId with extension_describe to reveal a current integration's direct tool on the next model step. Results preserve availability and Host ownership where routing needs disambiguation. Truncated means incomplete: there is no cursor or eager fallback for overflow entries in this Run.",
      inputSchema: ExtensionDiscoverParamsSchema,
      execute: (input) => registry.discover(input),
      toModelOutput: ({ output }) => extensionDiscoverModelOutput(output, multiHost),
    }),
    extension_describe: tool({
      description: "Describe one extensionId returned by extension_discover without changing its captured owner or generation. For an available, current MCP binding, toolName identifies the exact direct tool made available on the next model step. The result contains bounded metadata, not a duplicate parameter schema; use that direct tool after it is disclosed. Unknown, unavailable, or stale entries disclose no toolName; extension_call remains the sealed compatibility bridge.",
      inputSchema: ExtensionDescribeParamsSchema,
      execute: (input) => registry.describe(input),
      toModelOutput: ({ output }) => extensionDescribeModelOutput(output, multiHost),
    }),
    extension_call: tool({
      description: "Call one extension from this Run snapshot through its sealed governed binding. Unknown, unavailable, or stale ids fail closed and are never redirected.",
      inputSchema: ExtensionCallParamsSchema,
      execute: (input, options) => registry.call(input, options),
      toModelOutput: registry.modelCallOutput,
    }),
  };
}

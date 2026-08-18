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

export function createExtensionTools(registry: ExtensionRegistry): ToolSet {
  return {
    extension_discover: tool({
      description: "Search bounded metadata for extensions captured at the start of this Run. Results are descriptive only and include sealed Host ownership.",
      inputSchema: ExtensionDiscoverParamsSchema,
      execute: (input) => registry.discover(input),
    }),
    extension_describe: tool({
      description: "Describe one extension id returned by extension_discover without changing its captured owner or generation.",
      inputSchema: ExtensionDescribeParamsSchema,
      execute: (input) => registry.describe(input),
    }),
    extension_call: tool({
      description: "Call one extension from this Run snapshot through its sealed governed binding. Unknown, unavailable, or stale ids fail closed and are never redirected.",
      inputSchema: ExtensionCallParamsSchema,
      execute: (input, options) => registry.call(input, options),
    }),
  };
}

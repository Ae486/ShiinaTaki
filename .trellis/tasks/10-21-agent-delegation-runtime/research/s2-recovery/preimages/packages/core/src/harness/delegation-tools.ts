/**
 * INPUT: actual assembled tools, trusted parent scope, work role and optional narrowing
 * OUTPUT: immutable executable subset and read-only child Memory projection
 * POS: core/harness — tool membership only; existing canonical governance still authorizes execution
 */
import type { ToolSet } from "ai";
import type { SubagentToolSelection, SubagentWorkScope } from "@taki/shared";
import { coreToolCapability } from "../governance/core-tool-governance-adapter.ts";
import { memoryEffectMetadata } from "../memory/canonical-tools/memory-effect-tool.ts";

const MEMORY_WRITES = new Set(["core.memory.write", "core.memory.archive"]);
export const WORK_COLLECTOR_TOOLS = ["complete_subagent", "finish_parent_continuation"] as const;

export function isMemoryMutation(name: string, tool: ToolSet[string]): boolean {
  const memory = memoryEffectMetadata(tool);
  return memory ? memory.operation !== "recall" && memory.operation !== "reflect"
    : MEMORY_WRITES.has(coreToolCapability(name, tool) ?? "");
}

export function projectChildMemory(tools: ToolSet): ToolSet {
  return Object.freeze(Object.fromEntries(Object.entries(tools).filter(([name, tool]) => !isMemoryMutation(name, tool))));
}

export function resolveDelegationTools(input: {
  tools: ToolSet; parentNames: readonly string[]; scope: SubagentWorkScope; selection?: SubagentToolSelection;
}): ToolSet {
  const parentNames = new Set([...input.parentNames, ...WORK_COLLECTOR_TOOLS]);
  const requested = input.selection?.mode === "allow" ? input.selection.names : undefined;
  const exclusions = input.selection?.mode === "inherit" ? new Set(input.selection.excludeNames) : new Set<string>();
  if (requested?.some((name) => !Object.hasOwn(input.tools, name) || !parentNames.has(name))) {
    throw new Error("SUBAGENT_TOOL_UNAVAILABLE");
  }
  if ([...exclusions].some((name) => !parentNames.has(name))) throw new Error("SUBAGENT_TOOL_UNAVAILABLE");
  return Object.freeze(Object.fromEntries(Object.entries(input.tools).filter(([name, tool]) =>
    parentNames.has(name) && (requested === undefined || requested.includes(name)) && !exclusions.has(name)
    && (input.scope.kind !== "subagent" || !isMemoryMutation(name, tool)))));
}

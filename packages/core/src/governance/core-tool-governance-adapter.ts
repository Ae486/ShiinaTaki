/**
 * INPUT:  trusted Core ToolSet keys, stable Core Host identity, and GovernancePolicyService
 * OUTPUT: createCoreToolGovernanceAdapter(...).wrap(tools) with explicit canonical bindings for Core-local tools
 * POS:    core/governance — Core adapter only; MCP/Skill/Host adapters retain their own trusted identity sidecars
 */
import type { ToolSet } from "ai";
import type { GovernancePolicyService } from "./governance-policy-service.ts";
import type { ApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import type { Connection } from "../server/connection-registry.ts";
import { wrapGovernedTool, type GovernedToolBinding } from "./governed-tool.ts";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";

const CORE_TOOL_BINDINGS: Record<string, Omit<GovernedToolBinding["identity"], "ownerHostId"> & { cellKey: string }> = {
  get_current_time: { capabilityId: "core.time.read", cellKey: "get-current-time" },
  memory_search: { capabilityId: "core.memory.search", cellKey: "memory-search" },
  memory_write: { capabilityId: "core.memory.write", cellKey: "memory-write" },
  memory_archive: { capabilityId: "core.memory.archive", cellKey: "memory-archive" },
  recall: { capabilityId: "core.memory.search", cellKey: "memory-search" },
  reflect: { capabilityId: "core.memory.search", cellKey: "memory-search" },
  retain: { capabilityId: "core.memory.write", cellKey: "memory-write" },
  update_memory: { capabilityId: "core.memory.write", cellKey: "memory-write" },
  restore_memory: { capabilityId: "core.memory.write", cellKey: "memory-write" },
  invalidate_memory: { capabilityId: "core.memory.archive", cellKey: "memory-archive" },
  avatar_set_expression: { capabilityId: "core.avatar.expression", cellKey: "avatar-set-expression" },
  avatar_play_motion: { capabilityId: "core.avatar.motion", cellKey: "avatar-play-motion" },
  read_file: { capabilityId: "workspace.file.read", cellKey: "workspace-read" },
  write_file: { capabilityId: "fs-write", cellKey: "fs-write:in-workspace" },
};

export interface CoreToolGovernanceAdapter {
  wrap(tools: ToolSet, interactive?: { connection: Connection; signal?: AbortSignal; runId?: string; attemptId?: string; effects?: EffectLifecycleService }): ToolSet;
}

export function createCoreToolGovernanceAdapter(
  service: GovernancePolicyService,
  ownerHostId: string,
  approval?: ApprovalInteractionService,
): CoreToolGovernanceAdapter {
  return {
    wrap(tools, interactive) {
      const wrapped: ToolSet = {};
      for (const [key, tool] of Object.entries(tools)) {
        const binding = CORE_TOOL_BINDINGS[key];
        wrapped[key] = binding
          ? wrapGovernedTool(tool, {
              service,
              binding: { identity: { capabilityId: binding.capabilityId, ownerHostId }, cellKey: binding.cellKey },
              interactive: interactive && approval
                ? { ...interactive, approval, presentation: corePresentation(key) }
                : undefined,
            })
          : closeUnknownCoreTool(tool, key);
      }
      return wrapped;
    },
  };
}

function corePresentation(key: string) {
  return {
    revision: 1 as const,
    title: "Allow Core tool",
    capabilityLabel: key,
    riskSummary: "This Core tool requires operator approval under the active governance policy.",
    sections: [{ title: "Action", fields: [{ label: "Tool", value: key }] }],
  };
}

function closeUnknownCoreTool(tool: ToolSet[string], key: string): ToolSet[string] {
  if (typeof tool.execute !== "function") return tool;
  return {
    ...tool,
    execute: async () => ({
      ok: false,
      code: "GOVERNANCE_DENIED",
      message: `Core tool '${key}' has no canonical governance binding`,
    }),
  } as ToolSet[string];
}

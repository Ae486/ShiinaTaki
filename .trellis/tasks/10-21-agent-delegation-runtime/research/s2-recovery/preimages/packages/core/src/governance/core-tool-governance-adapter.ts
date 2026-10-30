/**
 * INPUT:  trusted Core ToolSet keys, stable Core Host identity, and GovernancePolicyService
 * OUTPUT: explicitly bound Core-local tools with shared readable approval names
 * POS:    core/governance — Core adapter only; MCP/Skill/Host adapters retain their own trusted identity sidecars
 */
import type { ToolSet } from "ai";
import { APPROVAL_PRESENTATION_REVISION, getKnownToolDisplayName, type ApprovalPresentation } from "@taki/shared";
import type { GovernancePolicyService } from "./governance-policy-service.ts";
import type { ApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import type { Connection } from "../server/connection-registry.ts";
import { wrapGovernedTool, type GovernedEffectContext, type GovernedToolBinding } from "./governed-tool.ts";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { memoryEffectMetadata } from "../memory/canonical-tools/memory-effect-tool.ts";
import { createHash } from "node:crypto";
import type { ToolEffectObserver } from "../observability/tool-effect-observer.ts";

const CORE_TOOL_BINDINGS: Record<string, Omit<GovernedToolBinding["identity"], "ownerHostId"> & { cellKey: string }> = {
  heartbeat_respond: { capabilityId: "core.initiative.decide", cellKey: "initiative-decide" },
  delegate_subagent: { capabilityId: "core.subagent.manage", cellKey: "subagent-manage" },
  send_subagent_message: { capabilityId: "core.subagent.manage", cellKey: "subagent-manage" },
  stop_subagent: { capabilityId: "core.subagent.manage", cellKey: "subagent-manage" },
  inspect_subagent: { capabilityId: "core.subagent.read", cellKey: "subagent-read" },
  complete_subagent: { capabilityId: "core.subagent.result", cellKey: "subagent-result" },
  finish_parent_continuation: { capabilityId: "core.subagent.result", cellKey: "subagent-result" },
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
  schedule_task: { capabilityId: "core.schedule.manage", cellKey: "schedule-manage" },
  manage_interaction_pattern: { capabilityId: "core.initiative.pattern.manage", cellKey: "interaction-pattern-manage" },
  plan_follow_up: { capabilityId: "core.initiative.intention.plan", cellKey: "intention-plan" },
  manage_co_watching: { capabilityId: "core.co-watching.manage", cellKey: "co-watching-manage" },
  manage_media_recommendations: { capabilityId: "core.co-watching.manage", cellKey: "co-watching-manage" },
};

export interface CoreToolGovernanceAdapter {
  wrap(tools: ToolSet, interactive?: { connection?: Connection; signal?: AbortSignal; runId?: string; attemptId?: string; effects?: EffectLifecycleService; toolObserver?: ToolEffectObserver }): ToolSet;
}

/** Classify the actual Memory operation before falling back to the trusted Core registry name. */
export function coreToolCapability(name: string, tool: ToolSet[string]): string | undefined {
  const operation = memoryEffectMetadata(tool)?.operation;
  if (operation === "recall" || operation === "reflect") return "core.memory.search";
  if (operation === "invalidate") return "core.memory.archive";
  if (operation) return "core.memory.write";
  return CORE_TOOL_BINDINGS[name]?.capabilityId;
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
        const memory = memoryEffectMetadata(tool);
        const capability = coreToolCapability(key, tool);
        const binding = memory && capability ? { capabilityId: capability,
          cellKey: capability === "core.memory.search" ? "memory-search" : capability === "core.memory.archive" ? "memory-archive" : "memory-write" }
          : CORE_TOOL_BINDINGS[key];
        wrapped[key] = binding
          ? wrapGovernedTool(tool, {
              service,
              approval,
              binding: { identity: { capabilityId: binding.capabilityId, ownerHostId }, cellKey: binding.cellKey,
                effect: memory ? { kind: "memory" as const, replayPosture: memory.replayPosture,
                  sourceRef: (_input, effectId) => ({ type: "memory" as const, requestId: effectId, authorityEpoch: memory.authorityEpochId, providerId: memory.providerId, providerLineageId: memory.providerLineageId, capabilityDigest: memory.capabilityDigest, operation: memory.operation }),
                  executorRef: { type: "memory" as const, authorityEpoch: memory.authorityEpochId, providerId: memory.providerId, providerLineageId: memory.providerLineageId, capabilityDigest: memory.capabilityDigest },
                   capturedGenerationRef: memory.authorityEpochId, inputDigest: (input) => digestMemoryInput(input) } : undefined },
              effect: effectContext(interactive),
              interactive: interactive?.connection && approval
                ? { connection: interactive.connection, signal: interactive.signal, runId: interactive.runId,
                    attemptId: interactive.attemptId, effects: interactive.effects, approval,
                    toolObserver: interactive.toolObserver, presentation: corePresentation(key) }
                : undefined,
            })
          : closeUnknownCoreTool(tool, key);
      }
      return wrapped;
    },
  };
}

function effectContext(interactive: { runId?: string; attemptId?: string; effects?: EffectLifecycleService; toolObserver?: ToolEffectObserver; signal?: AbortSignal } | undefined): GovernedEffectContext | undefined {
  return interactive?.runId && interactive.attemptId && interactive.effects
    ? { runId: interactive.runId, attemptId: interactive.attemptId, effects: interactive.effects, toolObserver: interactive.toolObserver, signal: interactive.signal }
    : undefined;
}

function digestMemoryInput(input: unknown): string {
  return createHash("sha256").update(canonicalJson(input), "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`; }
  throw new Error("memory input is not JSON-compatible");
}

function corePresentation(key: string): ApprovalPresentation {
  const name = getKnownToolDisplayName(key) ?? "内置工具";
  return {
    revision: APPROVAL_PRESENTATION_REVISION,
    title: "确认使用内置工具",
    capabilityLabel: name,
    riskSummary: "此内置工具将执行所请求的操作，当前权限设置要求先获得你的确认。",
    sections: [{ title: "操作内容", fields: [{ label: "工具", value: name }] }],
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

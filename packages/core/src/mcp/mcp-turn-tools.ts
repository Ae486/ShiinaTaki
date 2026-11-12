/**
 * INPUT: active runtime generations, canonical policy/durable Approval, and optional interactive turn context
 * OUTPUT: governed captured tools with readable interactive asks, unattended durable checks and generation leases
 * POS: core/mcp turn assembly; retired generations fail closed and captured snapshots never redirect
 */
import type { Tool, ToolSet } from "ai";
import { APPROVAL_PRESENTATION_REVISION, getCapabilityLabel, type ApprovalPresentation } from "@taki/shared";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import { wrapGovernedTool, type GovernedDispatchLease, type InteractiveGovernanceContext } from "../governance/governed-tool.ts";
import { acquireLease, releaseLease, type GenerationRecord } from "./mcp-generations.ts";
import type { McpToolRef } from "./mcp-tool-identity.ts";
import { withMcpImageProjection } from "./mcp-image-result.ts";

export type TurnInteractive = Omit<InteractiveGovernanceContext, "presentation" | "approval">;

export interface TurnGovernance {
  service: GovernancePolicyService;
  ownerHostId: string;
  approval?: InteractiveGovernanceContext["approval"];
  legacyDeny?: (serverName: string, toolName: string) => boolean;
}

/** Model-facing stale-generation envelope: the same {ok:false} shape the model already reads. */
const RETIRED_MESSAGE = "the captured MCP server generation retired before this call; the next turn sees the replacement";
const UNKNOWN_OUTCOME_MESSAGE = "the MCP connection closed after dispatch; the remote side-effect outcome is unknown";

export function buildTurnTools(
  active: ReadonlyMap<string, GenerationRecord>,
  context: { governance?: TurnGovernance; interactive?: TurnInteractive; projectImageResult?: (result: unknown) => unknown },
): ToolSet {
  const { governance, interactive } = context;
  const wrapped: ToolSet = {};
  for (const record of active.values()) {
    for (const [key, tool] of Object.entries(record.tools)) {
      const ref = record.refs.get(key);
      if (!ref) continue;
      const governed = governance
        ? wrapGovernedTool(tool, {
            service: governance.service,
            binding: mcpBinding(governance, record, ref),
            approval: governance.approval,
            interactive: governance.approval && interactive
              ? lateBoundInteractive(interactive, governance.approval, mcpPresentation(ref))
              : undefined,
            dispatchLease: generationLease(record),
          })
        : withLease(record, tool);
      wrapped[key] = withMcpImageProjection(governed, context.projectImageResult);
    }
  }
  return wrapped;
}

function lateBoundInteractive(
  interactive: TurnInteractive,
  approval: NonNullable<TurnGovernance["approval"]>,
  presentation: ReturnType<typeof mcpPresentation>,
): InteractiveGovernanceContext {
  return {
    approval,
    connection: interactive.connection,
    signal: interactive.signal,
    presentation,
    get runId() { return interactive.runId; },
    get attemptId() { return interactive.attemptId; },
    get effects() { return interactive.effects; },
    get toolObserver() { return interactive.toolObserver; },
  };
}

// Governance/Approval wraps this leased closure, so the lease is acquired only after final revalidation and released
// after the exact captured generation settles. A retired generation never redirects to its replacement.
function withLease(record: GenerationRecord, tool: Tool): Tool {
  const execute = tool.execute;
  if (typeof execute !== "function") return tool;
  return {
    ...tool,
    execute: async (input, options) => {
      if (!acquireLease(record)) {
        return { ok: false, code: "MCP_STALE_GENERATION", message: RETIRED_MESSAGE };
      }
      try {
        const result = await execute(input, options);
        return record.forcedClosed ? unknownOutcome() : result;
      } catch (error) {
        if (record.forcedClosed) return unknownOutcome();
        throw error;
      } finally {
        releaseLease(record);
      }
    },
  } as Tool;
}

function unknownOutcome() {
  return { ok: false as const, code: "OUTCOME_UNKNOWN" as const, message: UNKNOWN_OUTCOME_MESSAGE, state: "outcome_unknown" as const };
}

function generationLease(record: GenerationRecord): GovernedDispatchLease {
  return {
    acquire: () => acquireLease(record),
    release: () => releaseLease(record),
    unavailable: { ok: false, code: "MCP_STALE_GENERATION", message: RETIRED_MESSAGE },
    acceptResult: (result) => record.forcedClosed ? unknownOutcome() : result,
  };
}

function mcpBinding(governance: TurnGovernance, record: GenerationRecord, ref: McpToolRef) {
  return {
    identity: {
      capabilityId: "mcp.tool.call",
      ownerHostId: governance.ownerHostId,
      subject: { subjectId: ref.subjectId, revision: ref.subjectRevision },
    },
    cellKey: "mcp-tool-call",
    denyConstraints: governance.legacyDeny?.(ref.serverName, ref.toolName) ? ["legacy-mcp-deny"] : [],
    effect: {
      sourceRef: { type: "mcp" as const, serverId: record.serverId, generation: record.generation },
      executorRef: { type: "mcp" as const, serverId: record.serverId, generation: record.generation },
      replayPosture: "never" as const,
      capturedGenerationRef: `${record.serverId}:${record.generation}`,
    },
  };
}

function mcpPresentation(ref: McpToolRef): ApprovalPresentation {
  return {
    revision: APPROVAL_PRESENTATION_REVISION,
    title: "确认调用 MCP 工具",
    capabilityLabel: getCapabilityLabel("mcp.tool.call"),
    subjectLabel: ref.serverName,
    riskSummary: "此调用将交给所配置的 MCP 服务器处理，实际影响取决于该工具的功能。",
    sections: [{ title: "调用目标", fields: [
      { label: "服务器", value: ref.serverName },
      { label: "工具", value: ref.toolName },
    ] }],
  };
}

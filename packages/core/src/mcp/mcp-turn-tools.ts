/**
 * INPUT: active runtime generations, governance dependencies, and interactive turn context
 * OUTPUT: governed per-turn tools wrapped by acquire/execute/finally-release generation leases
 * POS: core/mcp turn assembly; retired generations fail closed and captured snapshots never redirect
 */
import type { Tool, ToolSet } from "ai";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import { wrapGovernedTool, type InteractiveGovernanceContext } from "../governance/governed-tool.ts";
import { acquireLease, releaseLease, type GenerationRecord } from "./mcp-generations.ts";
import type { McpToolRef } from "./mcp-tool-identity.ts";

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
  governance: TurnGovernance | undefined,
  interactive: TurnInteractive | undefined,
): ToolSet {
  const wrapped: ToolSet = {};
  for (const record of active.values()) {
    for (const [key, tool] of Object.entries(record.tools)) {
      const ref = record.refs.get(key);
      if (!ref) continue;
      wrapped[key] = withLease(record, governance
        ? wrapGovernedTool(tool, {
            service: governance.service,
            binding: mcpBinding(governance, ref),
            interactive: governance.approval && interactive
              ? { ...interactive, approval: governance.approval, presentation: mcpPresentation(ref) }
              : undefined,
          })
        : tool);
    }
  }
  return wrapped;
}

// The lease wraps the governed execute: acquire -> authorize/execute -> release in finally. A retired generation
// fails closed with the structured envelope (never redirected to the replacement).
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

function mcpBinding(governance: TurnGovernance, ref: McpToolRef) {
  return {
    identity: {
      capabilityId: "mcp.tool.call",
      ownerHostId: governance.ownerHostId,
      subject: { subjectId: ref.subjectId, revision: ref.subjectRevision },
    },
    cellKey: "mcp-tool-call",
    denyConstraints: governance.legacyDeny?.(ref.serverName, ref.toolName) ? ["legacy-mcp-deny"] : [],
  };
}

function mcpPresentation(ref: McpToolRef) {
  return {
    revision: 1 as const,
    title: "Allow MCP tool",
    capabilityLabel: ref.toolName,
    subjectLabel: ref.serverName,
    riskSummary: "This configured MCP tool can access its server with the supplied call.",
    sections: [{ title: "Target", fields: [
      { label: "Server", value: ref.serverName },
      { label: "Tool", value: ref.toolName },
    ] }],
  };
}

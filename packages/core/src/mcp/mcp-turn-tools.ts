/**
 * INPUT:  the active runtime generation records + governance deps + the turn's interactive context
 * OUTPUT: buildTurnTools(active, governance, interactive) — the per-turn ToolSet: every published tool gets the
 *         canonical governance wrapper (Approval/presentation) and an OUTER generation lease (acquire ->
 *         authorize/execute -> release in finally; a retired generation fails closed, never redirects)
 * POS:    core/mcp — the per-turn assembly seam main.ts calls fresh every turn, so a published replacement is
 *         what the NEXT turn sees while an existing turn keeps its captured snapshot
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
        return await execute(input, options);
      } finally {
        releaseLease(record);
      }
    },
  } as Tool;
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

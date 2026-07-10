/**
 * INPUT:  an McpManager (describe), an ApprovalBroker, a DecisionStore + per-turn tool calls
 * OUTPUT: createApprovalGate(deps) -> { decide, denyPending } — a v7 toolApproval decision fn (MCP-only)
 * POS:    core/approval — the seam ToolLoopAgent's toolApproval calls; internal tools bypass, MCP tools ask/remember
 */
import type { ApprovalBroker, ApprovalNotify } from "./approval-broker.ts";
import type { DecisionStore } from "./decision-store.ts";

/** Matches v7's ToolApprovalStatus subset we return (assignable to the SDK type without importing it). */
export type ApprovalStatus = "not-applicable" | "approved" | { type: "denied"; reason: string };

/** The tool-call shape v7 hands the approval fn (structural subset of TypedToolCall). */
export interface ApprovalToolCall {
  toolName: string;
  input: unknown;
}

/** Only the manager surface the gate needs — keeps it decoupled from MCP client internals. */
export interface ApprovalToolResolver {
  describe(toolKey: string): { serverName: string; toolName: string } | undefined;
}

export interface ApprovalGate {
  /** The generic toolApproval fn body: not-applicable for non-MCP tools, else remembered/asked; no notify -> deny (fail-closed). */
  decide(toolCall: ApprovalToolCall, notify?: ApprovalNotify): Promise<ApprovalStatus>;
  /** Deny every pending ask (operator socket closed). */
  denyPending(reason: string): void;
}

export interface ApprovalGateDeps {
  mcp: ApprovalToolResolver;
  broker: ApprovalBroker;
  decisions: DecisionStore;
}

export function createApprovalGate(deps: ApprovalGateDeps): ApprovalGate {
  return {
    async decide(toolCall, notify) {
      // Internal tools (memory_*, load_skill) are not in the MCP set -> no approval (ruling 5).
      const ref = deps.mcp.describe(toolCall.toolName);
      if (!ref) return "not-applicable";

      const remembered = deps.decisions.get(ref.serverName, ref.toolName);
      if (remembered === "always") return "approved";
      if (remembered === "never") return denied("previously denied (never)");

      // Fail-closed: with no notify sink there is no operator to ask — an unremembered MCP tool is denied,
      // never silently executed (a turn without a TurnContext must not become an approval bypass).
      if (!notify) return denied("no operator connected to approve");
      const outcome = await deps.broker.ask({ serverName: ref.serverName, toolName: ref.toolName, input: toolCall.input }, notify);
      deps.decisions.remember(ref.serverName, ref.toolName, outcome);
      return outcome.approved ? "approved" : denied(outcome.reason ?? "denied");
    },
    denyPending(reason) {
      deps.broker.denyAll(reason);
    },
  };
}

function denied(reason: string): ApprovalStatus {
  return { type: "denied", reason };
}

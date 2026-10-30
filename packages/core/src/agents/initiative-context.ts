/**
 * INPUT: immutable selected initiative fragments and explicitly registered read tools
 * OUTPUT: thin request input plus stricter-only advertised and executable tool restrictions
 * POS: core/agents — uses the normal ChatAgent preparation/SDK path without relationship replay
 */
import type { ToolSet } from "ai";
import type { InitiativeSelectedContext } from "@taki/shared";
import type { ReplayProjection } from "./conversation-store.ts";

// Explicit registry membership, never tool-name substring inference. Skill resource reads retain their
// own captured generation/governance wrappers; arbitrary MCP reads are not safe merely by annotation.
const READ_TOOLS = new Set(["get_current_time", "recall", "reflect", "memory_search", "load_skill", "read_skill_resource"]);
export function restrictInitiativeTools(tools: ToolSet, selection: InitiativeSelectedContext): ToolSet {
  const allowed = new Set(selection.allowedToolNames.filter((name) => READ_TOOLS.has(name)));
  allowed.add("heartbeat_respond");
  return Object.fromEntries(Object.entries(tools).filter(([name]) => allowed.has(name)).map(([name, value]) => {
    const execute = value.execute;
    return [name, execute ? { ...value, execute: (input, options) => {
      if (!allowed.has(name) || Date.now() >= Date.parse(selection.manifest.expiresAt)) throw new Error("INITIATIVE_TOOL_REFUSED");
      return execute(input, options);
    } } as ToolSet[string] : value];
  }));
}

export function initiativeReplay(): ReplayProjection {
  return { messages: [], windowStartSeq: 0, measurement: { sourceRows: 0, liveRows: 0, selectedRows: 0,
    summaryTokens: 0, liveTokensBeforeFolds: 0, foldedTokensSaved: 0, historyTokens: 0,
    tokenBoundaryHit: false, sourceBackstopHit: false } };
}

export function initiativeInstructions(selection: InitiativeSelectedContext): string {
  return "Never claim a tool ran or a result was obtained without its matching tool result.\n" +
    "This is a bounded autonomous judgment. Finish with one accepted heartbeat_respond decision. " +
    "Ordinary text is private reasoning output and is not delivered. Silence is always permitted.\n\n" + selection.instructions;
}

/**
 * INPUT: exact child execution, shared terminal-choice slot and completed SDK result witnesses
 * OUTPUT: asynchronous parent messages or an explicit durable needs-input boundary
 * POS: core/agents — informational intrinsic collector; a proposal is not yet an accepted event
 */
import { tool, type StopCondition, type ToolSet } from "ai";
import { SubagentInteractionSchema, type SubagentWorkToken } from "@taki/shared";
import type { SubagentEventRepo } from "../db/subagent-event-repo.ts";
import type { TurnMessage } from "./turn-mapping.ts";
import { hasCollectorResult } from "./subagent-result-tool.ts";

export function createSubagentTerminalChoice() {
  let choice: { attemptId: string; callId: string; kind: "final" | "needs_input" } | undefined;
  return {
    reserve(attemptId: string, callId: string, kind: "final" | "needs_input") {
      if (choice?.attemptId === attemptId) return choice.callId === callId && choice.kind === kind;
      choice = { attemptId, callId, kind }; return true;
    },
    release(attemptId: string, callId: string) {
      if (choice?.attemptId === attemptId && choice.callId === callId) choice = undefined;
    },
  };
}
export type SubagentTerminalChoice = ReturnType<typeof createSubagentTerminalChoice>;

export function createSubagentInteractCollector(input: {
  runId: string; attemptId(): string; token(): SubagentWorkToken; current(): boolean;
  events: SubagentEventRepo; terminal: SubagentTerminalChoice;
}) {
  const pending = new Map<string, { attemptId: string; token: SubagentWorkToken; kind: "message" | "needs_input"; text: string }>();
  let committedWait = false;
  const tools: ToolSet = { interact_parent: tool({
    description: "Send an asynchronous private message to the main Companion using message; independent work can continue. "
      + "Use needs_input only when dependent work must wait for an addressed answer in this same conversation. "
      + "This returns a proposal; Core accepts it with the completed step. Use complete_subagent for a final report.",
    inputSchema: SubagentInteractionSchema,
    execute(candidate, options) {
      if (!input.current()) return { ok: false, code: "SUBAGENT_INTERACTION_STALE" };
      if (candidate.kind === "needs_input" && !input.terminal.reserve(input.attemptId(), options.toolCallId, "needs_input")) {
        return { ok: false, code: "SUBAGENT_TERMINAL_CHOICE_CONFLICT" };
      }
      pending.set(options.toolCallId, { ...candidate, attemptId: input.attemptId(), token: input.token() });
      return { ok: true, proposed: true, accepted: false };
    },
  }) };
  return {
    tools, stop: (() => committedWait) satisfies StopCondition<ToolSet>,
    commit(step: { attemptId: string; stepNumber: number; messages: TurnMessage[] }) {
      let accepted = false;
      for (const [callId, proposal] of pending) {
        if (proposal.attemptId !== step.attemptId || !hasCollectorResult(step.messages, callId, "interact_parent")) continue;
        const event = input.events.acceptInteraction({ runId: input.runId, attemptId: step.attemptId,
          token: proposal.token, stepNumber: step.stepNumber, toolCallId: callId, kind: proposal.kind, text: proposal.text });
        pending.delete(callId);
        accepted ||= event !== undefined;
        if (proposal.kind === "needs_input") {
          if (event) committedWait = true;
          else input.terminal.release(step.attemptId, callId);
        }
      }
      return accepted;
    },
  };
}

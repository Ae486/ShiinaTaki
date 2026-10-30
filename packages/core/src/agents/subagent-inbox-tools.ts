/**
 * INPUT: exact delivered consumer membership and trusted invocation callback
 * OUTPUT: intrinsic private detail and durable handling tools
 * POS: core/agents — informational tool bindings; the inbox repository owns action acceptance
 */
import { tool, type ToolSet } from "ai";
import { SubagentHandleEventToolSchema, SubagentReadInboxToolSchema, type SubagentEvent, type SubagentInboxAction } from "@taki/shared";
import type { ToolInvocationSnapshot } from "./tool-invocation.ts";

export function createSubagentInboxTools(input: {
  read(eventId: string): { event: SubagentEvent; target: unknown; action?: string };
  handle(value: { eventId: string; operationKey: string; action: SubagentInboxAction; invocation: ToolInvocationSnapshot }): unknown;
  actualInvocation(): ToolInvocationSnapshot | undefined;
}): ToolSet {
  return {
    read_agent_inbox: tool({
      description: "Read one event delivered in this private inbox, with its exact current child action target. "
        + "Use offset zero initially and nextOffset for later text pages. Missing or unavailable data is reported explicitly.",
      inputSchema: SubagentReadInboxToolSchema,
      execute(candidate) {
        try {
          const { event, target, action } = input.read(candidate.eventId);
          const selected = candidate.detail === "action" ? action : event.body;
          const body = selected ?? "";
          if (candidate.offset > body.length) throw new Error("SUBAGENT_CURSOR_MISMATCH");
          const end = Math.min(body.length, candidate.offset + candidate.limit);
          return { ok: true, eventId: event.eventId, kind: event.kind, state: event.state, target,
            text: body.slice(candidate.offset, end), nextOffset: end < body.length ? end : null,
            absent: selected === null || selected === undefined, sourceContext: event.sourceContext };
        } catch (error) { return refusal(error); }
      },
    }),
    handle_agent_event: tool({
      description: "Handle one delivered worker event privately. Retain useful information, take no action, request user input, "
        + "answer the exact child target, or store a speech proposal. A speech proposal alone does not publish anything. "
        + "Keep the same operationKey when reconciling an unknown result; conflicting repeats are refused.",
      inputSchema: SubagentHandleEventToolSchema,
      execute(candidate) {
        try {
          const invocation = input.actualInvocation();
          if (!invocation) throw new Error("SUBAGENT_INBOX_INVOCATION_REQUIRED");
          return input.handle({ ...candidate, invocation });
        } catch (error) { return refusal(error); }
      },
    }),
  };
}

function refusal(error: unknown) {
  return { ok: false, code: error instanceof Error && /^SUBAGENT_[A-Z_]+$/.test(error.message)
    ? error.message : "SUBAGENT_INBOX_UNAVAILABLE" };
}

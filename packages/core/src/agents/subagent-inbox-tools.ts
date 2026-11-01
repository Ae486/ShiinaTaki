/**
 * INPUT: exact delivered consumer membership and trusted invocation callback
 * OUTPUT: intrinsic private detail and durable handling tools
 * POS: core/agents — informational tool bindings; the inbox repository owns action acceptance
 */
import { tool, type ToolSet } from "ai";
import { SubagentHandleEventToolSchema, SubagentReadInboxToolSchema, type SubagentEvent, type SubagentInboxAction } from "@taki/shared";
import type { ToolInvocationSnapshot } from "./tool-invocation.ts";
import { subagentScopedModelState } from "./subagent-model-state.ts";
import { subagentActionEvidence } from "../db/subagent-action-evidence.ts";

export function createSubagentInboxTools(input: {
  read(eventId: string): { event: SubagentEvent; target: unknown; action?: string; current?: unknown; pendingRequest?: unknown };
  handle(value: { eventId: string; operationKey: string; action: SubagentInboxAction; invocation: ToolInvocationSnapshot }): unknown;
  actualInvocation(): ToolInvocationSnapshot | undefined;
}): ToolSet {
  return {
    read_agent_inbox: tool({
      description: "Read one event delivered in this private inbox, with its exact current child action target. "
        + "Use offset zero initially and nextOffset for later text pages. Missing or unavailable data is reported explicitly.",
      inputSchema: SubagentReadInboxToolSchema,
      toModelOutput: ({ output }) => ({ type: "json", value: JSON.parse(JSON.stringify(subagentScopedModelState(output))) }),
      execute(candidate) {
        try {
          const { event, target, action, current, pendingRequest } = input.read(candidate.eventId);
          const selected = candidate.detail === "action" ? action : event.body;
          const body = selected ?? "";
          if (candidate.offset > body.length) throw new Error("SUBAGENT_CURSOR_MISMATCH");
          let end = Math.min(body.length, candidate.offset + candidate.limit);
          if (end < body.length && /[\uD800-\uDBFF]/u.test(body.charAt(end - 1))) {
            // A one-unit page must advance over the full code point instead of returning the same cursor forever.
            end = end - 1 === candidate.offset ? end + 1 : end - 1;
          }
          return { ok: true, eventId: event.eventId, kind: event.kind, state: event.state, target,
            current, pendingRequest,
            text: body.slice(candidate.offset, end), nextOffset: end < body.length ? end : null,
            absent: selected === null || selected === undefined, sourceContext: event.sourceContext };
        } catch (error) { return refusal(error); }
      },
    }),
    handle_agent_event: tool({
      description: "Handle one delivered worker event. retained and no_action record internal dispositions; they do not send an answer to the user. You may request user input, answer the exact child target, or explicitly continue_child for a permitted exact check-in. "
        + "Use speech_proposed for an intended final delayed answer and put the complete user-facing answer in note. In an idle handler this requests Core's separate publication checks and delivery; in foreground, also provide the actual reply. Proposal acceptance is not proof of publication. "
        + "Keep the same operationKey when reconciling an unknown result; conflicting repeats are refused.",
      inputSchema: SubagentHandleEventToolSchema,
      toModelOutput: ({ output }) => ({ type: "json", value: JSON.parse(JSON.stringify(subagentScopedModelState(subagentActionEvidence(output)))) }),
      execute(candidate) {
        try {
          const invocation = input.actualInvocation();
          if (!invocation) throw new Error("SUBAGENT_INBOX_INVOCATION_REQUIRED");
          return input.handle({ ...candidate, invocation });
        } catch (error) {
          let current;
          try { current = input.read(candidate.eventId); } catch { current = undefined; }
          return { ...refusal(error), current: current?.current, target: current?.target, pendingRequest: current?.pendingRequest };
        }
      },
    }),
  };
}

function refusal(error: unknown) {
  return { ok: false, code: error instanceof Error && /^SUBAGENT_[A-Z_]+$/.test(error.message)
    ? error.message : "SUBAGENT_INBOX_UNAVAILABLE",
    nextAction: "Read the exact delivered event and current target; use explicit continue_child for check-ins. A user-required wait or user Stop needs direct user continuation. Reconcile accepted actions without replay." };
}

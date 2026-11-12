/**
 * INPUT: exact delivered consumer membership and trusted invocation callback
 * OUTPUT: intrinsic private detail and durable handling tools
 * POS: core/agents — informational tool bindings; the inbox repository owns action acceptance
 */
import { tool, type ToolSet } from "ai";
import { SubagentHandleEventToolSchema, SubagentReadInboxToolSchema, type SubagentEvent, type SubagentInboxAction, type SubagentHandleEventToolInput } from "@taki/shared";
import type { ToolInvocationSnapshot } from "./tool-invocation.ts";
import { subagentScopedModelState } from "./subagent-model-state.ts";
import { subagentActionEvidence } from "../db/subagent-action-evidence.ts";

export function createSubagentInboxTools(input: {
  read(eventId: string): { event: SubagentEvent; target: unknown; action?: string; current?: unknown; pendingRequest?: unknown };
  handle(value: { eventId: string; action: SubagentInboxAction; invocation: ToolInvocationSnapshot }): unknown;
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
      description: "Handle one delivered worker event: record retains evidence privately, ask_user requests user attention, and reply proposes a user-facing answer. These intents use target=null; put the complete question or answer in text. "
        + "To reply privately to a delivered child message or answer its question use answer_child; for a permitted check-in use continue_child. Copy its complete current target unchanged; Core addresses a question only when the selected event requests input. "
        + "In an idle handler reply requests Core's separate publication checks and delivery; in foreground, also provide the actual reply. Proposal acceptance is not proof of publication, and record handles this event without deferring it for fresh automatic handling. "
        + "Identical retries return the accepted receipt; changed actions are refused. Ordinary guidance, interrupted-work continuation and inspected or silent work use send_subagent_message when available.",
      inputSchema: SubagentHandleEventToolSchema,
      toModelOutput: ({ output }) => ({ type: "json", value: JSON.parse(JSON.stringify(subagentScopedModelState(subagentActionEvidence(output)))) }),
      execute(candidate) {
        try {
          const invocation = input.actualInvocation();
          if (!invocation) throw new Error("SUBAGENT_INBOX_INVOCATION_REQUIRED");
          const parsed = SubagentHandleEventToolSchema.parse(candidate);
          return input.handle({ eventId: parsed.eventId, action: normalizeAction(parsed, (id) => input.read(id).event), invocation });
        } catch (error) {
          let current;
          try { current = input.read(candidate.eventId); } catch { current = undefined; }
          return { ...refusal(error), current: current?.current, target: current?.target, pendingRequest: current?.pendingRequest };
        }
      },
    }),
  };
}

function normalizeAction(input: SubagentHandleEventToolInput, read: (eventId: string) => SubagentEvent): SubagentInboxAction {
  if (input.intent === "answer_child" || input.intent === "continue_child") {
    if (!input.target) throw new Error("SUBAGENT_EXACT_TARGET_REQUIRED");
    const event = read(input.eventId);
    if (input.intent === "continue_child") {
      if (event.kind !== "needs_input") throw new Error("SUBAGENT_INPUT_REQUEST_CONFLICT");
      return { kind: "continue_child", target: input.target, replyToEventId: event.eventId, direction: input.text };
    }
    return { kind: "answered_child", target: input.target,
      replyToEventId: event.kind === "needs_input" ? event.eventId : null, direction: input.text };
  }
  const kind = { record: "retained", ask_user: "needs_user_input", reply: "speech_proposed" } as const;
  return { kind: kind[input.intent], note: input.text };
}

function refusal(error: unknown) {
  return { ok: false, code: error instanceof Error && /^SUBAGENT_[A-Z_]+$/.test(error.message)
    ? error.message : "SUBAGENT_INBOX_UNAVAILABLE",
    nextAction: "Read the exact delivered event and current target; use explicit continue_child for check-ins. A user-required wait or user Stop needs direct user continuation. Reconcile accepted actions without replay." };
}

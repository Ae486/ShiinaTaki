/**
 * INPUT: actual compatible-provider requests and read-only scenario evidence
 * OUTPUT: delivered event parsing, real inbox tool decisions and canonical receipt assertions
 * POS: e2e/fixture — no fabricated event IDs, model calls or internal action execution
 */
import { expect } from "vitest";
import { SubagentEventSchema, SubagentHandleEventToolSchema, SubagentInboxActionSchema, SubagentTargetSchema,
  type SubagentInboxAction } from "@taki/shared";
import type { AgentContextScenario } from "./agent-context-scenario.ts";
import type { ScriptedReply } from "./scripted-provider.ts";

const EventIdentitySchema = SubagentEventSchema.pick({ eventId: true, kind: true }).strip();

export function deliveredInboxEvents(request: Record<string, unknown>) {
  if (!Array.isArray(request.messages)) return [];
  return request.messages.flatMap((message) => {
    const item = record(message);
    if (item?.role !== "system" || typeof item.content !== "string") return [];
    return item.content.split("\n").flatMap((line) => {
      if (!line.startsWith('{"eventId":')) return [];
      const candidate: unknown = JSON.parse(line);
      const event = EventIdentitySchema.parse(candidate);
      const preview = record(candidate)?.preview;
      if (typeof preview !== "string") throw new Error("delivered inbox event lacks its actual preview");
      return [{ ...event, preview }];
    });
  });
}

export function scriptedInboxReply(request: Record<string, unknown>, actionFor: (text: string) => SubagentInboxAction): ScriptedReply | undefined {
  const events = deliveredInboxEvents(request);
  if (!events.length) return undefined;
  const outputs = modelToolOutputs(request);
  const pending = events.filter((event) => !outputs.some((output) => output.ok === true
    && output.eventId === event.eventId && typeof output.disposition === "string"));
  if (!pending.length) return { text: "The private events have been handled." };
  return { calls: pending.map((event) => {
    const detail = outputs.find((output) => output.ok === true && output.eventId === event.eventId
      && typeof output.text === "string" && SubagentTargetSchema.safeParse(output.target).success);
    if (!detail) return { name: "read_agent_inbox", arguments: { eventId: event.eventId, offset: 0, limit: 16000 } };
    if (detail.nextOffset !== null) throw new Error("fixture event unexpectedly needs another body page");
    const action = SubagentInboxActionSchema.parse(actionFor(String(detail.text)));
    if (action.kind === "no_action") throw new Error("historical no_action is not a current model intent");
    const input = action.kind === "answered_child" || action.kind === "continue_child"
      ? { eventId: event.eventId, intent: action.kind === "answered_child" ? "answer_child" : "continue_child",
        text: action.direction, target: action.target }
      : { eventId: event.eventId, intent: { retained: "record", needs_user_input: "ask_user", speech_proposed: "reply" }[action.kind],
        text: action.note, target: null };
    return { name: "handle_agent_event", arguments: SubagentHandleEventToolSchema.parse(input) };
  }) };
}

export function acknowledgedChildren(request: Record<string, unknown>): string[] {
  return [...new Set(modelToolOutputs(request).flatMap((output) => {
    const target = SubagentTargetSchema.safeParse(output.target);
    return typeof output.worker === "string" && output.accepted === true && target.success
      ? [target.data.subagentId] : [];
  }))];
}

export function modelToolOutputs(request: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(request.messages)) return [];
  return request.messages.flatMap((message) => {
    const item = record(message);
    if (item?.role !== "tool" || typeof item.content !== "string") return [];
    let parsed: unknown;
    try { parsed = JSON.parse(item.content); } catch { return []; }
    // Core Source/material envelopes are retained by some tools; compact delegation output is direct.
    const outputs: Record<string, unknown>[] = [];
    for (let value = record(parsed); value; value = record(value.result)) outputs.push(value);
    return outputs;
  });
}

export function handledEvents(scenario: AgentContextScenario) {
  return scenario.rows(`SELECT e.event_id,e.subagent_id,e.work_input_id,e.producer_run_id,e.kind,e.body,e.eligible,
    a.action_json,a.result_json,a.consumer_id,a.model_effect_id,a.operation_key,c.run_id AS consumer_run_id,c.mode,
    d.model_input_digest,d.projection_digest,f.input_digest,f.kind AS effect_kind,f.run_id AS effect_run_id
    FROM subagent_events e JOIN subagent_event_actions a USING(event_id)
    JOIN subagent_inbox_consumers c USING(consumer_id)
    JOIN subagent_inbox_deliveries d ON d.consumer_id=a.consumer_id AND d.model_effect_id=a.model_effect_id
    JOIN run_effects f ON f.effect_id=a.model_effect_id ORDER BY e.seq`);
}

export function assertHandledEvent(row: Record<string, unknown>, expected: { kind: SubagentInboxAction["kind"]; marker: string }) {
  expect(row.kind).toBe("final");
  expect(row.eligible).toBe(1);
  expect(row.body).toEqual(expect.stringContaining(expected.marker));
  expect(row.effect_kind).toBe("model");
  expect(row.effect_run_id).toBe(row.consumer_run_id);
  expect(row.model_input_digest).toBe(row.input_digest);
  expect(row.projection_digest).toMatch(/^[a-f0-9]{64}$/);
  const action = SubagentInboxActionSchema.parse(JSON.parse(String(row.action_json)));
  expect(action).toMatchObject({ kind: expected.kind, note: expect.stringContaining(expected.marker) });
  expect(JSON.parse(String(row.result_json))).toMatchObject({ ok: true, eventId: row.event_id, disposition: expected.kind });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

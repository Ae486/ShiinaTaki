/**
 * INPUT: actual captured SDK requests and read-only production scenario witnesses
 * OUTPUT: unique main calls, explicit waiting/polling observations and separate producer counts
 * POS: e2e/fixture — behavioral evidence only; missing usage and outcome remain unknown
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { SubagentInboxActionSchema, TimelinePartSchema } from "@taki/shared";
import { handledEvents } from "./agent-context-inbox.ts";
import type { AgentContextScenario } from "./agent-context-scenario.ts";
import type { TimingRequest } from "./agent-context-timing-relay.ts";

export function requestBody(body: string): Record<string, unknown> {
  const value: unknown = JSON.parse(body);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid observed model request");
  return value as Record<string, unknown>;
}

export function requestTools(body: Record<string, unknown>): string[] {
  return Array.isArray(body.tools) ? body.tools.flatMap((entry) => {
    const fn = record(record(entry)?.function);
    return typeof fn?.name === "string" ? [fn.name] : [];
  }) : [];
}

interface MainCallEvidence {
  toolCallId: string; toolName: string; arguments: Record<string, unknown> | null; firstObservedRequest: number | null;
  command: string | null; waitOnlyExec: boolean | null; category: unknown; evidenceSource: string;
  inputProvenance: "raw-sdk-history" | "retained-native-input" | "canonical-input-unavailable";
  derivedIntent: { intent: string; actionKind: string; eventId: string; provenance: "canonical-action-receipt" } | null;
}

export function mainCalls(s: Pick<AgentContextScenario, "requests" | "rows">) {
  const seen = new Set<string>();
  const observed: MainCallEvidence[] = s.requests.flatMap((request) => {
    const body = requestBody(request.body);
    if (requestTools(body).includes("complete_subagent") || body.stream !== true || !Array.isArray(body.messages)) return [];
    return body.messages.flatMap((message) => {
      const item = record(message);
      if (item?.role !== "assistant" || !Array.isArray(item.tool_calls)) return [];
      return item.tool_calls.flatMap((call) => {
        const value = record(call); const fn = record(value?.function);
        if (typeof value?.id !== "string" || typeof fn?.name !== "string" || typeof fn.arguments !== "string") return [];
        if (seen.has(value.id)) return [];
        seen.add(value.id);
        let args: Record<string, unknown>;
        try { args = requestBody(fn.arguments); }
        catch { args = { malformedArguments: fn.arguments }; }
        const command = typeof args.command === "string" ? args.command : record(args.input)?.command;
        const waitOnlyExec = typeof command === "string" && isWaitingCommand(command);
        const category = fn.name === "handle_agent_event" ? args.intent
          : fn.name === "send_subagent_message" ? "ordinary-or-exact-direct-message"
            : fn.name === "inspect_subagent" ? "inspection-requires-purpose-review"
              : waitOnlyExec ? "wait-only-exec" : fn.name;
        return [{ toolCallId: value.id, toolName: fn.name, arguments: args, firstObservedRequest: request.requestNumber,
          command: typeof command === "string" ? command : null, waitOnlyExec, category,
          evidenceSource: "actual-outgoing-SDK-history", inputProvenance: "raw-sdk-history" as const, derivedIntent: null }];
      });
    });
  });
  // Private native parts retain invocation identity but intentionally omit model arguments.
  const actions = s.rows("SELECT tool_call_id,event_id,action_json FROM subagent_event_actions");
  const rows = s.rows(`SELECT parts_json AS parts FROM run_messages WHERE role='assistant'
    AND run_id NOT IN (SELECT run_id FROM subagent_executions) AND parts_json IS NOT NULL
    UNION ALL SELECT parts FROM timeline_messages WHERE role='assistant' AND parts IS NOT NULL`);
  for (const row of rows) for (const part of TimelinePartSchema.array().parse(JSON.parse(String(row.parts)))) {
    if (part.type !== "tool-call" || seen.has(part.toolCallId)) continue;
    seen.add(part.toolCallId);
    const args = record(part.input) ?? null;
    const command = typeof args?.command === "string" ? args.command : record(args?.input)?.command;
    const execution = isPotentialExecution(part.toolName);
    const waitOnlyExec = args === null && execution ? null : typeof command === "string" && isWaitingCommand(command);
    const receipt = part.toolName === "handle_agent_event" ? actions.find((action) => action.tool_call_id === part.toolCallId) : undefined;
    const action = receipt ? SubagentInboxActionSchema.parse(JSON.parse(String(receipt.action_json))) : undefined;
    const derivedIntent = action && receipt ? { intent: intentForAction(action.kind), actionKind: action.kind,
      eventId: String(receipt.event_id), provenance: "canonical-action-receipt" as const } : null;
    observed.push({ toolCallId: part.toolCallId, toolName: part.toolName, arguments: args,
      firstObservedRequest: null, command: typeof command === "string" ? command : null, waitOnlyExec,
      category: part.toolName === "handle_agent_event" ? args?.intent ?? (derivedIntent ? `derived:${derivedIntent.intent}` : "unavailable")
        : waitOnlyExec === true ? "wait-only-exec" : part.toolName,
      inputProvenance: args === null ? "canonical-input-unavailable" : "retained-native-input", derivedIntent,
      evidenceSource: "canonical-native-parts-no-successor-request" });
  }
  return observed;
}

function isPotentialExecution(name: string): boolean {
  return name === "extension_call" || /(?:^|_)exec$/u.test(name);
}

function intentForAction(kind: string): string {
  return { retained: "record", needs_user_input: "ask_user", speech_proposed: "reply",
    answered_child: "answer_child", continue_child: "continue_child", no_action: "historical:no_action" }[kind] ?? "unavailable";
}

export function isWaitingCommand(command: string): boolean {
  return /\b(?:start-sleep|sleep|timeout|wait-process|wait-event|ping)\b/iu.test(command)
    || /(?:setTimeout|Thread\s*\.\s*Sleep|Task\s*\.\s*Delay)/iu.test(command);
}

export function saveInterfaceEvidence(s: AgentContextScenario, timing: readonly TimingRequest[] = [], durations: unknown = {}) {
  const calls = mainCalls(s);
  const behavior = assessInterfaceCalls(calls);
  const effects = s.rows("SELECT kind,state,outcome FROM run_effects");
  const modelEffects = effects.filter((effect) => effect.kind === "model");
  const usage = s.rows("SELECT * FROM run_usage");
  const summary = { durations, calls, ...behavior,
    inspectionReview: "Inspect actual arguments/context before assigning semantic purpose; repeated identical calls fail the strict campaign gate.",
    counts: { observerAttempts: s.observations.length, observerAdmittedReservations: s.observations.filter((r) => r.upstreamAttempted).length,
      physicalUpstreamForwards: timing.length ? timing.filter((r) => r.forwardedAt !== null).length : null,
      successfulHttpStatuses: s.observations.filter((r) => r.status !== undefined && r.status >= 200 && r.status < 300 && r.error === undefined).length,
      completedTransportResponses: timing.length ? timing.filter((r) => r.finishedAt !== null && r.status !== null
        && r.aborted === null && r.failure === null).length : null,
      admittedModelEffects: modelEffects.length, settledModelEffects: modelEffects.filter((e) => e.state === "terminal").length,
      completedModelGenerations: modelEffects.filter((e) => e.state === "terminal" && e.outcome === "completed").length,
      completedChildTaskSteps: s.rows("SELECT model_effect_id FROM subagent_task_steps WHERE completed_ordinal IS NOT NULL").length,
      taskModelSummaryWitnesses: s.rows("SELECT effect_id FROM subagent_context_summary_intents").length,
      observedNonStreamingUtilityRequests: s.requests.filter((request) => requestBody(request.body).stream !== true).length,
      usageRows: usage.length, usageCompleteness: "Retain actual run_usage rows; absent/nullable values are unknown, never zero." },
    usage, handled: handledEvents(s), nativeAudit: s.nativeHost?.audit() ?? null, timing };
  writeFileSync(join(s.evidenceDir, "interface-evidence.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  s.checkpoint("interface-behavior-accounting", summary);
  return summary;
}

export function assessInterfaceCalls(calls: readonly MainCallEvidence[]) {
  const inspections = calls.filter((call) => call.toolName === "inspect_subagent" && call.arguments !== null);
  return { waitOnlyExec: calls.filter((call) => call.waitOnlyExec === true),
    unassessedExecutionInputs: calls.filter((call) => isPotentialExecution(call.toolName)
      && (call.arguments === null || call.waitOnlyExec === null)),
    unknownInspectionInputs: calls.filter((call) => call.toolName === "inspect_subagent" && call.arguments === null),
    repeatedIdenticalInspections: inspections.filter((call, index) => inspections.slice(0, index).some((prior) =>
      JSON.stringify(prior.arguments) === JSON.stringify(call.arguments))) };
}

export function assertNoWaitingOrPolling(s: AgentContextScenario) {
  assertAssessedInterfaceBehavior(saveInterfaceEvidence(s));
}

export function assertAssessedInterfaceBehavior(evidence: ReturnType<typeof assessInterfaceCalls>) {
  expect(evidence.unassessedExecutionInputs, "Missing execution input prevents a truthful no-wait assessment").toEqual([]);
  expect(evidence.unknownInspectionInputs, "Missing inspection input prevents a truthful no-polling assessment").toEqual([]);
  expect(evidence.waitOnlyExec, "A denied waiting command still violates foreground availability").toEqual([]);
  expect(evidence.repeatedIdenticalInspections, "Review retained calls; repeated identical completion inspection is not useful foreground work").toEqual([]);
}

export function assertEventAction(s: AgentContextScenario, eventId: string, kind: string) {
  const rows = handledEvents(s).filter((row) => row.event_id === eventId);
  expect(rows).toHaveLength(1);
  const row = rows[0]!;
  expect(row.effect_kind).toBe("model");
  expect(row.effect_run_id).toBe(row.consumer_run_id);
  expect(row.model_input_digest).toBe(row.input_digest);
  expect(SubagentInboxActionSchema.parse(JSON.parse(String(row.action_json))).kind).toBe(kind);
  expect(JSON.parse(String(row.result_json))).toMatchObject({ ok: true, eventId, disposition: kind });
  return row;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

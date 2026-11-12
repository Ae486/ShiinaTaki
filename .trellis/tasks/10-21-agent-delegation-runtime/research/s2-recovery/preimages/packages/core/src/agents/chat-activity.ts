/**
 * INPUT:  one accepted foreground message, ordered public SDK parts, and immutable invocation observations
 * OUTPUT: monotonic activity events and stable references into canonical step messages
 * POS:    core/agents — payload-free presentation producer; callbacks wait for receipt and never execute work
 */
import { randomUUID } from "node:crypto";
import type {
  ChatActivity, ChatActivityIdentity, ChatActivityPhase, ChatActivityTerminal, TimelineItemReference,
} from "@taki/shared";
import type { ToolActivityObserver } from "./tool-observability.ts";
import type { ToolInvocationBridge, ToolInvocationSnapshot } from "./tool-invocation.ts";
import type { ToolOutcome } from "./tool-outcome.ts";
import type { TurnEntryInput } from "./turn-mapping.ts";
import { stepActivityReferences, type ActivityStepSource } from "./turn-activity-presentation.ts";

type ActivityBody = ChatActivity extends infer Event
  ? Event extends ChatActivity ? Omit<Event, keyof ChatActivityIdentity | "seq"> : never : never;
interface ToolObservation {
  invocation: ToolInvocationSnapshot;
  order?: number;
  phases: ChatActivityPhase[];
  terminal?: ChatActivityTerminal & { durationMs?: number };
}
export interface ChatActivityAttempt {
  observer: ToolActivityObserver;
  observe(part: unknown, invocations: ToolInvocationBridge): void;
  references(stepNumber: number, row: TurnEntryInput): TimelineItemReference[];
  close(cancelled: boolean): void;
}
export interface ChatTurnActivity {
  readonly messageId: string;
  readonly seq: number;
  start(): void;
  beginAttempt(attemptId?: string): ChatActivityAttempt;
  terminal(terminal: ChatActivityTerminal): void;
}

export function createChatTurnActivity(input: {
  identity: ChatActivityIdentity; publish(event: ChatActivity): void; newId?: () => string;
}): ChatTurnActivity {
  const state = {
    identity: input.identity, seq: 0, order: 0, started: false, ended: false,
    current: undefined as object | undefined, segment: undefined as { itemId: string; order: number } | undefined,
    publish: input.publish, newId: input.newId ?? randomUUID,
  };
  return {
    messageId: input.identity.messageId,
    get seq() { return state.seq; },
    start() { if (!state.started) { state.started = true; emit(state, { kind: "turn.started" }); } },
    beginAttempt(attemptId) { return beginAttempt(state, attemptId); },
    terminal(terminal) {
      if (state.ended) return;
      emit(state, { kind: "turn.terminal", ...terminal });
      state.ended = true;
      state.current = undefined;
    },
  };
}
type TurnState = Parameters<typeof emit>[0];
interface ActivityTurnState {
  identity: ChatActivityIdentity; seq: number; order: number; started: boolean; ended: boolean;
  current?: object; segment?: { itemId: string; order: number };
  publish(event: ChatActivity): void; newId(): string;
}

function emit(state: ActivityTurnState, body: ActivityBody): void {
  if (state.ended) return;
  const event = { ...state.identity, ...body, seq: ++state.seq } as ChatActivity;
  try { state.publish(event); } catch { /* Display delivery cannot change canonical turn execution. */ }
}

function beginAttempt(turn: TurnState, attemptId?: string): ChatActivityAttempt {
  const token = {};
  turn.current = token;
  turn.identity = { ...turn.identity, attemptId };
  turn.segment = undefined;
  const state = {
    turn, token, step: -1, closed: false, tools: new Map<string, ToolObservation>(),
    steps: new Map<number, ActivityStepSource>(),
  };
  return {
    observer: {
      phase: (invocation, phase) => observePhase(state, invocation, phase),
      terminal: (invocation, outcome, durationMs) => observeTerminal(state, invocation, { ...outcome, durationMs }),
    },
    observe: (part, invocations) => observePart(state, part, invocations),
    references: (stepNumber, row) => stepActivityReferences(row, state.steps.get(stepNumber), state.tools),
    close(cancelled) {
      if (!current(state)) return;
      for (const tool of state.tools.values()) {
        if (tool.order === undefined || tool.terminal) continue;
        const phase = tool.phases.at(-1) ?? "received";
        const outcome = cancelled && (phase === "received" || phase === "approval") ? "cancelled" : "outcome_unknown";
        observeTerminal(state, tool.invocation, { outcome });
      }
      state.closed = true;
    },
  };
}
type AttemptState = {
  turn: TurnState; token: object; step: number; closed: boolean;
  tools: Map<string, ToolObservation>; steps: Map<number, ActivityStepSource>;
};

function current(state: AttemptState): boolean {
  return !state.closed && !state.turn.ended && state.turn.current === state.token;
}

function getTool(state: AttemptState, invocation: ToolInvocationSnapshot): ToolObservation {
  const existing = state.tools.get(invocation.invocationId);
  if (existing) return existing;
  const tool: ToolObservation = { invocation, phases: [] };
  state.tools.set(invocation.invocationId, tool);
  return tool;
}

function observePhase(state: AttemptState, invocation: ToolInvocationSnapshot, phase: ChatActivityPhase): void {
  if (!current(state)) return;
  const tool = getTool(state, invocation);
  if (tool.terminal || tool.phases.includes(phase)) return;
  tool.phases.push(phase);
  if (tool.order !== undefined) emit(state.turn, { kind: "tool.phase", itemId: invocation.invocationId, phase });
}

function observeTerminal(state: AttemptState, invocation: ToolInvocationSnapshot, value: ToolOutcome & { durationMs?: number }): void {
  if (!current(state)) return;
  const tool = getTool(state, invocation);
  if (tool.terminal) return;
  const message = outcomeMessage(value);
  tool.terminal = { outcome: value.outcome, ...(message ? { message } : {}),
    ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs }) };
  if (tool.order !== undefined) emit(state.turn, { kind: "tool.terminal", itemId: invocation.invocationId, ...tool.terminal });
}

function outcomeMessage(value: ToolOutcome): string | undefined {
  if (value.outcome === "completed") return undefined;
  if (value.outcome === "cancelled") return "操作已取消";
  if (value.outcome === "outcome_unknown") return "操作结果尚未确认";
  if (value.errorClass === "governance") return "操作未获授权";
  if (value.errorClass === "validation") return "工具参数未通过校验";
  if (value.errorClass === "stale") return "操作目标已不可用";
  if (value.errorCode === "avatar_rejected") return "画面未采用这次表情或动作";
  return value.errorCode === "mcp_tool_error" ? "工具返回了错误" : "工具调用失败";
}

function stepSource(state: AttemptState): ActivityStepSource {
  const step = Math.max(0, state.step);
  const existing = state.steps.get(step);
  if (existing) return existing;
  const source: ActivityStepSource = { texts: [], tools: [] };
  state.steps.set(step, source);
  return source;
}

function observePart(state: AttemptState, value: unknown, invocations: ToolInvocationBridge): void {
  if (!current(state) || typeof value !== "object" || value === null || !("type" in value)) return;
  const part = value as Record<string, unknown>;
  if (part.type === "start-step") { state.step += 1; return; }
  if (part.type === "text-start" && typeof part.id === "string") {
    stepSource(state).texts.push({ sourceId: part.id, length: 0, references: [] });
  } else if (part.type === "text-delta" && typeof part.text === "string" && part.text.length > 0) {
    observeText(state, { id: typeof part.id === "string" ? part.id : "", text: part.text });
  } else if (part.type === "tool-call" && isToolCall(part)) {
    receiveTool(state, invocations.capture(part));
  }
}

function isToolCall(part: Record<string, unknown>): part is Record<string, unknown> & { toolCallId: string; toolName: string } {
  return typeof part.toolCallId === "string" && typeof part.toolName === "string";
}

function observeText(state: AttemptState, part: { id: string; text: string }): void {
  const turn = state.turn;
  const segment = turn.segment ??= { itemId: turn.newId(), order: turn.order++ };
  const step = stepSource(state);
  let text = step.texts.findLast((source) => source.sourceId === part.id);
  if (!text) { text = { sourceId: part.id, length: 0, references: [] }; step.texts.push(text); }
  const last = text.references.at(-1);
  if (last?.itemId === segment.itemId) last.end += part.text.length;
  else text.references.push({ kind: "text", ...segment, start: text.length, end: text.length + part.text.length });
  text.length += part.text.length;
  emit(turn, { kind: "text.delta", ...segment, delta: part.text });
}

function receiveTool(state: AttemptState, invocation: ToolInvocationSnapshot): void {
  state.turn.segment = undefined;
  const tool = getTool(state, invocation);
  if (tool.order !== undefined) return;
  tool.order = state.turn.order++;
  stepSource(state).tools.push(invocation);
  emit(state.turn, {
    kind: "tool.received", itemId: invocation.invocationId, order: tool.order,
    toolCallId: invocation.toolCallId, toolName: invocation.toolName,
    ...(invocation.displayName ? { displayName: invocation.displayName } : {}),
  });
  // SDK callbacks can finish before public consumption; their truthful facts follow the ordered receipt.
  for (const phase of tool.phases) emit(state.turn, { kind: "tool.phase", itemId: invocation.invocationId, phase });
  if (tool.terminal) emit(state.turn, { kind: "tool.terminal", itemId: invocation.invocationId, ...tool.terminal });
}

/**
 * INPUT:  exact SDK tool-call objects, middleware request identities, and captured tool display names
 * OUTPUT: immutable invocation snapshots linked by object identity without retaining or copying input/output
 * POS:    core/agents — per-attempt observation bridge; no execution, catalog, or persistence authority
 */
import { randomUUID } from "node:crypto";
import { captureToolDisplayNames, getKnownToolDisplayName, getValidToolDisplayName } from "@taki/shared";

export interface ToolInvocationSnapshot {
  readonly invocationId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly displayName?: string;
  readonly callId?: string;
  readonly modelEffectId?: string;
  readonly validationState: "accepted" | "failed";
}

export interface ModelRequestIdentity {
  readonly callId: string;
  readonly modelEffectId: string;
}

interface ToolCallIdentity {
  toolCallId: string;
  toolName: string;
  invalid?: boolean;
}

export interface ToolInvocationBridge {
  observeRequestTool(request: ModelRequestIdentity, tool: ToolCallIdentity): void;
  bindModelContent(content: readonly unknown[], request: ModelRequestIdentity): void;
  retireRequest(modelEffectId: string): void;
  capture(tool: ToolCallIdentity, request?: ModelRequestIdentity): ToolInvocationSnapshot;
  get(object: object): ToolInvocationSnapshot | undefined;
  result(object: ToolCallIdentity): ToolInvocationSnapshot;
  alias(object: object, invocation: ToolInvocationSnapshot): void;
}

interface BridgeInput {
  runId: string;
  attemptId: string;
  toolDisplayNames?: Readonly<Record<string, string>>;
  newId?: () => string;
}

interface Candidate extends ModelRequestIdentity { toolName: string }

export function createToolInvocationBridge(input: BridgeInput): ToolInvocationBridge {
  const state = createBridgeState(input);
  return {
    observeRequestTool: (request, tool) => addCandidate(state, request, tool),
    bindModelContent: (content, request) => bindContent(state, content, request),
    retireRequest: (effectId) => retireRequest(state, effectId),
    capture: (tool, request) => capture(state, tool, request),
    get: (object) => state.objects.get(object),
    result: (object) => resultSnapshot(state, object),
    alias: (object, invocation) => { state.objects.set(object, invocation); },
  };
}

function createBridgeState(input: BridgeInput) {
  return {
    runId: input.runId, attemptId: input.attemptId, newId: input.newId ?? randomUUID,
    names: captureToolDisplayNames(input.toolDisplayNames),
    objects: new WeakMap<object, ToolInvocationSnapshot>(),
    requests: new Map<string, Map<string, ToolInvocationSnapshot>>(),
    candidates: new Map<string, Map<string, Candidate | null>>(),
    invocations: new Map<string, ToolInvocationSnapshot[]>(),
  };
}
type BridgeState = ReturnType<typeof createBridgeState>;

function addCandidate(state: BridgeState, request: ModelRequestIdentity, tool: ToolCallIdentity): void {
  const candidates = state.candidates.get(tool.toolCallId) ?? new Map<string, Candidate | null>();
  const previous = candidates.get(request.modelEffectId);
  candidates.set(request.modelEffectId, previous === null || (previous && previous.toolName !== tool.toolName)
    ? null : { ...request, toolName: tool.toolName });
  state.candidates.set(tool.toolCallId, candidates);
}

function uniqueRequest(state: BridgeState, tool: ToolCallIdentity): ModelRequestIdentity | undefined {
  const candidates = state.candidates.get(tool.toolCallId);
  if (candidates?.size !== 1) return undefined;
  const candidate = [...candidates.values()][0];
  return candidate?.toolName === tool.toolName
    ? { callId: candidate.callId, modelEffectId: candidate.modelEffectId } : undefined;
}

function capture(
  state: BridgeState,
  tool: ToolCallIdentity,
  request: ModelRequestIdentity | null = uniqueRequest(state, tool) ?? null,
): ToolInvocationSnapshot {
  const existing = state.objects.get(tool);
  if (existing) return existing;
  const sameRequest = request && state.requests.get(request.modelEffectId)?.get(tool.toolCallId);
  if (sameRequest?.toolName === tool.toolName && sameRequest.validationState === validationState(tool)) {
    state.objects.set(tool, sameRequest);
    return sameRequest;
  }
  const invocation = newInvocation(state, tool, sameRequest ? undefined : request ?? undefined);
  state.objects.set(tool, invocation);
  state.invocations.set(tool.toolCallId, [...(state.invocations.get(tool.toolCallId) ?? []), invocation]);
  if (request && !sameRequest) {
    const tools = state.requests.get(request.modelEffectId) ?? new Map<string, ToolInvocationSnapshot>();
    tools.set(tool.toolCallId, invocation);
    state.requests.set(request.modelEffectId, tools);
  }
  return invocation;
}

function newInvocation(
  state: BridgeState, tool: ToolCallIdentity, request?: ModelRequestIdentity,
): ToolInvocationSnapshot {
  const captured = state.names && Object.hasOwn(state.names, tool.toolName)
    ? getValidToolDisplayName(state.names[tool.toolName]) : undefined;
  const displayName = captured ?? getKnownToolDisplayName(tool.toolName);
  return Object.freeze({
    invocationId: state.newId(), runId: state.runId, attemptId: state.attemptId,
    toolCallId: tool.toolCallId, toolName: tool.toolName, validationState: validationState(tool),
    ...(displayName ? { displayName } : {}), ...(request ?? {}),
  });
}

function validationState(tool: ToolCallIdentity): ToolInvocationSnapshot["validationState"] {
  return tool.invalid === true ? "failed" : "accepted";
}

function bindContent(state: BridgeState, content: readonly unknown[], request: ModelRequestIdentity): void {
  for (const item of content) {
    if (!isCall(item)) continue;
    capture(state, item, request);
  }
  retireRequest(state, request.modelEffectId);
}

function isCall(value: unknown): value is ToolCallIdentity {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return item.type === "tool-call" && typeof item.toolCallId === "string" && typeof item.toolName === "string";
}

function retireRequest(state: BridgeState, effectId: string): void {
  for (const [toolId, candidates] of state.candidates) {
    candidates.delete(effectId);
    if (candidates.size === 0) state.candidates.delete(toolId);
  }
}

function resultSnapshot(state: BridgeState, object: ToolCallIdentity): ToolInvocationSnapshot {
  const existing = state.objects.get(object);
  if (existing) return existing;
  const candidates = state.invocations.get(object.toolCallId);
  // A bare stream result cannot select the newest invocation when an ID has been reused by another request.
  if (candidates?.length === 1 && candidates[0]!.toolName === object.toolName) {
    state.objects.set(object, candidates[0]!);
    return candidates[0]!;
  }
  return capture(state, object, null);
}

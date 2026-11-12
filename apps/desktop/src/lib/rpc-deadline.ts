/**
 * INPUT:  a JSON-RPC pair, method/params, and the current window-owned timing policy.
 * OUTPUT: requestWithDeadline() using json-rpc-2.0 native timeout cleanup + typed RpcDeadlineExceededError.
 * POS:    ui/lib - the only ordinary request deadline seam; callers retain zod parsing and never replay mutations.
 */
import { JSONRPCErrorException, type JSONRPCParams, type JSONRPCServerAndClient } from "json-rpc-2.0";
import {
  AVATAR_METHODS,
  CACHE_USAGE_METHODS,
  CHARACTER_METHODS,
  CHAT_METHODS,
  CONFIG_METHODS,
  MODEL_PROFILE_METHODS,
  CONNECT_METHOD,
  EXTENSION_METHODS,
  HINDSIGHT_CONFIGURATION_METHODS,
  INITIATIVE_BACKOFF_METHODS,
  MEDIA_METHODS,
  MEMORY_ACTIVATION_METHODS,
  MEMORY_AUTHORITY_METHODS,
  MEMORY_METHODS,
  MEMORY_OPERATION_METHODS,
  MEMORY_REPLICA_METHODS,
  MEMORY_TRANSITION_METHODS,
  MEMORY_TEMPLATE_METHODS,
  MEMORY_ONBOARDING_METHODS,
  MCP_METHODS,
  PERCEPTION_METHODS,
  PERMISSION_METHODS,
  SECRET_METHODS,
  SKILL_METHODS,
  TIMELINE_METHODS,
  PRESENCE_METHODS,
  SUBAGENT_METHODS,
  type TimingPolicy,
  type TimingPolicyField,
} from "@taki/shared";

export type RpcDeadlineClass = "open-auth" | "interactive" | "long" | "chat-ack";
export type RpcTimeoutOutcome = "read-only" | "unknown";

export interface RpcMethodPolicy {
  class: RpcDeadlineClass;
  timing: TimingPolicyField;
  timeoutOutcome: RpcTimeoutOutcome;
}

const INTERACTIVE_READ: RpcMethodPolicy = { class: "interactive", timing: "interactiveRpcMs", timeoutOutcome: "read-only" };
const INTERACTIVE_MUTATION: RpcMethodPolicy = { class: "interactive", timing: "interactiveRpcMs", timeoutOutcome: "unknown" };
const LONG_MUTATION: RpcMethodPolicy = { class: "long", timing: "longRpcMs", timeoutOutcome: "unknown" };
const LONG_READ: RpcMethodPolicy = { class: "long", timing: "longRpcMs", timeoutOutcome: "read-only" };

export const RPC_METHOD_POLICIES: ReadonlyMap<string, RpcMethodPolicy> = new Map([
  [CONNECT_METHOD, { class: "open-auth", timing: "openAuthMs", timeoutOutcome: "unknown" }],
  [CHAT_METHODS.send, { class: "chat-ack", timing: "chatAckMs", timeoutOutcome: "unknown" }],
  [CHAT_METHODS.cancel, INTERACTIVE_MUTATION],
  [CHAT_METHODS.activityRead, INTERACTIVE_READ],
  [CACHE_USAGE_METHODS.subscribe, INTERACTIVE_READ],
  [CACHE_USAGE_METHODS.unsubscribe, INTERACTIVE_READ],
  [AVATAR_METHODS.subscribe, INTERACTIVE_MUTATION],
  [AVATAR_METHODS.report, INTERACTIVE_MUTATION],
  [AVATAR_METHODS.outcome, INTERACTIVE_MUTATION],
  [TIMELINE_METHODS.history, INTERACTIVE_READ],
  [TIMELINE_METHODS.subscribe, INTERACTIVE_MUTATION],
  [PRESENCE_METHODS.read, INTERACTIVE_READ],
  [INITIATIVE_BACKOFF_METHODS.read, INTERACTIVE_READ],
  [INITIATIVE_BACKOFF_METHODS.reset, INTERACTIVE_MUTATION],
  [SUBAGENT_METHODS.attention, INTERACTIVE_READ],
  [MEDIA_METHODS.get, INTERACTIVE_READ],
  [MEDIA_METHODS.usage, INTERACTIVE_READ],
  [MEDIA_METHODS.clear, LONG_MUTATION],
  [CHARACTER_METHODS.import, LONG_MUTATION],
  [CHARACTER_METHODS.list, INTERACTIVE_READ],
  [CHARACTER_METHODS.costumes, INTERACTIVE_READ],
  [CHARACTER_METHODS.costumeResolution, INTERACTIVE_READ],
  [CONFIG_METHODS.list, INTERACTIVE_READ],
  [CONFIG_METHODS.set, INTERACTIVE_MUTATION],
  [CONFIG_METHODS.subscribe, INTERACTIVE_MUTATION],
  [MODEL_PROFILE_METHODS.list, INTERACTIVE_READ],
  [MODEL_PROFILE_METHODS.subscribe, INTERACTIVE_READ],
  [MODEL_PROFILE_METHODS.save, INTERACTIVE_MUTATION],
  [MODEL_PROFILE_METHODS.test, LONG_MUTATION],
  [MEMORY_METHODS.tidy, LONG_MUTATION],
  [MEMORY_METHODS.status, INTERACTIVE_READ],
  // Transition preview/admission can verify a large corpus. A bounded deadline still does not imply cancellation.
  [MEMORY_TRANSITION_METHODS.preview, LONG_READ],
  [MEMORY_TRANSITION_METHODS.status, LONG_READ],
  [MEMORY_TRANSITION_METHODS.overview, LONG_READ],
  [MEMORY_TEMPLATE_METHODS.preview, LONG_READ],
  [MEMORY_TEMPLATE_METHODS.detail, INTERACTIVE_READ],
  [MEMORY_TEMPLATE_METHODS.status, INTERACTIVE_READ],
  // The Core child observation can wait on its bounded Native read for up to 30 seconds.
  [MEMORY_TEMPLATE_METHODS.derived, LONG_READ],
  [MEMORY_OPERATION_METHODS.submit, INTERACTIVE_MUTATION],
  [MEMORY_OPERATION_METHODS.cancel, INTERACTIVE_MUTATION],
  [MEMORY_AUTHORITY_METHODS.status, INTERACTIVE_READ],
  [MEMORY_ACTIVATION_METHODS.status, INTERACTIVE_READ],
  [MEMORY_OPERATION_METHODS.status, INTERACTIVE_READ],
  [MEMORY_OPERATION_METHODS.list, INTERACTIVE_READ],
  [MEMORY_REPLICA_METHODS.configure, INTERACTIVE_MUTATION],
  [SECRET_METHODS.set, INTERACTIVE_MUTATION],
  [SECRET_METHODS.clear, INTERACTIVE_MUTATION],
  [SECRET_METHODS.presence, INTERACTIVE_READ],
  [MEMORY_ONBOARDING_METHODS.preview, INTERACTIVE_READ],
  [MEMORY_ONBOARDING_METHODS.status, INTERACTIVE_READ],
  [MEMORY_ONBOARDING_METHODS.exceptions, INTERACTIVE_READ],
  [MEMORY_ONBOARDING_METHODS.exclude, INTERACTIVE_MUTATION],
  [MEMORY_ONBOARDING_METHODS.subscribe, INTERACTIVE_MUTATION],
  [PERCEPTION_METHODS.pauseGet, INTERACTIVE_READ],
  [PERCEPTION_METHODS.pauseSet, INTERACTIVE_MUTATION],
  [PERCEPTION_METHODS.card, INTERACTIVE_READ],
  [PERCEPTION_METHODS.subscribe, INTERACTIVE_READ],
  [PERMISSION_METHODS.levelGet, INTERACTIVE_READ],
  [PERMISSION_METHODS.levelSet, INTERACTIVE_MUTATION],
  [PERMISSION_METHODS.cellsGet, INTERACTIVE_READ],
  [PERMISSION_METHODS.cellSet, INTERACTIVE_MUTATION],
  [EXTENSION_METHODS.status, INTERACTIVE_READ],
  [HINDSIGHT_CONFIGURATION_METHODS.status, INTERACTIVE_READ],
  [HINDSIGHT_CONFIGURATION_METHODS.observe, INTERACTIVE_READ],
  [EXTENSION_METHODS.subscribe, INTERACTIVE_READ],
  // MCP lifecycle: reads are interactive; every write/test/reconnect runs a bounded network candidate, so it
  // rides the long deadline like media.clear / character.import (outcome unknown on timeout — never replayed).
  [MCP_METHODS.list, INTERACTIVE_READ],
  [MCP_METHODS.get, INTERACTIVE_READ],
  [MCP_METHODS.status, INTERACTIVE_READ],
  [MCP_METHODS.add, LONG_MUTATION],
  [MCP_METHODS.edit, LONG_MUTATION],
  [MCP_METHODS.enable, LONG_MUTATION],
  [MCP_METHODS.disable, LONG_MUTATION],
  [MCP_METHODS.remove, LONG_MUTATION],
  [MCP_METHODS.test, LONG_MUTATION],
  [MCP_METHODS.reconnect, LONG_MUTATION],
  [SKILL_METHODS.list, INTERACTIVE_READ],
  [SKILL_METHODS.inspect, INTERACTIVE_READ],
  [SKILL_METHODS.import, LONG_MUTATION],
  [SKILL_METHODS.enable, LONG_MUTATION],
  [SKILL_METHODS.disable, LONG_MUTATION],
  [SKILL_METHODS.remove, LONG_MUTATION],
  [SKILL_METHODS.reconcile, LONG_MUTATION],
]);

export function rpcMethodPolicy(method: string, params?: JSONRPCParams): RpcMethodPolicy {
  if (method === MEMORY_OPERATION_METHODS.submit && params && !Array.isArray(params)) {
    const request: unknown = params.request;
    if (request && typeof request === "object" && "kind" in request
      && typeof request.kind === "string" && request.kind.startsWith("transition.")) return LONG_MUTATION;
  }
  return RPC_METHOD_POLICIES.get(method) ?? INTERACTIVE_MUTATION;
}

export class RpcDeadlineExceededError extends Error {
  readonly method: string;
  readonly timeoutMs: number;
  readonly deadlineClass: RpcDeadlineClass;
  readonly outcomeUnknown: boolean;

  constructor(method: string, timeoutMs: number, policy: RpcMethodPolicy) {
    const ambiguity = policy.timeoutOutcome === "unknown" ? "; operation outcome is unknown and was not replayed" : "";
    super(`${method} request exceeded ${timeoutMs}ms${ambiguity}`);
    this.name = "RpcDeadlineExceededError";
    this.method = method;
    this.timeoutMs = timeoutMs;
    this.deadlineClass = policy.class;
    this.outcomeUnknown = policy.timeoutOutcome === "unknown";
  }
}

export interface RpcDeadlineRequest {
  rpc: JSONRPCServerAndClient;
  timing: () => TimingPolicy;
  method: string;
  params: JSONRPCParams;
}

export async function requestWithDeadline<T>(request: RpcDeadlineRequest): Promise<T> {
  const policy = rpcMethodPolicy(request.method, request.params);
  const timeoutMs = request.timing()[policy.timing];
  try {
    return await request.rpc.timeout(timeoutMs).request(request.method, request.params);
  } catch (cause) {
    if (cause instanceof JSONRPCErrorException && cause.code === 0 && cause.message === "Request timeout") {
      throw new RpcDeadlineExceededError(request.method, timeoutMs, policy);
    }
    throw cause;
  }
}

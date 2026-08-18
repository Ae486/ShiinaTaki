/**
 * INPUT:  a JSON-RPC pair, method/params, and the current window-owned timing policy.
 * OUTPUT: requestWithDeadline() using json-rpc-2.0 native timeout cleanup + typed RpcDeadlineExceededError.
 * POS:    ui/lib - the only ordinary request deadline seam; callers retain zod parsing and never replay mutations.
 */
import { JSONRPCErrorException, type JSONRPCParams, type JSONRPCServerAndClient } from "json-rpc-2.0";
import {
  AVATAR_METHODS,
  CHARACTER_METHODS,
  CHAT_METHODS,
  CONFIG_METHODS,
  CONNECT_METHOD,
  EXTENSION_METHODS,
  MEDIA_METHODS,
  MEMORY_METHODS,
  MCP_METHODS,
  PERCEPTION_METHODS,
  PERMISSION_METHODS,
  SKILL_METHODS,
  TIMELINE_METHODS,
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

export const RPC_METHOD_POLICIES: ReadonlyMap<string, RpcMethodPolicy> = new Map([
  [CONNECT_METHOD, { class: "open-auth", timing: "openAuthMs", timeoutOutcome: "unknown" }],
  [CHAT_METHODS.send, { class: "chat-ack", timing: "chatAckMs", timeoutOutcome: "unknown" }],
  [CHAT_METHODS.cancel, INTERACTIVE_MUTATION],
  [AVATAR_METHODS.subscribe, INTERACTIVE_MUTATION],
  [AVATAR_METHODS.report, INTERACTIVE_MUTATION],
  [TIMELINE_METHODS.history, INTERACTIVE_READ],
  [TIMELINE_METHODS.subscribe, INTERACTIVE_MUTATION],
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
  [MEMORY_METHODS.tidy, LONG_MUTATION],
  [MEMORY_METHODS.status, INTERACTIVE_READ],
  [PERCEPTION_METHODS.pauseGet, INTERACTIVE_READ],
  [PERCEPTION_METHODS.pauseSet, INTERACTIVE_MUTATION],
  [PERCEPTION_METHODS.card, INTERACTIVE_READ],
  [PERMISSION_METHODS.levelGet, INTERACTIVE_READ],
  [PERMISSION_METHODS.levelSet, INTERACTIVE_MUTATION],
  [PERMISSION_METHODS.cellsGet, INTERACTIVE_READ],
  [PERMISSION_METHODS.cellSet, INTERACTIVE_MUTATION],
  [EXTENSION_METHODS.status, INTERACTIVE_READ],
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

export function rpcMethodPolicy(method: string): RpcMethodPolicy {
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
  const policy = rpcMethodPolicy(request.method);
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

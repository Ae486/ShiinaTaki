/**
 * INPUT:  an open RpcSocket + the core's WS protocol (shared zod schemas)
 * OUTPUT: pairOperator() (pairing handshake -> authenticated socket) + sayToAgent() (chat.send -> AgentTurn)
 *         + triggerCapability() (dev capability.trigger -> a real tool's structured result, L1/no-LLM)
 *         + fetchTimelineEntries() (timeline.history -> persisted entries, fidelity assertions)
 * POS:    e2e/fixture — the operator-side drivers; with-stack composes them into the Stack helpers
 */
import type { z } from "zod";
import {
  APPROVAL_METHODS,
  CHAT_METHODS,
  CONNECT_METHOD,
  TIMELINE_HISTORY_LIMIT_MAX,
  TIMELINE_METHODS,
  CanonicalApprovalRequestSchema,
  CanonicalApprovalRespondResultSchema,
  ChatCompleteSchema,
  ChatDeltaSchema,
  ChatErrorSchema,
  ChatSendResultSchema,
  ConnectResultSchema,
  JsonRpcErrorResponseSchema,
  JsonRpcSuccessResponseSchema,
  TimelineHistoryResultSchema,
  PermissionLevelStateSchema,
  type TimelineEntry,
} from "@taki/shared";
import type { RpcNotification, RpcSocket } from "./rpc-socket.ts";

export interface PairingSpec {
  deviceId: string;
  deviceName: string;
  /** Resolves the pairing code the core just logged for this device (with-stack watches the core's stdout). */
  getCode: () => Promise<string>;
}

/** Runs the full operator pairing handshake; resolves once the socket is authenticated. */
export async function pairOperator(socket: RpcSocket, spec: PairingSpec): Promise<void> {
  const identity = { deviceId: spec.deviceId, deviceName: spec.deviceName, role: "operator" as const };
  const first = JsonRpcErrorResponseSchema.parse(await socket.request(CONNECT_METHOD, identity));
  const code = (first.error.data as { code?: string } | undefined)?.code;
  if (code !== "PAIRING_REQUIRED") throw new Error(`expected PAIRING_REQUIRED, got ${String(code)}`);

  const pairingCode = await spec.getCode();
  const second = await socket.request(CONNECT_METHOD, { ...identity, pairingCode });
  ConnectResultSchema.parse(JsonRpcSuccessResponseSchema.parse(second).result);
}

export interface AgentTurn {
  status: "complete" | "error";
  /** The streamed assistant text (joined chat.delta payloads). */
  text: string;
  errorMessage?: string;
}

interface ChatEnd {
  method: string;
  messageId: string;
}

/** Sends one operator chat turn and awaits its end (chat.complete or chat.error) — the L2 agent drive. */
export async function sayToAgent(socket: RpcSocket, message: string, timeoutMs = 120_000): Promise<AgentTurn> {
  const ackFrame = await socket.request(CHAT_METHODS.send, { characterId: "taki", message });
  const { messageId } = ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse(ackFrame).result);

  const isEnd = (note: RpcNotification): boolean =>
    (note.method === CHAT_METHODS.complete || note.method === CHAT_METHODS.error) &&
    (note.params as ChatEnd | undefined)?.messageId === messageId;
  const end = await socket.waitForNotification(isEnd, timeoutMs);

  const text = socket
    .notifications()
    .filter((note) => note.method === CHAT_METHODS.delta)
    .map((note) => ChatDeltaSchema.parse(note.params))
    .filter((delta) => delta.messageId === messageId)
    .map((delta) => delta.delta)
    .join("");

  if (end.method === CHAT_METHODS.error) {
    return { status: "error", text, errorMessage: ChatErrorSchema.parse(end.params).message };
  }
  ChatCompleteSchema.parse(end.params);
  return { status: "complete", text };
}

/**
 * Drives one capability tool's execute via the dev `capability.trigger` method (L1 — no LLM, node-side gate still
 * authorizes). Returns the tool's raw structured result (`{ ok:true, ... }` or `{ ok:false, code, message }`); a failed
 * capability is a normal result, never a thrown error. Requires the stack booted with `devTrigger: true`.
 * `interactive` binds the CALLING operator socket as the Approval owner, so an ask-classified capability prompts
 * exactly this socket (pair it with `awaitApprovalRequest` + `respondApproval` to drive challenge → resume).
 */
export async function triggerCapability(
  socket: RpcSocket,
  spec: { capability: string; input?: unknown; timeoutMs?: number; interactive?: boolean; lifecycle?: boolean },
): Promise<unknown> {
  const frame = await socket.request(
    "capability.trigger",
    { capability: spec.capability, input: spec.input, interactive: spec.interactive, lifecycle: spec.lifecycle },
    spec.timeoutMs,
  );
  return JsonRpcSuccessResponseSchema.parse(frame).result;
}

/** The next pending Approval prompt addressed to THIS operator socket (parsed through the shared schema). */
export async function awaitApprovalRequest(socket: RpcSocket, timeoutMs = 20_000): Promise<z.infer<typeof CanonicalApprovalRequestSchema>> {
  const note = await socket.waitForNotification((candidate: RpcNotification) => candidate.method === APPROVAL_METHODS.request, timeoutMs);
  return CanonicalApprovalRequestSchema.parse(note.params);
}

/** Submits one explicit operator choice for a pending Approval on the same socket that received it. */
export async function respondApproval(
  socket: RpcSocket,
  spec: { approvalId: string; choice: "allow_once" | "allow_session" | "allow_always" | "deny"; expectedApprovalGeneration: number },
): Promise<z.infer<typeof CanonicalApprovalRespondResultSchema>> {
  const frame = await socket.request(APPROVAL_METHODS.respond, spec);
  return CanonicalApprovalRespondResultSchema.parse(JsonRpcSuccessResponseSchema.parse(frame).result);
}

/** Sets the Core Permission Level using the current durable generation; used by post-Slice-3 process scenarios. */
export async function setPermissionLevel(socket: RpcSocket, level: "strict" | "standard" | "relaxed"): Promise<void> {
  const currentFrame = await socket.request("permission.levelGet", {});
  const current = PermissionLevelStateSchema.parse(JsonRpcSuccessResponseSchema.parse(currentFrame).result);
  const setFrame = await socket.request("permission.levelSet", {
    level,
    expectedPolicyGeneration: current.policyGeneration,
  });
  PermissionLevelStateSchema.parse(JsonRpcSuccessResponseSchema.parse(setFrame).result);
}

/**
 * Reads the persisted timeline oldest-first (up to the protocol max page). The hallucination L2 asserts on the
 * roles that survived a turn — a "tool" role appearing proves the turn's tool-call/result were persisted (the fix),
 * its absence is the pre-fix signature. Reads only role/content metadata, never logs the content (R5).
 */
export async function fetchTimelineEntries(socket: RpcSocket, characterId: string): Promise<TimelineEntry[]> {
  const frame = await socket.request(TIMELINE_METHODS.history, {
    characterId,
    limit: TIMELINE_HISTORY_LIMIT_MAX,
  });
  const { entries } = TimelineHistoryResultSchema.parse(JsonRpcSuccessResponseSchema.parse(frame).result);
  // history() is newest-first; return oldest-first so callers read chronologically.
  return [...entries].reverse();
}

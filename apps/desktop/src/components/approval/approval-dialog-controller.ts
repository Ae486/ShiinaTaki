/**
 * INPUT:  one replaceable WsClient generation plus its targeted Approval request/closed notifications
 * OUTPUT: createApprovalDialogController() — FIFO prompts, explicit durable disclosure, expiry, and retirement
 * POS:    ui/components/approval — socket-local ephemeral owner; never persists, navigates, or broadcasts prompts
 */
import type {
  ApprovalChoice,
  CanonicalApprovalRequest,
  CanonicalApprovalRespondParams,
  CanonicalApprovalRespondResult,
} from "@taki/shared";
import type { ApprovalPushEvent } from "@/lib/ws-client-routes.js";

export type ApprovalDialogStatus =
  | { kind: "ready" }
  | { kind: "responding" }
  | { kind: "error"; message: string; dismissible: boolean };

export interface ApprovalDialogSnapshot {
  request: CanonicalApprovalRequest | null;
  queued: number;
  status: ApprovalDialogStatus;
  disclosureAcknowledged: boolean;
}

export interface ApprovalDialogClient {
  approvalRespond(params: CanonicalApprovalRespondParams): Promise<CanonicalApprovalRespondResult>;
  onApproval(handler: (event: ApprovalPushEvent) => void): () => void;
  onClose(handler: () => void): void;
}

export interface ApprovalDialogController {
  replace(client: ApprovalDialogClient | null): void;
  acknowledgeDisclosure(accepted: boolean): void;
  choose(choice: ApprovalChoice): Promise<void>;
  dismiss(): void;
  snapshot(): ApprovalDialogSnapshot;
  dispose(): void;
}

interface ControllerState {
  client: ApprovalDialogClient | null;
  epoch: number;
  pending: Map<string, CanonicalApprovalRequest>;
  expiryTimers: Map<string, ReturnType<typeof setTimeout>>;
  activeId: string | null;
  status: ApprovalDialogStatus;
  disclosureAcknowledged: boolean;
  unsubscribe: (() => void) | null;
}

const INITIAL_SNAPSHOT: ApprovalDialogSnapshot = {
  request: null, queued: 0, status: { kind: "ready" }, disclosureAcknowledged: false,
};

export function createApprovalDialogController(
  publish: (snapshot: ApprovalDialogSnapshot) => void,
): ApprovalDialogController {
  const state: ControllerState = {
    client: null,
    epoch: 0,
    pending: new Map(),
    expiryTimers: new Map(),
    activeId: null,
    status: { kind: "ready" },
    disclosureAcknowledged: false,
    unsubscribe: null,
  };
  return {
    replace: (client) => replaceClient(state, publish, client),
    acknowledgeDisclosure: (accepted) => acknowledgeDisclosure(state, publish, accepted),
    choose: (choice) => choose(state, publish, choice),
    dismiss: () => dismiss(state, publish),
    snapshot: () => snapshot(state),
    dispose: () => replaceClient(state, publish, null),
  };
}

function replaceClient(
  state: ControllerState,
  publish: (snapshot: ApprovalDialogSnapshot) => void,
  client: ApprovalDialogClient | null,
): void {
  state.epoch += 1;
  state.unsubscribe?.();
  state.unsubscribe = null;
  for (const id of state.expiryTimers.keys()) clearExpiry(state, id);
  state.client = client;
  state.pending.clear();
  resetActive(state);
  publish(snapshot(state));
  if (!client) return;
  state.unsubscribe = client.onApproval((event) => receive(state, publish, event));
  const epoch = state.epoch;
  client.onClose(() => {
    if (state.client === client && state.epoch === epoch) replaceClient(state, publish, null);
  });
}

function receive(
  state: ControllerState,
  publish: (snapshot: ApprovalDialogSnapshot) => void,
  event: ApprovalPushEvent,
): void {
  if (event.type === "closed") {
    retire(state, event.closed.approvalId);
    publish(snapshot(state));
    return;
  }
  const { request } = event;
  if (state.pending.has(request.approvalId)) return;
  state.pending.set(request.approvalId, request);
  state.activeId ??= request.approvalId;
  scheduleExpiry(state, publish, request);
  publish(snapshot(state));
}

function scheduleExpiry(
  state: ControllerState,
  publish: (snapshot: ApprovalDialogSnapshot) => void,
  request: CanonicalApprovalRequest,
): void {
  const delay = Math.max(0, Date.parse(request.expiresAt) - Date.now());
  state.expiryTimers.set(request.approvalId, setTimeout(() => {
    if (!state.pending.has(request.approvalId)) return;
    retire(state, request.approvalId);
    publish(snapshot(state));
  }, delay));
}

function acknowledgeDisclosure(
  state: ControllerState,
  publish: (snapshot: ApprovalDialogSnapshot) => void,
  accepted: boolean,
): void {
  const request = activeRequest(state);
  state.disclosureAcknowledged = accepted && request?.disclosureRevision !== undefined;
  if (state.status.kind === "error" && !state.status.dismissible) state.status = { kind: "ready" };
  publish(snapshot(state));
}

async function choose(
  state: ControllerState,
  publish: (snapshot: ApprovalDialogSnapshot) => void,
  choice: ApprovalChoice,
): Promise<void> {
  const client = state.client;
  const request = activeRequest(state);
  if (!client || !request || state.status.kind === "responding") return;
  if (state.status.kind === "error" && state.status.dismissible) return;
  if (choice === "allow_always" && request.disclosureRevision === undefined) {
    state.status = { kind: "error", message: "当前请求缺少披露版本，无法提交始终允许。", dismissible: false };
    publish(snapshot(state));
    return;
  }
  if (choice === "allow_always" && !state.disclosureAcknowledged) {
    state.status = { kind: "error", message: "请先单独确认当前未来后台运行披露。", dismissible: false };
    publish(snapshot(state));
    return;
  }
  const token = state.epoch;
  state.status = { kind: "responding" };
  publish(snapshot(state));
  try {
    const result = await client.approvalRespond(responseParams(request, choice, state.disclosureAcknowledged));
    if (!isCurrent(state, client, { token, approvalId: request.approvalId })) return;
    applyResponse(state, request.approvalId, result);
  } catch {
    if (isCurrent(state, client, { token, approvalId: request.approvalId })) {
      state.status = { kind: "error", message: "提交审批失败；未假定任何授权。", dismissible: false };
    }
  }
  if (state.client === client && state.epoch === token) publish(snapshot(state));
}

function responseParams(
  request: CanonicalApprovalRequest,
  choice: ApprovalChoice,
  disclosureAcknowledged: boolean,
): CanonicalApprovalRespondParams {
  const base = { approvalId: request.approvalId, choice, expectedApprovalGeneration: request.approvalGeneration };
  if (choice !== "allow_always") return base;
  if (!disclosureAcknowledged || request.disclosureRevision === undefined) {
    throw new Error("current disclosure acknowledgement missing");
  }
  return {
    ...base,
    disclosure: { revision: request.disclosureRevision, futureBackgroundUseAccepted: true },
  };
}

function applyResponse(
  state: ControllerState,
  approvalId: string,
  result: CanonicalApprovalRespondResult,
): void {
  if (result.status === "accepted") {
    retire(state, approvalId);
    return;
  }
  if (result.status === "disclosure_required") state.disclosureAcknowledged = false;
  state.status = {
    kind: "error",
    message: responseStatusMessage(result.status),
    dismissible: isTerminalResponse(result.status),
  };
}

function responseStatusMessage(status: CanonicalApprovalRespondResult["status"]): string {
  switch (status) {
    case "late": return "此审批已结束，Core 未执行这次响应。";
    case "wrong_session": return "此审批属于另一条连接，当前窗口不能处理。";
    case "invalidated": return "此审批已因状态变化失效。";
    case "scope_not_allowed": return "该允许范围不适用于当前操作，请选择其他选项。";
    case "stale_generation": return "审批状态已变化，请等待 Core 刷新此请求。";
    case "disclosure_required": return "始终允许需要当前的未来后台运行披露确认。";
    case "accepted": return "审批响应已接受。";
  }
}

function isTerminalResponse(status: CanonicalApprovalRespondResult["status"]): boolean {
  return status === "late" || status === "wrong_session" || status === "invalidated" || status === "stale_generation";
}

function retire(state: ControllerState, approvalId: string): void {
  clearExpiry(state, approvalId);
  const wasActive = state.activeId === approvalId;
  state.pending.delete(approvalId);
  if (!wasActive) return;
  state.activeId = firstPendingId(state.pending);
  resetPromptState(state);
}

function clearExpiry(state: ControllerState, approvalId: string): void {
  const timer = state.expiryTimers.get(approvalId);
  if (timer === undefined) return;
  clearTimeout(timer);
  state.expiryTimers.delete(approvalId);
}

function resetActive(state: ControllerState): void {
  state.activeId = null;
  resetPromptState(state);
}

function resetPromptState(state: ControllerState): void {
  state.status = { kind: "ready" };
  state.disclosureAcknowledged = false;
}

function snapshot(state: ControllerState): ApprovalDialogSnapshot {
  const request = activeRequest(state);
  return request
    ? { request, queued: Math.max(0, state.pending.size - 1), status: state.status, disclosureAcknowledged: state.disclosureAcknowledged }
    : INITIAL_SNAPSHOT;
}

function activeRequest(state: ControllerState): CanonicalApprovalRequest | null {
  return state.activeId ? state.pending.get(state.activeId) ?? null : null;
}

function firstPendingId(pending: Map<string, CanonicalApprovalRequest>): string | null {
  return pending.keys().next().value ?? null;
}

function dismiss(state: ControllerState, publish: (snapshot: ApprovalDialogSnapshot) => void): void {
  if (!state.activeId || state.status.kind !== "error" || !state.status.dismissible) return;
  retire(state, state.activeId);
  publish(snapshot(state));
}

function isCurrent(
  state: ControllerState,
  client: ApprovalDialogClient,
  response: { token: number; approvalId: string },
): boolean {
  return state.client === client
    && state.epoch === response.token
    && state.pending.has(response.approvalId)
    && state.activeId === response.approvalId;
}

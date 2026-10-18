/**
 * INPUT:  replaceable authenticated WsClient generations (one status read — memory.authority.status or
 *         memory.activation.status — memory.operations.submit/cancel, the memory.operations.changed push) and a sink
 *         for validated views/outcomes.
 * OUTPUT: createMemoryOperationsController() — current-generation-only status reads behind the push subscription,
 *         serialized generic submit/cancel, one push subscription per generation, and coalesced refetch on every
 *         changed push and after every mutation outcome (Core is the only truth).
 * POS:    ui/windows/home/pages/operations — framework-free authority guard shared by the Stage 1 and Hindsight
 *         activation cards; never replays a timed-out mutation and never derives an operation outcome locally.
 */
import type { WsClient } from "@/lib/ws-client.js";
import { RpcDeadlineExceededError } from "@/lib/rpc-deadline.js";
import type { MemoryOperation, MemoryOperationRequest, MemoryReplicaRunKind } from "@taki/shared";
import { MEMORY_OPERATION_KIND_LABEL, memoryOperationAppError } from "./memory-authority-state.ts";

export interface MemoryOperationsFeedback { tone: "ok" | "warn" | "danger"; message: string }

export interface MemoryOperationsSink<TStatus> {
  loading(): void;
  loaded(status: TStatus): void;
  loadFailed(cause: unknown): void;
  mutationStarted(key: string): void;
  mutationSettled(feedback: MemoryOperationsFeedback | null): void;
}

export interface MemoryOperationsController {
  replace(client: MemoryOperationsClient | null): void;
  refresh(): Promise<void>;
  /** Submits one durable request under the serialized mutation guard; `key` names the pending control for the card. */
  submit(request: MemoryOperationRequest, key: string): Promise<void>;
  submitSync(bankId: string, syncKind: MemoryReplicaRunKind): Promise<void>;
  cancel(operationId: string): Promise<void>;
  dispose(): void;
}

export type MemoryOperationsClient = Pick<
  WsClient,
  "memoryAuthorityStatus" | "memoryActivationStatus" | "memoryOperationSubmit" | "memoryOperationCancel" | "subscribeMemoryOperations" | "onMemoryOperationChanged"
>;

export type MemoryStatusReader<TStatus> = (client: MemoryOperationsClient) => Promise<TStatus>;

interface ControllerState<TStatus> {
  client: MemoryOperationsClient | null;
  epoch: number;
  mutating: boolean;
  refreshing: boolean;
  /** A changed push that arrived mid-read: one more read follows so the last frame is never dropped. */
  dirty: boolean;
  /** The generation's push subscription; reads wait for it so no change lands between the read and the subscription. */
  subscribed: Promise<void> | null;
  unsubscribe: (() => void) | null;
  read: MemoryStatusReader<TStatus>;
  sink: MemoryOperationsSink<TStatus>;
  feedbackForError: (cause: unknown) => MemoryOperationsFeedback;
}

function isCurrent<T>(state: ControllerState<T>, candidate: MemoryOperationsClient, token: number): boolean {
  return state.client === candidate && state.epoch === token;
}

function subscribed<T>(state: ControllerState<T>, candidate: MemoryOperationsClient, token: number): Promise<void> {
  state.subscribed ??= candidate.subscribeMemoryOperations().catch((cause: unknown) => {
    // Without the push channel the card still tells the truth: every mutation and remount re-reads Core; nothing polls.
    if (isCurrent(state, candidate, token)) { state.subscribed = null; state.sink.mutationSettled(state.feedbackForError(cause)); }
  });
  return state.subscribed;
}

async function refreshController<T>(state: ControllerState<T>): Promise<void> {
  const candidate = state.client;
  if (!candidate) return;
  if (state.refreshing) { state.dirty = true; return; }
  const token = state.epoch;
  state.refreshing = true;
  state.sink.loading();
  try {
    await subscribed(state, candidate, token);
    if (!isCurrent(state, candidate, token)) return;
    const status = await state.read(candidate);
    if (isCurrent(state, candidate, token)) state.sink.loaded(status);
  } catch (cause) {
    if (isCurrent(state, candidate, token)) state.sink.loadFailed(cause);
  } finally {
    if (state.epoch === token) state.refreshing = false;
  }
  if (state.dirty && isCurrent(state, candidate, token)) {
    state.dirty = false;
    await refreshController(state);
  }
}

interface MutationSpec {
  key: string;
  operation: (candidate: MemoryOperationsClient) => Promise<MemoryOperationsFeedback>;
}

async function mutateController<T>(state: ControllerState<T>, spec: MutationSpec): Promise<void> {
  const candidate = state.client;
  if (!candidate || state.mutating) return;
  const token = state.epoch;
  state.mutating = true;
  state.sink.mutationStarted(spec.key);
  try {
    const feedback = await spec.operation(candidate);
    if (!isCurrent(state, candidate, token)) return;
    state.sink.mutationSettled(feedback);
  } catch (cause) {
    if (!isCurrent(state, candidate, token)) return;
    state.sink.mutationSettled(state.feedbackForError(cause));
  } finally {
    if (state.epoch === token) state.mutating = false;
  }
  // Every outcome (accepted, refused or lost) is re-read from Core rather than patched into the last frame.
  await refreshController(state);
}

function refusalFeedback(cause: unknown): MemoryOperationsFeedback {
  if (cause instanceof RpcDeadlineExceededError && cause.outcomeUnknown) {
    return { tone: "warn", message: "请求超时，操作结果未知。正在重新读取 Core 状态，请根据结果选择下一步。" };
  }
  const { code, reason, activeOperationId } = memoryOperationAppError(cause);
  if (code === "MEMORY_OPERATION_REFUSED") {
    const suffix = activeOperationId ? `（进行中：${activeOperationId}）` : "";
    return { tone: "warn", message: `Core 拒绝了该操作：${reason ?? code}${suffix}` };
  }
  return { tone: "danger", message: cause instanceof Error ? cause.message : String(cause) };
}

function acceptedFeedback(request: MemoryOperationRequest, operation: MemoryOperation): MemoryOperationsFeedback {
  if (request.kind === "replica.sync") return { tone: "ok", message: `已受理 ${request.syncKind} 同步：${operation.operationId}` };
  return { tone: "ok", message: `Core 已受理「${MEMORY_OPERATION_KIND_LABEL[request.kind]}」；是否完成以最新状态为准。` };
}

function retire<T>(state: ControllerState<T>): void {
  state.epoch += 1;
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.subscribed = null;
  state.client = null;
  state.mutating = false;
  state.refreshing = false;
  state.dirty = false;
}

export function createMemoryOperationsController<TStatus>(sink: MemoryOperationsSink<TStatus>, read: MemoryStatusReader<TStatus>,
  feedbackForError: (cause: unknown) => MemoryOperationsFeedback = refusalFeedback): MemoryOperationsController {
  const state: ControllerState<TStatus> = {
    client: null, epoch: 0, mutating: false, refreshing: false, dirty: false, subscribed: null, unsubscribe: null, read, sink, feedbackForError,
  };
  const submit = (request: MemoryOperationRequest, key: string) => mutateController(state, {
    key,
    operation: async (candidate) => acceptedFeedback(request, await candidate.memoryOperationSubmit(request)),
  });
  return {
    replace(next) {
      retire(state);
      state.client = next;
      if (!next) { sink.loading(); return; }
      const token = state.epoch;
      state.unsubscribe = next.onMemoryOperationChanged(() => {
        if (isCurrent(state, next, token)) void refreshController(state);
      });
      void refreshController(state);
    },
    refresh: () => refreshController(state),
    submit,
    submitSync: (bankId, syncKind) => submit({ kind: "replica.sync", bankId, syncKind }, `sync:${bankId}`),
    cancel: (operationId) => mutateController(state, {
      key: `cancel:${operationId}`,
      operation: async (candidate) => {
        const operation = await candidate.memoryOperationCancel(operationId);
        return { tone: "ok", message: `已取消 ${operation.operationId}` };
      },
    }),
    dispose: () => retire(state),
  };
}

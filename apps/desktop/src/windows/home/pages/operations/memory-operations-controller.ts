/**
 * INPUT:  replaceable authenticated WsClient generations (memory.authority.status, memory.operations.submit/cancel,
 *         the memory.operations.changed push) and a sink for validated views/outcomes.
 * OUTPUT: createMemoryOperationsController() — current-generation-only status reads, serialized submit/cancel, one
 *         push subscription per generation, and coalesced refetch on every changed push (Core is the only truth).
 * POS:    ui/windows/home/pages/operations — framework-free authority guard in the MCP-controller shape; never
 *         replays a timed-out mutation and never derives an operation outcome locally.
 */
import type { WsClient } from "@/lib/ws-client.js";
import type { MemoryAuthorityStatus, MemoryReplicaRunKind } from "@taki/shared";
import { memoryOperationAppError } from "./memory-authority-state.ts";

export interface MemoryOperationsFeedback { tone: "ok" | "warn" | "danger"; message: string }

export interface MemoryOperationsSink {
  loading(): void;
  loaded(status: MemoryAuthorityStatus): void;
  loadFailed(cause: unknown): void;
  mutationStarted(key: string): void;
  mutationSettled(feedback: MemoryOperationsFeedback | null): void;
}

export interface MemoryOperationsController {
  replace(client: MemoryOperationsClient | null): void;
  refresh(): Promise<void>;
  submitSync(bankId: string, syncKind: MemoryReplicaRunKind): Promise<void>;
  cancel(operationId: string): Promise<void>;
  dispose(): void;
}

export type MemoryOperationsClient = Pick<
  WsClient,
  "memoryAuthorityStatus" | "memoryOperationSubmit" | "memoryOperationCancel" | "subscribeMemoryOperations" | "onMemoryOperationChanged"
>;

interface ControllerState {
  client: MemoryOperationsClient | null;
  epoch: number;
  mutating: boolean;
  refreshing: boolean;
  /** A changed push that arrived mid-read: one more read follows so the last frame is never dropped. */
  dirty: boolean;
  unsubscribe: (() => void) | null;
}

function isCurrent(state: ControllerState, candidate: MemoryOperationsClient, token: number): boolean {
  return state.client === candidate && state.epoch === token;
}

async function refreshController(state: ControllerState, sink: MemoryOperationsSink): Promise<void> {
  const candidate = state.client;
  if (!candidate) return;
  if (state.refreshing) { state.dirty = true; return; }
  const token = state.epoch;
  state.refreshing = true;
  sink.loading();
  try {
    const status = await candidate.memoryAuthorityStatus();
    if (isCurrent(state, candidate, token)) sink.loaded(status);
  } catch (cause) {
    if (isCurrent(state, candidate, token)) sink.loadFailed(cause);
  } finally {
    if (state.epoch === token) state.refreshing = false;
  }
  if (state.dirty && isCurrent(state, candidate, token)) {
    state.dirty = false;
    await refreshController(state, sink);
  }
}

interface MutationSpec {
  key: string;
  operation: (candidate: MemoryOperationsClient) => Promise<MemoryOperationsFeedback>;
}

async function mutateController(state: ControllerState, sink: MemoryOperationsSink, spec: MutationSpec): Promise<void> {
  const candidate = state.client;
  if (!candidate || state.mutating) return;
  const token = state.epoch;
  state.mutating = true;
  sink.mutationStarted(spec.key);
  try {
    const feedback = await spec.operation(candidate);
    if (!isCurrent(state, candidate, token)) return;
    sink.mutationSettled(feedback);
  } catch (cause) {
    if (!isCurrent(state, candidate, token)) return;
    sink.mutationSettled(refusalFeedback(cause));
  } finally {
    if (state.epoch === token) state.mutating = false;
  }
  // Every outcome (accepted or refused) is re-read from Core rather than patched into the last frame.
  await refreshController(state, sink);
}

function refusalFeedback(cause: unknown): MemoryOperationsFeedback {
  const { code, reason, activeOperationId } = memoryOperationAppError(cause);
  if (code === "MEMORY_OPERATION_REFUSED") {
    const suffix = activeOperationId ? `（进行中：${activeOperationId}）` : "";
    return { tone: "warn", message: `Core 拒绝了该操作：${reason ?? code}${suffix}` };
  }
  return { tone: "danger", message: cause instanceof Error ? cause.message : String(cause) };
}

function installSubscription(state: ControllerState, sink: MemoryOperationsSink, candidate: MemoryOperationsClient): void {
  const token = state.epoch;
  state.unsubscribe = candidate.onMemoryOperationChanged(() => {
    if (isCurrent(state, candidate, token)) void refreshController(state, sink);
  });
  candidate.subscribeMemoryOperations().catch((cause: unknown) => {
    // Without the push channel the card still tells the truth: every mutation and remount re-reads Core; nothing polls.
    if (isCurrent(state, candidate, token)) sink.mutationSettled(refusalFeedback(cause));
  });
}

function retire(state: ControllerState): void {
  state.epoch += 1;
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.client = null;
  state.mutating = false;
  state.refreshing = false;
  state.dirty = false;
}

export function createMemoryOperationsController(sink: MemoryOperationsSink): MemoryOperationsController {
  const state: ControllerState = { client: null, epoch: 0, mutating: false, refreshing: false, dirty: false, unsubscribe: null };
  return {
    replace(next) {
      retire(state);
      state.client = next;
      if (!next) { sink.loading(); return; }
      installSubscription(state, sink, next);
      void refreshController(state, sink);
    },
    refresh: () => refreshController(state, sink),
    submitSync: (bankId, syncKind) => mutateController(state, sink, {
      key: `sync:${bankId}`,
      operation: async (candidate) => {
        const operation = await candidate.memoryOperationSubmit({ kind: "replica.sync", bankId, syncKind });
        return { tone: "ok", message: `已受理 ${syncKind} 同步：${operation.operationId}` };
      },
    }),
    cancel: (operationId) => mutateController(state, sink, {
      key: `cancel:${operationId}`,
      operation: async (candidate) => {
        const operation = await candidate.memoryOperationCancel(operationId);
        return { tone: "ok", message: `已取消 ${operation.operationId}` };
      },
    }),
    dispose: () => retire(state),
  };
}

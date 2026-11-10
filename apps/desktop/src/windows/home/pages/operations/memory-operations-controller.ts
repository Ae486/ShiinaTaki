/**
 * INPUT:  replaceable authenticated WsClient generations (memory.authority.status, memory.operations.submit/cancel,
 *         the memory.operations.changed push) and a sink for validated views/outcomes.
 * OUTPUT: createMemoryOperationsController() — current-generation-only status reads, serialized submit/cancel, one
 *         accepted push subscription per generation, and acknowledgement-gated coalesced reads with explicit retry.
 * POS:    ui/windows/home/pages/operations — framework-free authority guard in the MCP-controller shape; never
 *         replays a timed-out mutation and never derives an operation outcome locally.
 */
import type { WsClient } from "@/lib/ws-client.js";
import type { MemoryAuthorityStatus, MemoryOperation, MemoryReplicaRunKind } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { memoryOperationAppError } from "./memory-authority-state.ts";

export interface MemoryOperationsFeedback { tone: "ok" | "warn" | "danger"; message: string; scope?: "tidy"; operationId?: string }

export interface MemoryOperationsSink {
  loading(): void;
  loaded(status: MemoryAuthorityStatus): void;
  loadFailed(cause: unknown): void;
  tidyLoaded(operation: MemoryOperation | null): void;
  tidyLoadFailed(cause: unknown): void;
  mutationStarted(key: string): void;
  mutationSettled(feedback: MemoryOperationsFeedback | null): void;
}

export interface MemoryOperationsController {
  replace(client: MemoryOperationsClient | null): void;
  setVisible(visible: boolean): void;
  refresh(): Promise<void>;
  submitSync(bankId: string, syncKind: MemoryReplicaRunKind): Promise<void>;
  submitTidy(): Promise<void>;
  cancel(operationId: string): Promise<void>;
  dispose(): void;
}

export type MemoryOperationsClient = Pick<
  WsClient,
  "memoryAuthorityStatus" | "memoryOperationSubmit" | "memoryOperationCancel" | "memoryOperationList" | "memoryOperationStatus"
  | "subscribeMemoryOperations" | "onMemoryOperationChanged"
>;

interface ControllerState {
  client: MemoryOperationsClient | null;
  epoch: number;
  readEpoch: number;
  visible: boolean;
  pendingMutation: (() => void) | null;
  subscribed: boolean;
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
  if (!state.visible) { state.dirty = true; return; }
  const readEpoch = state.readEpoch;
  if (state.refreshing) { state.dirty = true; return; }
  const token = state.epoch;
  state.refreshing = true;
  sink.loading();
  try {
    if (!state.subscribed) {
      await candidate.subscribeMemoryOperations();
      if (isCurrent(state, candidate, token)) state.subscribed = true;
    }
    if (isCurrent(state, candidate, token) && state.visible && state.readEpoch === readEpoch) {
      // This baseline covers hints received before setup completed. Later hints retain one trailing read.
      state.dirty = false;
      const current = () => isCurrent(state, candidate, token) && state.visible && state.readEpoch === readEpoch;
      await Promise.all([
        candidate.memoryAuthorityStatus().then((status) => { if (current()) sink.loaded(status); },
          (cause: unknown) => { if (current()) sink.loadFailed(cause); }),
        candidate.memoryOperationList({ kind: "tidy", characterId: ACTIVE_CHARACTER_ID, includeTerminal: true, limit: 1 })
          .then((operations) => { if (current()) sink.tidyLoaded(operations[0] ?? null); },
            (cause: unknown) => { if (current()) sink.tidyLoadFailed(cause); }),
      ]);
    }
  } catch (cause) {
    if (isCurrent(state, candidate, token) && state.visible && state.readEpoch === readEpoch) {
      sink.loadFailed(cause); sink.tidyLoadFailed(cause);
    }
  } finally {
    if (state.epoch === token) state.refreshing = false;
  }
  // Failed setup waits for another explicit demand; a queued push must not create a retry loop.
  if (state.subscribed && state.dirty && state.visible && isCurrent(state, candidate, token)) {
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
  if (state.subscribed) state.readEpoch += 1;
  state.dirty = true;
  publishMutation(state, () => sink.mutationStarted(spec.key));
  try {
    const feedback = await spec.operation(candidate);
    if (!isCurrent(state, candidate, token)) return;
    publishMutation(state, () => sink.mutationSettled(feedback));
  } catch (cause) {
    if (!isCurrent(state, candidate, token)) return;
    publishMutation(state, () => sink.mutationSettled(spec.key === "tidy" ? tidyRefusal(cause) : refusalFeedback(cause)));
  } finally {
    if (state.epoch === token) state.mutating = false;
  }
  // Every outcome (accepted or refused) is re-read from Core rather than patched into the last frame.
  await refreshController(state, sink);
}

function refusalFeedback(cause: unknown): MemoryOperationsFeedback {
  const { code, reason } = memoryOperationAppError(cause);
  if (code === "MEMORY_OPERATION_REFUSED") {
    return { tone: "warn", message: `Core 拒绝了该操作：${reason ?? code}` };
  }
  return { tone: "danger", message: cause instanceof Error ? cause.message : String(cause) };
}

function installSubscription(state: ControllerState, sink: MemoryOperationsSink, candidate: MemoryOperationsClient): void {
  const token = state.epoch;
  state.unsubscribe = candidate.onMemoryOperationChanged(() => {
    if (isCurrent(state, candidate, token)) void refreshController(state, sink);
  });
  void refreshController(state, sink);
}

function retire(state: ControllerState): void {
  state.epoch += 1;
  state.readEpoch += 1;
  state.pendingMutation = null;
  state.subscribed = false;
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.client = null;
  state.mutating = false;
  state.refreshing = false;
  state.dirty = false;
}

export function createMemoryOperationsController(sink: MemoryOperationsSink): MemoryOperationsController {
  const state: ControllerState = { client: null, epoch: 0, readEpoch: 0, visible: true, pendingMutation: null,
    subscribed: false, mutating: false, refreshing: false, dirty: false, unsubscribe: null };
  return {
    replace(next) {
      retire(state);
      state.client = next;
      if (!next) { if (state.visible) sink.loading(); return; }
      installSubscription(state, sink, next);
    },
    setVisible(visible) {
      if (state.visible === visible) return;
      state.visible = visible;
      state.readEpoch += 1;
      state.dirty = true;
      if (!visible) return;
      const pending = state.pendingMutation; state.pendingMutation = null; pending?.();
      if (!state.refreshing) state.dirty = false;
      void refreshController(state, sink);
    },
    refresh: () => refreshController(state, sink),
    submitSync: (bankId, syncKind) => mutateController(state, sink, {
      key: `sync:${bankId}`,
      operation: async (candidate) => {
        await candidate.memoryOperationSubmit({ kind: "replica.sync", bankId, syncKind });
        return { tone: "ok", message: syncKind === "full" ? "已受理完整对账。" : "已受理增量同步。" };
      },
    }),
    submitTidy: () => mutateController(state, sink, {
      key: "tidy",
      operation: submitTidy,
    }),
    cancel: (operationId) => mutateController(state, sink, {
      key: `cancel:${operationId}`,
      operation: async (candidate) => {
        await candidate.memoryOperationCancel(operationId);
        return { tone: "ok", message: "已取消同步操作。" };
      },
    }),
    dispose: () => retire(state),
  };
}

// Visibility retires read authority only: the mutation lock and terminal outcome survive a hidden page.
function publishMutation(state: ControllerState, publish: () => void): void {
  if (state.visible) publish(); else state.pendingMutation = publish;
}

async function submitTidy(candidate: MemoryOperationsClient): Promise<MemoryOperationsFeedback> {
  try {
    const operation = await candidate.memoryOperationSubmit({ kind: "tidy", characterId: ACTIVE_CHARACTER_ID });
    return { scope: "tidy", tone: "ok", operationId: operation.operationId, message: "整理已受理，关闭此页面不会中断执行。" };
  } catch (cause) {
    const error = memoryOperationAppError(cause);
    if (error.reason !== "MEMORY_OPERATION_BUSY" || !error.activeOperationId) throw cause;
    await candidate.subscribeMemoryOperations();
    const operation = await candidate.memoryOperationStatus(error.activeOperationId);
    return { scope: "tidy", tone: "warn", operationId: operation.operationId, message: operation.terminalAt === null
      ? "已有记忆整理正在执行，正在读取进度。"
      : "此前的整理已结束，正在读取结果；如需继续，请再次操作。" };
  }
}

function tidyRefusal(cause: unknown): MemoryOperationsFeedback {
  const error = memoryOperationAppError(cause);
  return { scope: "tidy", tone: "warn", message: error.code === "MEMORY_OPERATION_REFUSED"
    ? "当前无法开始整理，请刷新状态；若记忆服务不可用，请先检查配置与连接。"
    : "尚未确认整理是否受理，请先刷新状态核对；系统不会自动重复提交。" };
}

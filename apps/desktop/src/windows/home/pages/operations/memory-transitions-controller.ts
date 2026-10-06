/**
 * INPUT: replaceable operator clients and explicit preview/confirm/cancel events.
 * OUTPUT: disposable preview state over the existing subscription/read/mutation controller.
 * POS: ui/operations — one confirmation consumes one request identity; reconnect is observation only.
 */
import type { MemoryTransitionOverview, MemoryTransitionPreview, MemoryTransitionRequest } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createMemoryOperationsController, type MemoryOperationsClient, type MemoryOperationsFeedback } from "./memory-operations-controller.ts";
import { transitionError, transitionRequest, transitionMutationFeedback } from "./memory-transition-state.ts";

export type MemoryTransitionsClient = MemoryOperationsClient & Pick<WsClient, "memoryTransitionOverview" | "memoryTransitionPreview">;
export interface MemoryTransitionsState {
  status: MemoryTransitionOverview | null; loading: boolean; error: string | null; busyKey: string | null;
  feedback: MemoryOperationsFeedback | null; preview: MemoryTransitionPreview | null; previewLoading: boolean; previewError: string | null;
}
export const INITIAL_TRANSITIONS: MemoryTransitionsState = { status: null, loading: true, error: null, busyKey: null,
  feedback: null, preview: null, previewLoading: false, previewError: null };

export function createMemoryTransitionsController(sink: (state: MemoryTransitionsState) => void,
  identity: () => string = () => crypto.randomUUID()) {
  let state = INITIAL_TRANSITIONS;
  let client: MemoryTransitionsClient | null = null;
  let generation = 0; let request: MemoryTransitionRequest | null = null;
  const update = (patch: Partial<MemoryTransitionsState>) => { state = { ...state, ...patch }; sink(state); };
  const dismiss = () => { generation++; request = null; update({ preview: null, previewLoading: false, previewError: null }); };
  const operations = createMemoryOperationsController<MemoryTransitionOverview>({
    loading: () => update({ loading: true }),
    loaded: (status) => {
      if (state.status && state.status.epochId !== status.epochId) dismiss();
      update({ status, loading: false, error: null });
    },
    loadFailed: (cause) => update({ loading: false, error: transitionError(cause) }),
    mutationStarted: (busyKey) => update({ busyKey, feedback: null }),
    mutationSettled: (feedback) => update({ busyKey: null, feedback }),
  }, (candidate) => {
    if (!client || candidate !== client) return Promise.reject(new Error("retired transition client"));
    return client.memoryTransitionOverview();
  }, transitionMutationFeedback);
  const allowed = (kind: MemoryTransitionPreview["kind"], recoveryTransitionId?: string) => {
    if (!client || !state.status || state.loading || state.error || state.busyKey) return false;
    return recoveryTransitionId
      ? state.status.entries.some((entry) => entry.operation.producer?.kind === "transition"
        && entry.operation.producer.transitionId === recoveryTransitionId && entry.operation.kind === kind && entry.recovery.allowed)
      : state.status.actions.some((action) => action.kind === kind && action.allowed);
  };
  return {
    replace(next: MemoryTransitionsClient | null) {
      dismiss(); client = next; update({ busyKey: null }); operations.replace(next);
    },
    refresh: () => operations.refresh(),
    dismiss,
    async preview(kind: MemoryTransitionPreview["kind"], recoveryTransitionId?: string) {
      if (!allowed(kind, recoveryTransitionId)) return;
      const candidate = client; if (!candidate) return;
      dismiss(); const token = generation;
      update({ previewLoading: true });
      try {
        const preview = await candidate.memoryTransitionPreview({ kind, ...(recoveryTransitionId ? { recoveryTransitionId } : {}) });
        if (token !== generation || candidate !== client) return;
        request = transitionRequest(preview, identity()); update({ preview, previewLoading: false });
      } catch (cause) {
        if (token === generation && candidate === client) update({ previewLoading: false, previewError: transitionError(cause) });
      }
    },
    async confirm() {
      const submitted = request; const preview = state.preview;
      if (!submitted || !preview || !allowed(preview.kind, preview.recovery?.transitionId)) return;
      if (Date.parse(preview.expiresAt) <= Date.now()) { dismiss(); update({ previewError: "预览已过期，请重新预览。" }); return; }
      // Consume synchronously before the async admission so double activation cannot submit twice.
      dismiss(); await operations.submit(submitted, `transition:${submitted.requestId}`);
    },
    async cancel(operationId: string) {
      if (!client || state.loading || state.error || state.busyKey
        || !state.status?.entries.some((entry) => entry.operation.operationId === operationId && entry.cancel.allowed)) return;
      dismiss(); await operations.cancel(operationId);
    },
    dispose() { dismiss(); client = null; operations.dispose(); },
  };
}

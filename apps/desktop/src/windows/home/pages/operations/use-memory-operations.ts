/**
 * INPUT:  the authenticated Home WsClient generation and the framework-free memory-operations controller.
 * OUTPUT: useMemoryOperations() — the composite memory.authority.status view, one changed-push subscription per
 *         connection, latest Character tidy result and serialized tidy/sync/cancel actions; nothing is persisted or replayed.
 * POS:    ui/windows/home/pages/operations — the only React seam for memory.operations.*; glue only, the view model
 *         lives in memory-authority-state.ts and the authority guard in memory-operations-controller.ts.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { MemoryAuthorityStatus, MemoryOperation, MemoryOperationRequest, MemoryReplicaRunKind, MemoryReplicaScheduleConfig } from "@taki/shared";
import { usePageActive } from "../../page-visibility-store.ts";
import { useHomeClient } from "../../home-client-context.ts";
import {
  createMemoryOperationsController,
  type MemoryOperationsClient,
  type MemoryOperationsFeedback,
} from "./memory-operations-controller.ts";

export interface MemoryOperationsState {
  status: MemoryAuthorityStatus | null;
  loading: boolean;
  error: string | null;
  busyKey: string | null;
  feedback: MemoryOperationsFeedback | null;
  tidy: MemoryOperation | null;
  tidyLoading: boolean;
  tidyError: string | null;
}

export interface MemoryOperationsView extends MemoryOperationsState {
  connectionReady: boolean;
  refresh(): Promise<void>;
  submitSync(bankId: string, syncKind: MemoryReplicaRunKind): Promise<void>;
  submitTidy(): Promise<void>;
  submit(request: MemoryOperationRequest, key: string): Promise<void>;
  configureSync(bankId: string, config: MemoryReplicaScheduleConfig): Promise<void>;
  cancel(operationId: string): Promise<void>;
}

const INITIAL: MemoryOperationsState = { status: null, loading: true, error: null, busyKey: null, feedback: null,
  tidy: null, tidyLoading: true, tidyError: null };

export function useMemoryOperations(): MemoryOperationsView {
  const { client, status: connection } = useHomeClient();
  const visible = usePageActive("operations");
  const ready: MemoryOperationsClient | null = client && connection.kind === "connected" ? client : null;
  const [state, setState] = useState<MemoryOperationsState>(INITIAL);
  const controller = useMemo(() => createMemoryOperationsController({
    loading: () => setState((current) => ({ ...current, loading: current.status === null, tidyLoading: true })),
    loaded: (status) => setState((current) => ({ ...current, status, loading: false, error: null })),
    // A failed re-read keeps the last frame on screen; the error line carries the retry.
    loadFailed: (cause) => setState((current) => ({ ...current, loading: false, error: cause instanceof Error ? cause.message : String(cause) })),
    tidyLoaded: (tidy) => setState((current) => ({ ...current, tidy, tidyLoading: false, tidyError: null,
      feedback: tidy?.terminalAt && current.feedback?.operationId === tidy.operationId ? null : current.feedback })),
    tidyLoadFailed: () => setState((current) => ({ ...current, tidyLoading: false, tidyError: "整理状态读取失败；已显示的结果可能不是最新状态，请刷新重试。" })),
    mutationStarted: (busyKey) => setState((current) => ({ ...current, busyKey, feedback: null })),
    mutationSettled: (feedback) => setState((current) => ({ ...current, busyKey: null, feedback })),
  }), []);

  // Retire reads before a retained page hides; keep the same mutation owner and current-client lock.
  useLayoutEffect(() => controller.setVisible(visible), [controller, visible]);

  useEffect(() => {
    setState((current) => ({ ...current, busyKey: null, feedback: null }));
    controller.replace(ready);
    return () => controller.replace(null);
  }, [controller, ready]);
  useEffect(() => () => controller.dispose(), [controller]);

  const refresh = useCallback(() => controller.refresh(), [controller]);
  const submitSync = useCallback((bankId: string, syncKind: MemoryReplicaRunKind) => controller.submitSync(bankId, syncKind), [controller]);
  const submitTidy = useCallback(() => controller.submitTidy(), [controller]);
  const submit = useCallback((request: MemoryOperationRequest, key: string) => controller.submit(request, key), [controller]);
  const configureSync = useCallback((bankId: string, config: MemoryReplicaScheduleConfig) => controller.configureSync(bankId, config), [controller]);
  const cancel = useCallback((operationId: string) => controller.cancel(operationId), [controller]);

  return { ...state, connectionReady: ready !== null, refresh, submit, submitSync, submitTidy, configureSync, cancel };
}

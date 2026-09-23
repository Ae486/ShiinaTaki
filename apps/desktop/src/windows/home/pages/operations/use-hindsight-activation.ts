/**
 * INPUT:  the Home authenticated client generation, Operations page visibility and the generic memory-operations controller
 * OUTPUT: useHindsightActivation() — disposable memory.activation.status snapshots and the explicit setup/activate/resume/recover/cancel actions
 * POS:    ui/windows/home/pages/operations — React lifecycle bridge; a hidden page retires the generation (no reads, no
 *         publishes) and showing it again re-reads once; the controller owns every asynchronous guard
 */
import { useEffect, useMemo, useState } from "react";
import type { MemoryActivationStatus } from "@taki/shared";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageVisible } from "../../page-visibility-store.ts";
import { dispatchActivation, type ActivationAction } from "./hindsight-activation-actions.ts";
import { initialActivationState, type HindsightActivationState } from "./hindsight-activation-state.ts";
import { createMemoryOperationsController, type MemoryOperationsClient } from "./memory-operations-controller.ts";

export interface HindsightActivationView extends HindsightActivationState {
  connectionReady: boolean;
  refresh(): Promise<void>;
  execute(action: ActivationAction): Promise<void>;
}

const readActivation = (client: MemoryOperationsClient) => client.memoryActivationStatus();

export function useHindsightActivation(): HindsightActivationView {
  const { client, status: connection } = useHomeClient();
  const visible = usePageVisible("operations");
  const ready: MemoryOperationsClient | null = client && connection.kind === "connected" && visible ? client : null;
  const [state, setState] = useState<HindsightActivationState>(initialActivationState);
  const controller = useMemo(() => createMemoryOperationsController<MemoryActivationStatus>({
    loading: () => setState((current) => ({ ...current, loading: true })),
    loaded: (status) => setState((current) => ({ ...current, status, loading: false, error: null })),
    // A failed re-read keeps the last frame on screen with its actions locked; the error line carries the retry.
    loadFailed: (cause) => setState((current) => ({ ...current, loading: false, error: cause instanceof Error ? cause.message : String(cause) })),
    mutationStarted: (busyKey) => setState((current) => ({ ...current, busyKey, feedback: null })),
    mutationSettled: (feedback) => setState((current) => ({ ...current, busyKey: null, feedback })),
  }, readActivation), []);

  useEffect(() => {
    setState((current) => ({ ...current, busyKey: null, feedback: null }));
    controller.replace(ready);
    return () => controller.replace(null);
  }, [controller, ready]);
  useEffect(() => () => controller.dispose(), [controller]);

  return { ...state, connectionReady: ready !== null, refresh: () => controller.refresh(),
    execute: (action) => dispatchActivation(controller, state, action) };
}

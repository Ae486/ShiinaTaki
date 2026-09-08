/**
 * INPUT:  the authenticated Home WsClient generation and the framework-free permission controller.
 * OUTPUT: usePermissions() — in-memory Core snapshot, current-generation-only reads/mutations, explicit conflict refetch.
 * POS:    ui/windows/home/pages/settings — the only React permission seam; never persists or replays mutations.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { PermissionCellSetParams, PermissionLevel } from "@taki/shared";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageActive } from "../../page-visibility-store.ts";
import { createPermissionController } from "./permission-controller.ts";
import {
  applyPermissionLoad,
  beginPermissionLoad,
  beginPermissionMutation,
  failPermissionLoad,
  failPermissionMutation,
  previousData,
  permissionMutationFeedback,
  type PermissionFeedback,
  type PermissionViewState,
} from "./permission-state.ts";

export interface PermissionsView {
  state: PermissionViewState;
  connectionReady: boolean;
  pending: string | null;
  feedback: PermissionFeedback | null;
  refresh(): Promise<void>;
  setLevel(level: PermissionLevel): Promise<void>;
  setCell(input: Omit<PermissionCellSetParams, "expectedPolicyGeneration">): Promise<void>;
}

export function usePermissions(): PermissionsView {
  const { client, status } = useHomeClient();
  const ready = client && status.kind === "connected" ? client : null;
  const visible = usePageActive("settings");
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<PermissionFeedback | null>(null);
  const [state, setState] = useState<PermissionViewState>({ kind: "idle", token: 0, previous: null });
  const controller = useMemo(() => createPermissionController({
    loading: (previous) => setState((current) => beginPermissionLoad(current.token, previous)),
    loaded: ({ level, cells }, feedback) => setState((current) => applyPermissionLoad(current, {
      token: current.token,
      level,
      cells,
      feedback: feedback ?? null,
    })),
    loadFailed: (cause) => setState((current) => failPermissionLoad(current, current.token, cause)),
    mutationStarted: (key) => { setPending(key); setFeedback(null); setState((current) => beginPermissionMutation(current, current.token, key)); },
    mutationFailed: (cause) => { setFeedback(permissionMutationFeedback(cause)); setState((current) => failPermissionMutation(current, current.token, cause)); },
    idle: (previous) => setState((current) => ({ kind: "idle", token: current.token, previous })),
    feedback: setFeedback,
    mutationSettled: () => setPending(null),
  }), []);

  useLayoutEffect(() => controller.setVisible(visible), [controller, visible]);
  useLayoutEffect(() => {
    setState((current) => ({ kind: "idle", token: current.token + 1, previous: previousData(current) }));
    controller.replace(ready);
    return () => controller.replace(null);
  }, [controller, ready]);
  useEffect(() => () => controller.dispose(), [controller]);

  const generation = state.kind === "ready" ? state.data.policyGeneration : null;
  const refresh = useCallback((feedback?: PermissionFeedback) => controller.refresh(feedback), [controller]);
  const setLevel = useCallback(async (level: PermissionLevel) => {
    if (generation !== null) await controller.setLevel(level, generation);
  }, [controller, generation]);
  const setCell = useCallback(async (input: Omit<PermissionCellSetParams, "expectedPolicyGeneration">) => {
    if (generation !== null) await controller.setCell(input, generation);
  }, [controller, generation]);

  return { state, connectionReady: ready !== null, pending, feedback, refresh, setLevel, setCell };
}

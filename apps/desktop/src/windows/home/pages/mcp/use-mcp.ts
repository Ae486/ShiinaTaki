/**
 * INPUT:  the authenticated Home WsClient generation and the framework-free MCP controller.
 * OUTPUT: useMcpServers() — in-memory Core view, current-generation-only reads/mutations, explicit conflict
 *         refetch; no snapshot persistence (permission-snapshot discipline applies to MCP desired state too).
 * POS:    ui/windows/home/pages/mcp — the only React MCP seam; never persists or replays mutations.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { McpServerDraft } from "./mcp-state.ts";
import type { ReadObservationState } from "@/lib/read-observation.js";
import {
  applyMcpLoad,
  beginMcpLoad,
  beginMcpMutation,
  failMcpLoad,
  failMcpMutation,
  previousMcpData,
  mcpMutationFeedback,
  type McpFeedback,
  type McpViewState,
} from "./mcp-state.ts";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageActive } from "../../page-visibility-store.ts";
import { useMcpFeedback } from "./use-mcp-feedback.ts";
import {
  createMcpController,
  type McpEditorMutationResult,
  type McpPageClient,
} from "./mcp-controller.ts";

export interface McpServersView {
  state: McpViewState;
  connectionReady: boolean;
  pending: string | null;
  feedback: McpFeedback | null;
  observation: ReadObservationState;
  refresh(): Promise<void>;
  add(draft: McpServerDraft): Promise<McpEditorMutationResult>;
  edit(draft: McpServerDraft, expectedRevision: number): Promise<McpEditorMutationResult>;
  setEnabled(input: { serverId: string; enabled: boolean; expectedRevision: number }): Promise<void>;
  remove(input: { serverId: string; expectedRevision: number }): Promise<void>;
  reconnect(serverId: string): Promise<void>;
  test(serverId: string): Promise<void>;
}

export function useMcpServers(): McpServersView {
  const { client, status } = useHomeClient();
  const ready: McpPageClient | null = client && status.kind === "connected" ? client : null;
  const visible = usePageActive("mcp");
  const [pending, setPending] = useState<string | null>(null);
  const notices = useMcpFeedback();
  const [observation, setObservation] = useState<ReadObservationState>("idle");
  const [state, setState] = useState<McpViewState>({ kind: "idle", token: 0, previous: null });
  const controller = useMemo(() => createMcpController({
    loading: (previous) => setState((current) => beginMcpLoad(current.token, previous)),
    loaded: (servers, feedback) => setState((current) => applyMcpLoad(current, { token: current.token, servers, feedback: feedback ?? null })),
    loadFailed: (cause) => setState((current) => failMcpLoad(current, current.token, cause)),
    mutationStarted: (key) => { setPending(key); notices.started(key); setState((current) => beginMcpMutation(current, current.token, key)); },
    mutationFailed: (cause) => { notices.retain(mcpMutationFeedback(cause)); setState((current) => failMcpMutation(current, current.token, cause)); },
    idle: (previous) => setState((current) => ({ kind: "idle", token: current.token, previous })),
    feedback: notices.report,
    mutationSettled: () => setPending(null),
    observation: setObservation,
  }), []);

  useLayoutEffect(() => controller.setVisible(visible), [controller, visible]);
  useLayoutEffect(() => {
    notices.reset();
    setState((current) => ({ kind: "idle", token: current.token + 1, previous: previousMcpData(current) }));
    controller.replace(ready);
    return () => controller.replace(null);
  }, [controller, ready, notices.reset]);
  useEffect(() => () => controller.dispose(), [controller]);

  const refresh = useCallback(() => controller.refresh(), [controller]);
  const add = useCallback((draft: McpServerDraft) => controller.add(draft), [controller]);
  const edit = useCallback((draft: McpServerDraft, expectedRevision: number) =>
    controller.edit(draft, expectedRevision), [controller]);
  const setEnabled = useCallback(async (input: { serverId: string; enabled: boolean; expectedRevision: number }) =>
    void (await controller.setEnabled(input)), [controller]);
  const remove = useCallback(async (input: { serverId: string; expectedRevision: number }) => void (await controller.remove(input)), [controller]);
  const reconnect = useCallback(async (serverId: string) => void (await controller.reconnect(serverId)), [controller]);
  const test = useCallback(async (serverId: string) => void (await controller.test(serverId)), [controller]);

  return { state, connectionReady: ready !== null, observation, pending, feedback: notices.feedback, refresh, add, edit, setEnabled, remove, reconnect, test };
}

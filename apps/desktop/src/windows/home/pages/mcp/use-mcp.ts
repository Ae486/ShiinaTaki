/**
 * INPUT:  the authenticated Home WsClient generation and the framework-free MCP controller.
 * OUTPUT: useMcpServers() — in-memory Core view, current-generation-only reads/mutations, explicit conflict
 *         refetch; no snapshot persistence (permission-snapshot discipline applies to MCP desired state too).
 * POS:    ui/windows/home/pages/mcp — the only React MCP seam; never persists or replays mutations.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { McpServerDraft } from "./mcp-state.ts";
import {
  applyMcpLoad,
  beginMcpLoad,
  beginMcpMutation,
  failMcpLoad,
  failMcpMutation,
  previousMcpData,
  type McpFeedback,
  type McpViewState,
} from "./mcp-state.ts";
import { useHomeClient } from "../../home-client-context.ts";
import { createMcpController, type McpPageClient } from "./mcp-controller.ts";

export interface McpServersView {
  state: McpViewState;
  connectionReady: boolean;
  refresh(): Promise<void>;
  add(draft: McpServerDraft): Promise<void>;
  edit(draft: McpServerDraft, expectedRevision: number): Promise<void>;
  setEnabled(input: { serverId: string; enabled: boolean; expectedRevision: number }): Promise<void>;
  remove(input: { serverId: string; expectedRevision: number }): Promise<void>;
  reconnect(serverId: string): Promise<void>;
  test(serverId: string): Promise<void>;
}

export function useMcpServers(): McpServersView {
  const { client, status } = useHomeClient();
  const ready: McpPageClient | null = client && status.kind === "connected" ? client : null;
  const [state, setState] = useState<McpViewState>(() => beginMcpLoad(0, null));
  const controller = useMemo(() => createMcpController({
    loading: (previous) => setState((current) => beginMcpLoad(current.token, previous)),
    loaded: (servers, feedback) => setState((current) => applyMcpLoad(current, { token: current.token, servers, feedback: feedback ?? null })),
    loadFailed: (cause) => setState((current) => failMcpLoad(current, current.token, cause)),
    mutationStarted: (key) => setState((current) => beginMcpMutation(current, current.token, key)),
    mutationFailed: (cause) => setState((current) => failMcpMutation(current, current.token, cause)),
  }), []);

  useEffect(() => {
    setState((current) => beginMcpLoad(current.token + 1, previousMcpData(current)));
    controller.replace(ready);
    return () => controller.replace(null);
  }, [controller, ready]);
  useEffect(() => () => controller.dispose(), [controller]);

  const refresh = useCallback((feedback?: McpFeedback) => controller.refresh(feedback), [controller]);
  const add = useCallback(async (draft: McpServerDraft) => void (await controller.add(draft)), [controller]);
  const edit = useCallback(async (draft: McpServerDraft, expectedRevision: number) => void (await controller.edit(draft, expectedRevision)), [controller]);
  const setEnabled = useCallback(async (input: { serverId: string; enabled: boolean; expectedRevision: number }) =>
    void (await controller.setEnabled(input)), [controller]);
  const remove = useCallback(async (input: { serverId: string; expectedRevision: number }) => void (await controller.remove(input)), [controller]);
  const reconnect = useCallback(async (serverId: string) => void (await controller.reconnect(serverId)), [controller]);
  const test = useCallback(async (serverId: string) => void (await controller.test(serverId)), [controller]);

  return { state, connectionReady: ready !== null, refresh, add, edit, setEnabled, remove, reconnect, test };
}

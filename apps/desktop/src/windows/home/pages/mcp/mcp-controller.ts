/**
 * INPUT:  replaceable WsClient generations plus callbacks receiving validated Core MCP views and outcomes.
 * OUTPUT: createMcpController() — current-client-only reads/mutations, conflict refetch, serialized mutations,
 *         secret values stored via secret.set BEFORE the desired write, and zero auto replay after timeout.
 * POS:    ui/windows/home/pages/mcp — framework-free async authority guard used by the React MCP hook.
 */
import type { WsClient } from "@/lib/ws-client.js";
import type { McpServerView } from "@taki/shared";
import {
  draftSelectedTools,
  draftToConfig,
  mcpAppError,
  secretValuesToStore,
  type McpFeedback,
  type McpServerDraft,
} from "./mcp-state.ts";

export interface McpControllerSink {
  loading(previous: McpServerView[] | null): void;
  loaded(servers: McpServerView[], feedback?: McpFeedback): void;
  loadFailed(cause: unknown, previous: McpServerView[] | null): void;
  mutationStarted(key: string): void;
  mutationFailed(cause: unknown): void;
}

export interface McpController {
  replace(client: McpPageClient | null): void;
  refresh(feedback?: McpFeedback): Promise<void>;
  add(draft: McpServerDraft): Promise<void>;
  edit(draft: McpServerDraft, expectedRevision: number): Promise<void>;
  setEnabled(input: { serverId: string; enabled: boolean; expectedRevision: number }): Promise<void>;
  remove(input: { serverId: string; expectedRevision: number }): Promise<void>;
  reconnect(serverId: string): Promise<void>;
  test(serverId: string): Promise<void>;
  dispose(): void;
}

export type McpPageClient = Pick<
  WsClient,
  "mcpList" | "mcpAdd" | "mcpEdit" | "mcpEnable" | "mcpDisable" | "mcpRemove" | "mcpTest" | "mcpReconnect" | "secretSet"
>;

interface ControllerState {
  client: McpPageClient | null;
  epoch: number;
  lastGood: McpServerView[] | null;
  mutating: boolean;
}

function isCurrent(state: ControllerState, candidate: McpPageClient, token: number): boolean {
  return state.client === candidate && state.epoch === token;
}

async function refreshController(state: ControllerState, sink: McpControllerSink, feedback?: McpFeedback): Promise<void> {
  const candidate = state.client;
  if (!candidate) return;
  const token = state.epoch;
  sink.loading(state.lastGood);
  try {
    const { servers } = await candidate.mcpList();
    if (!isCurrent(state, candidate, token)) return;
    state.lastGood = servers;
    sink.loaded(servers, feedback);
  } catch (cause) {
    if (isCurrent(state, candidate, token)) sink.loadFailed(cause, state.lastGood);
  }
}

interface MutationSpec {
  key: string;
  operation: (candidate: McpPageClient) => Promise<void>;
  feedback: McpFeedback;
}

async function mutateController(state: ControllerState, sink: McpControllerSink, spec: MutationSpec): Promise<void> {
  const candidate = state.client;
  if (!candidate || state.mutating) return;
  const token = state.epoch;
  state.mutating = true;
  sink.mutationStarted(spec.key);
  try {
    await spec.operation(candidate);
    if (!isCurrent(state, candidate, token)) return;
    await refreshController(state, sink, spec.feedback);
  } catch (cause) {
    if (!isCurrent(state, candidate, token)) return;
    sink.mutationFailed(cause);
    if (mcpAppError(cause).code === "MCP_CONFIG_CONFLICT") {
      // A conflict means the desired row moved: refetch Core truth; the operator retries explicitly.
      await refreshController(state, sink, { kind: "conflict", message: "配置已在别处修改；已从 Core 重新读取" });
    }
  } finally {
    if (state.epoch === token) state.mutating = false;
  }
}

/** Secret values ride ONLY secret.set (the write-only sensitive path), and only before the desired write. */
async function storeSecretValues(candidate: McpPageClient, draft: McpServerDraft): Promise<void> {
  for (const { secretRef, value } of secretValuesToStore(draft)) {
    await candidate.secretSet({ secretRef, value });
  }
}

export function createMcpController(sink: McpControllerSink): McpController {
  const state: ControllerState = { client: null, epoch: 0, lastGood: null, mutating: false };
  return {
    replace(next) {
      state.epoch += 1;
      state.client = next;
      state.mutating = false;
      if (next) void refreshController(state, sink);
      else sink.loading(state.lastGood);
    },
    refresh: (feedback) => refreshController(state, sink, feedback),
    add: (draft) => mutateController(state, sink, addSpec(draft)),
    edit: (draft, expectedRevision) => mutateController(state, sink, editSpec(draft, expectedRevision)),
    setEnabled: (input) => mutateController(state, sink, setEnabledSpec(input)),
    remove: (input) => mutateController(state, sink, removeSpec(input)),
    reconnect: (serverId) => mutateController(state, sink, reconnectSpec(serverId)),
    test: (serverId) => mutateController(state, sink, testSpec(serverId)),
    dispose() {
      state.epoch += 1;
      state.client = null;
      state.mutating = false;
    },
  };
}

function addSpec(draft: McpServerDraft): MutationSpec {
  return {
    key: `add:${draft.serverId}`,
    operation: async (candidate) => {
      await storeSecretValues(candidate, draft);
      await candidate.mcpAdd({ serverId: draft.serverId, config: draftToConfig(draft), selectedTools: draftSelectedTools(draft) });
    },
    feedback: { kind: "saved", message: `已添加 ${draft.serverId}` },
  };
}

function editSpec(draft: McpServerDraft, expectedRevision: number): MutationSpec {
  return {
    key: `edit:${draft.serverId}`,
    operation: async (candidate) => {
      await storeSecretValues(candidate, draft);
      await candidate.mcpEdit({
        serverId: draft.serverId,
        config: draftToConfig(draft),
        selectedTools: draftSelectedTools(draft),
        expectedConfigRevision: expectedRevision,
      });
    },
    feedback: { kind: "saved", message: `已保存 ${draft.serverId}` },
  };
}

function setEnabledSpec(input: { serverId: string; enabled: boolean; expectedRevision: number }): MutationSpec {
  const params = { serverId: input.serverId, expectedConfigRevision: input.expectedRevision };
  return {
    key: `${input.enabled ? "enable" : "disable"}:${input.serverId}`,
    operation: async (candidate) => void (await (input.enabled ? candidate.mcpEnable(params) : candidate.mcpDisable(params))),
    feedback: { kind: "saved", message: input.enabled ? `已启用 ${input.serverId}` : `已停用 ${input.serverId}（在途调用排空后关闭）` },
  };
}

function removeSpec(input: { serverId: string; expectedRevision: number }): MutationSpec {
  return {
    key: `remove:${input.serverId}`,
    operation: async (candidate) => void (await candidate.mcpRemove({ serverId: input.serverId, expectedConfigRevision: input.expectedRevision })),
    feedback: { kind: "saved", message: `已移除 ${input.serverId}` },
  };
}

function reconnectSpec(serverId: string): MutationSpec {
  return {
    key: `reconnect:${serverId}`,
    operation: async (candidate) => void (await candidate.mcpReconnect(serverId)),
    feedback: { kind: "saved", message: `已重连 ${serverId}` },
  };
}

function testSpec(serverId: string): MutationSpec {
  return {
    key: `test:${serverId}`,
    operation: async (candidate) => void (await candidate.mcpTest({ serverId })),
    feedback: { kind: "tested", message: `${serverId} 测试完成（诊断仅供参考，不会发布工具）` },
  };
}

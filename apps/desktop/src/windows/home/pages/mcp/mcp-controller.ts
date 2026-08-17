/**
 * INPUT: replaceable WsClient generations and callbacks for validated MCP views/outcomes
 * OUTPUT: current-client-only reads/mutations, conflict refetch, serialization, and partial-commit truth
 * POS: Home MCP framework-free authority guard; timed-out mutations are never replayed automatically
 */
import type { WsClient } from "@/lib/ws-client.js";
import type { McpServerView, McpTestResult } from "@taki/shared";
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
  add(draft: McpServerDraft): Promise<McpEditorMutationResult>;
  edit(draft: McpServerDraft, expectedRevision: number): Promise<McpEditorMutationResult>;
  setEnabled(input: { serverId: string; enabled: boolean; expectedRevision: number }): Promise<void>;
  remove(input: { serverId: string; expectedRevision: number }): Promise<void>;
  reconnect(serverId: string): Promise<void>;
  test(serverId: string): Promise<void>;
  dispose(): void;
}

export type McpEditorMutationResult =
  | { ok: true }
  | { ok: false; committedRevision?: number };

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
  operation: (candidate: McpPageClient) => Promise<{ feedback?: McpFeedback } | void>;
  feedback: McpFeedback;
}

class PostCommitMutationError extends Error {
  readonly configRevision: number;
  readonly failureCause: unknown;
  constructor(configRevision: number, cause: unknown) {
    super("desired MCP state was committed before a dependent operation failed");
    this.name = "PostCommitMutationError";
    this.configRevision = configRevision;
    this.failureCause = cause;
  }
}

async function mutateController(
  state: ControllerState,
  sink: McpControllerSink,
  spec: MutationSpec,
): Promise<McpEditorMutationResult> {
  const candidate = state.client;
  if (!candidate || state.mutating) return { ok: false };
  const token = state.epoch;
  state.mutating = true;
  sink.mutationStarted(spec.key);
  try {
    const operation = await spec.operation(candidate);
    if (!isCurrent(state, candidate, token)) return { ok: false };
    await refreshController(state, sink, operation?.feedback ?? spec.feedback);
    return { ok: true };
  } catch (cause) {
    if (!isCurrent(state, candidate, token)) return { ok: false };
    const failure = cause instanceof PostCommitMutationError ? cause.failureCause : cause;
    sink.mutationFailed(failure);
    if (cause instanceof PostCommitMutationError) {
      await refreshController(state, sink, {
        kind: "error",
        message: "期望配置已保存，但密钥更新或重连失败；草稿已保留，可修正后重试",
      });
      return { ok: false, committedRevision: cause.configRevision };
    }
    if (mcpAppError(cause).code === "MCP_CONFIG_CONFLICT") {
      // A conflict means the desired row moved: refetch Core truth; the operator retries explicitly.
      await refreshController(state, sink, { kind: "conflict", message: "配置已在别处修改；已从 Core 重新读取" });
    }
    return { ok: false };
  } finally {
    if (state.epoch === token) state.mutating = false;
  }
}

/** Secret values ride ONLY secret.set (the write-only sensitive path). */
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
    setEnabled: async (input) => void (await mutateController(state, sink, setEnabledSpec(input))),
    remove: async (input) => void (await mutateController(state, sink, removeSpec(input))),
    reconnect: async (serverId) => void (await mutateController(state, sink, reconnectSpec(serverId))),
    test: async (serverId) => void (await mutateController(state, sink, testSpec(serverId))),
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
      const { server } = await candidate.mcpEdit({
        serverId: draft.serverId,
        config: draftToConfig(draft),
        selectedTools: draftSelectedTools(draft),
        expectedConfigRevision: expectedRevision,
      });
      try {
        const secrets = secretValuesToStore(draft);
        await storeSecretValues(candidate, draft);
        if (secrets.length > 0) await candidate.mcpReconnect(draft.serverId);
      } catch (cause) {
        throw new PostCommitMutationError(server.configRevision, cause);
      }
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
    operation: async (candidate) => ({ feedback: testFeedback(serverId, await candidate.mcpTest({ serverId })) }),
    feedback: { kind: "tested", message: `${serverId} 测试完成（诊断仅供参考，不会发布工具）` },
  };
}

function testFeedback(serverId: string, result: McpTestResult): McpFeedback {
  if (result.status === "failed") {
    return {
      kind: "test-failed",
      message: `${serverId} 测试失败：${result.message ?? result.reason ?? "未知原因"}（未发布工具）`,
    };
  }
  return {
    kind: "tested",
    message: `${serverId} 测试通过：${result.toolNames.length} 个工具，${result.pages} 页，${result.durationMs}ms，跳过 ${result.skipped.length} 个`,
  };
}

/**
 * INPUT: replaceable WsClient generations and callbacks for validated MCP views/outcomes
 * OUTPUT: current-client-only reads/mutations, conflict refetch, useful test feedback, and partial-commit truth
 * POS: Home MCP framework-free authority guard; timed-out mutations are never replayed automatically
 */
import type { WsClient } from "@/lib/ws-client.js";
import type { McpListResult, McpServerView, McpTestResult } from "@taki/shared";
import { createReadCoordinator, type ReadCoordinator } from "@/lib/read-coordinator.js";
import { createReadObservation, type ReadObservation, type ReadObservationState } from "@/lib/read-observation.js";
import {
  draftSelectedTools,
  draftToConfig,
  mcpAppError,
  mcpMutationFeedback,
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
  idle?(previous: McpServerView[] | null): void;
  feedback?(feedback: McpFeedback): void;
  mutationSettled?(): void;
  observation?(state: ReadObservationState): void;
}

export interface McpController {
  replace(client: McpPageClient | null): void;
  refresh(feedback?: McpFeedback): Promise<void>;
  invalidate(): Promise<void>;
  setVisible(visible: boolean): void;
  add(draft: McpServerDraft): Promise<McpEditorMutationResult>;
  edit(draft: McpServerDraft, expectedRevision: number): Promise<McpEditorMutationResult>;
  setEnabled(input: { serverId: string; enabled: boolean; expectedRevision: number }): Promise<void>;
  remove(input: { serverId: string; expectedRevision: number }): Promise<void>;
  reconnect(serverId: string): Promise<void>;
  test(serverId: string): Promise<void>;
  dispose(): void;
}

export type McpEditorMutationResult =
  | { ok: true; committedRevision?: number }
  | { ok: false; committedRevision?: number };

export type McpPageClient = Pick<
  WsClient,
  "mcpList" | "mcpAdd" | "mcpEdit" | "mcpEnable" | "mcpDisable" | "mcpRemove" | "mcpTest" | "mcpReconnect" | "secretSet"
  | "subscribeExtensions" | "onExtensionChanged"
>;

interface ControllerState {
  client: McpPageClient | null;
  epoch: number;
  readEpoch: number;
  lastGood: McpServerView[] | null;
  mutating: boolean;
  visible: boolean;
  reads: ReadCoordinator<McpListResult>;
  feedback: McpFeedback | undefined;
  feedbackEpoch: number;
  restoreAfterMutation: boolean;
  needsRead: boolean;
  observation: ReadObservation;
}

function isCurrent(state: ControllerState, candidate: McpPageClient, token: number): boolean {
  return state.client === candidate && state.epoch === token;
}

async function refreshController(state: ControllerState, sink: McpControllerSink, feedback?: McpFeedback): Promise<void> {
  if (feedback) {
    state.feedback = feedback.kind === "saved" ? undefined : feedback;
    sink.feedback?.(feedback);
    state.reads.acceptUpdate();
  }
  if (!state.client || !state.visible || (state.mutating && feedback === undefined)) return;
  const token = state.readEpoch;
  if (!state.observation.usable() && !await state.observation.prepare()) return;
  if (token !== state.readEpoch || !state.visible || (state.mutating && feedback === undefined)) return;
  state.reads.setActive(true);
  if (feedback && state.visible) state.restoreAfterMutation = false;
  return state.reads.demand();
}

function invalidateController(state: ControllerState): Promise<void> {
  state.needsRead = true;
  return state.reads.invalidate();
}

interface MutationSpec {
  key: string;
  operation: (candidate: McpPageClient) => Promise<{ feedback?: McpFeedback; committedRevision?: number } | void>;
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
  const feedbackEpoch = ++state.feedbackEpoch;
  let feedback: McpFeedback | undefined;
  const completionSink = { ...sink, feedback: (next: McpFeedback) => { feedback = next; } };
  state.mutating = true;
  state.readEpoch += 1;
  state.needsRead = true;
  state.reads.setActive(false);
  state.feedback = undefined;
  sink.mutationStarted(spec.key);
  let result: McpEditorMutationResult;
  try {
    result = await completeMutation(state, completionSink, { candidate, token, spec });
  } finally {
    if (isCurrent(state, candidate, token)) {
      state.mutating = false;
      state.reads.setActive(state.visible && state.observation.usable());
      sink.mutationSettled?.();
      if (state.visible && state.restoreAfterMutation) {
        state.restoreAfterMutation = false;
        await refreshController(state, sink);
      }
    }
  }
  // All awaited reconciliation, including hide/show recovery above, belongs to the captured client.
  // A retired success or partial-commit revision cannot acknowledge another generation's editor.
  if (!isCurrent(state, candidate, token)) return { ok: false };
  // A notification acknowledges the same guarded completion as the editor. Read-back or visibility
  // reconciliation may retire the client, and a newer action can supersede this one while it settles.
  if (feedback && feedbackEpoch === state.feedbackEpoch) sink.feedback?.(feedback);
  return result;
}

async function completeMutation(
  state: ControllerState,
  sink: McpControllerSink,
  input: { candidate: McpPageClient; token: number; spec: MutationSpec },
): Promise<McpEditorMutationResult> {
  const { candidate, token, spec } = input;
  try {
    const operation = await spec.operation(candidate);
    if (!isCurrent(state, candidate, token)) return { ok: false };
    await refreshController(state, sink, operation?.feedback ?? spec.feedback);
    return { ok: true, ...(operation?.committedRevision === undefined ? {} : { committedRevision: operation.committedRevision }) };
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
      await refreshController(state, sink, { kind: "conflict", message: "配置已在别处修改；请核对当前状态后重试。" });
    } else await refreshController(state, sink, mcpMutationFeedback(failure));
    return { ok: false };
  }
}

/** Secret values ride ONLY secret.set (the write-only sensitive path). */
async function storeSecretValues(candidate: McpPageClient, draft: McpServerDraft): Promise<void> {
  for (const { secretRef, value } of secretValuesToStore(draft)) {
    await candidate.secretSet({ secretRef, value });
  }
}

export function createMcpController(sink: McpControllerSink): McpController {
  const state = createControllerState(sink);
  return {
    replace(next) {
      if (state.client === next) return;
      state.epoch += 1;
      state.readEpoch += 1;
      state.client = next;
      state.mutating = false;
      state.feedback = undefined;
      state.restoreAfterMutation = false;
      state.needsRead = true;
      state.reads.setActive(false);
      state.reads.replace(next ? () => next.mcpList() : null);
      state.observation.replace(next ? {
        subscribe: () => next.subscribeExtensions(),
        onChanged: (changed) => next.onExtensionChanged((event) => { if (event.targets.includes("mcp")) changed(event.revision); }),
      } : null);
      sink.mutationSettled?.();
      if (next) void refreshController(state, sink);
      else sink.idle?.(state.lastGood);
    },
    refresh: (feedback) => refreshController(state, sink, feedback),
    invalidate: () => invalidateController(state),
    setVisible(visible) {
      if (state.visible === visible) return;
      state.visible = visible;
      state.readEpoch += 1;
      state.reads.setActive(visible && !state.mutating && state.observation.usable());
      if (!visible) return;
      sink.observation?.(state.observation.state());
      if (state.mutating) state.restoreAfterMutation = true;
      else if (state.needsRead || state.observation.state() !== "live") void refreshController(state, sink);
    },
    add: (draft) => mutateController(state, sink, addSpec(draft)),
    edit: (draft, expectedRevision) => mutateController(state, sink, editSpec(draft, expectedRevision)),
    setEnabled: async (input) => void (await mutateController(state, sink, setEnabledSpec(input))),
    remove: async (input) => void (await mutateController(state, sink, removeSpec(input))),
    reconnect: async (serverId) => void (await mutateController(state, sink, reconnectSpec(serverId))),
    test: async (serverId) => void (await mutateController(state, sink, testSpec(serverId))),
    dispose() {
      state.epoch += 1;
      state.readEpoch += 1;
      state.client = null;
      state.mutating = false;
      state.reads.replace(null);
      state.observation.replace(null);
    },
  };
}

function createControllerState(sink: McpControllerSink): ControllerState {
  const state: ControllerState = {
    client: null, epoch: 0, readEpoch: 0, lastGood: null, mutating: false, visible: true, feedback: undefined, feedbackEpoch: 0, restoreAfterMutation: false, needsRead: true,
    reads: createReadCoordinator<McpListResult>({
      started: () => { state.needsRead = true; sink.loading(state.lastGood); },
      loaded: ({ servers }) => { state.needsRead = false; state.lastGood = servers; sink.loaded(servers, state.feedback); },
      failed: (cause) => sink.loadFailed(cause, state.lastGood),
      retired: () => { if (state.visible && state.needsRead) sink.idle?.(state.lastGood); },
    }),
    observation: createReadObservation({
      changed: (observation) => {
        if (!state.visible) return;
        sink.observation?.(observation);
        if (observation === "subscribing") sink.loading(state.lastGood);
      },
      failed: (cause) => { if (state.visible) sink.loadFailed(cause, state.lastGood); },
      invalidated: () => { void invalidateController(state); },
    }),
  };
  return state;
}

function addSpec(draft: McpServerDraft): MutationSpec {
  return {
    key: `add:${draft.serverId}`,
    operation: async (candidate) => {
      await storeSecretValues(candidate, draft);
      const { server } = await candidate.mcpAdd({ serverId: draft.serverId, config: draftToConfig(draft), selectedTools: draftSelectedTools(draft) });
      return { committedRevision: server.configRevision };
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
      return { committedRevision: server.configRevision };
    },
    feedback: { kind: "saved", message: `${draft.serverId} 的本次提交已保存` },
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
    message: `${serverId} 测试通过：${result.toolNames.length} 个工具，耗时 ${result.durationMs} 毫秒，跳过 ${result.skipped.length} 个`,
  };
}

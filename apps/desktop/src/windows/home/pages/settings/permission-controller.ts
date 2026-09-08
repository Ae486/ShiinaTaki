/**
 * INPUT:  replaceable WsClient generations plus callbacks receiving validated Core permission state and outcomes.
 * OUTPUT: createPermissionController() — current-client-only reads/mutations, conflict refetch, and zero auto replay.
 * POS:    ui/windows/home/pages/settings — framework-free async authority guard used by the React permission hook.
 */
import type {
  PermissionCellSetParams,
  PermissionCellsState,
  PermissionLevel,
  PermissionLevelState,
} from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createReadCoordinator, type ReadCoordinator } from "@/lib/read-coordinator.js";
import { PermissionSnapshotValidationError, permissionAppError, type PermissionFeedback } from "./permission-state.ts";

export interface PermissionSnapshot {
  level: PermissionLevelState;
  cells: PermissionCellsState;
}

export interface PermissionControllerSink {
  loading(previous: PermissionCellsState | null): void;
  loaded(snapshot: PermissionSnapshot, feedback?: PermissionFeedback): void;
  loadFailed(cause: unknown, previous: PermissionCellsState | null): void;
  mutationStarted(key: string): void;
  mutationFailed(cause: unknown): void;
  idle?(previous: PermissionCellsState | null): void;
  feedback?(feedback: PermissionFeedback): void;
  mutationSettled?(): void;
}

export interface PermissionController {
  replace(client: PermissionClient | null): void;
  refresh(feedback?: PermissionFeedback): Promise<void>;
  setVisible(visible: boolean): void;
  setLevel(level: PermissionLevel, expectedPolicyGeneration: number): Promise<void>;
  setCell(input: Omit<PermissionCellSetParams, "expectedPolicyGeneration">, expectedPolicyGeneration: number): Promise<void>;
  dispose(): void;
}

interface ControllerState {
  client: PermissionClient | null;
  epoch: number;
  lastGood: PermissionCellsState | null;
  mutating: boolean;
  visible: boolean;
  fresh: boolean;
  feedback: PermissionFeedback | undefined;
  reads: ReadCoordinator<PermissionSnapshot>;
  restoreAfterMutation: boolean;
}

function isCurrent(state: ControllerState, candidate: PermissionClient, token: number): boolean {
  return state.client === candidate && state.epoch === token;
}

function refreshController(
  state: ControllerState,
  sink: PermissionControllerSink,
  feedback?: PermissionFeedback,
): Promise<void> {
  if (feedback) {
    state.feedback = feedback.kind === "saved" ? undefined : feedback;
    sink.feedback?.(feedback);
    state.reads.acceptUpdate();
  }
  state.reads.setActive(state.visible && (!state.mutating || feedback !== undefined));
  if (feedback && state.visible) state.restoreAfterMutation = false;
  return state.reads.demand();
}

async function mutateController(
  state: ControllerState,
  sink: PermissionControllerSink,
  input: { key: string; operation: (candidate: PermissionClient) => Promise<void>; feedback: PermissionFeedback },
): Promise<void> {
  const candidate = state.client;
  if (!candidate || state.mutating || !state.fresh) return;
  const token = state.epoch;
  state.mutating = true;
  state.reads.setActive(false);
  state.feedback = undefined;
  sink.mutationStarted(input.key);
  try {
    await input.operation(candidate);
    if (isCurrent(state, candidate, token)) await refreshController(state, sink, input.feedback);
  } catch (cause) {
    if (!isCurrent(state, candidate, token)) return;
    sink.mutationFailed(cause);
    if (permissionAppError(cause).code === "POLICY_CONFLICT") {
      await refreshController(state, sink, { kind: "conflict", message: "权限策略已在别处修改；请核对当前状态后重试。" });
    }
  } finally {
    if (state.epoch === token) {
      state.mutating = false;
      state.reads.setActive(state.visible);
      sink.mutationSettled?.();
      if (state.visible && state.restoreAfterMutation) {
        state.restoreAfterMutation = false;
        await state.reads.demand();
      }
    }
  }
}

export function createPermissionController(sink: PermissionControllerSink): PermissionController {
  const state = createControllerState(sink);

  return {
    replace(next) {
      if (state.client === next) return;
      state.epoch += 1;
      state.client = next;
      state.mutating = false;
      state.fresh = false;
      state.feedback = undefined;
      state.restoreAfterMutation = false;
      state.reads.replace(next ? () => readSnapshot(next) : null);
      state.reads.setActive(state.visible);
      sink.mutationSettled?.();
      if (next) void refreshController(state, sink);
      else sink.idle?.(state.lastGood);
    },
    refresh: (feedback) => refreshController(state, sink, feedback),
    setVisible(visible) {
      if (state.visible === visible) return;
      state.visible = visible;
      state.fresh = false;
      state.reads.setActive(visible && !state.mutating);
      if (visible && !state.mutating) void state.reads.demand();
      else if (visible) state.restoreAfterMutation = true;
    },
    setLevel: (level, expectedPolicyGeneration) => mutateController(state, sink, {
      key: "level",
      operation: async (candidate) => void (await candidate.permissionLevelSet({ level, expectedPolicyGeneration })),
      feedback: { kind: "saved", message: "权限级别已保存" },
    }),
    setCell: (input, expectedPolicyGeneration) => mutateController(state, sink, {
      key: input.key,
      operation: async (candidate) => void (await candidate.permissionCellSet({ ...input, expectedPolicyGeneration })),
      feedback: { kind: "saved", message: input.posture === null ? "自定义权限已重置" : "自定义权限已保存" },
    }),
    dispose() {
      state.epoch += 1;
      state.client = null;
      state.mutating = false;
      state.fresh = false;
      state.reads.replace(null);
    },
  };
}

function createControllerState(sink: PermissionControllerSink): ControllerState {
  const state: ControllerState = {
    client: null, epoch: 0, lastGood: null, mutating: false, visible: true, fresh: false, feedback: undefined, restoreAfterMutation: false,
    reads: createReadCoordinator<PermissionSnapshot>({
      started: () => sink.loading(state.lastGood),
      loaded: (snapshot) => { state.lastGood = snapshot.cells; state.fresh = true; sink.loaded(snapshot, state.feedback); },
      failed: (cause) => { state.fresh = false; sink.loadFailed(cause, state.lastGood); },
      retired: () => sink.idle?.(state.lastGood),
    }),
  };
  return state;
}

async function readSnapshot(client: PermissionClient): Promise<PermissionSnapshot> {
  const [level, cells] = await Promise.all([client.permissionLevelGet(), client.permissionCellsGet()]);
  assertConsistent(level, cells);
  return { level, cells };
}

export type PermissionClient = Pick<
  WsClient,
  "permissionLevelGet" | "permissionLevelSet" | "permissionCellsGet" | "permissionCellSet"
>;

function assertConsistent(level: PermissionLevelState, cells: PermissionCellsState): void {
  if (
    level.level !== cells.level ||
    level.policyGeneration !== cells.policyGeneration ||
    level.registryRevision !== cells.registryRevision
  ) throw new PermissionSnapshotValidationError();
}

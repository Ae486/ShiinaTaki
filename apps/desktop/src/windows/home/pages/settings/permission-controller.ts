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
}

export interface PermissionController {
  replace(client: PermissionClient | null): void;
  refresh(feedback?: PermissionFeedback): Promise<void>;
  setLevel(level: PermissionLevel, expectedPolicyGeneration: number): Promise<void>;
  setCell(input: Omit<PermissionCellSetParams, "expectedPolicyGeneration">, expectedPolicyGeneration: number): Promise<void>;
  dispose(): void;
}

interface ControllerState {
  client: PermissionClient | null;
  epoch: number;
  lastGood: PermissionCellsState | null;
  mutating: boolean;
}

function isCurrent(state: ControllerState, candidate: PermissionClient, token: number): boolean {
  return state.client === candidate && state.epoch === token;
}

async function refreshController(
  state: ControllerState,
  sink: PermissionControllerSink,
  feedback?: PermissionFeedback,
): Promise<void> {
  const candidate = state.client;
  if (!candidate) return;
  const token = state.epoch;
  sink.loading(state.lastGood);
  try {
    const [level, cells] = await Promise.all([candidate.permissionLevelGet(), candidate.permissionCellsGet()]);
    if (!isCurrent(state, candidate, token)) return;
    assertConsistent(level, cells);
    state.lastGood = cells;
    sink.loaded({ level, cells }, feedback);
  } catch (cause) {
    if (isCurrent(state, candidate, token)) sink.loadFailed(cause, state.lastGood);
  }
}

async function mutateController(
  state: ControllerState,
  sink: PermissionControllerSink,
  input: { key: string; operation: (candidate: PermissionClient) => Promise<void>; feedback: PermissionFeedback },
): Promise<void> {
  const candidate = state.client;
  if (!candidate || state.mutating) return;
  const token = state.epoch;
  state.mutating = true;
  sink.mutationStarted(input.key);
  try {
    await input.operation(candidate);
    if (isCurrent(state, candidate, token)) await refreshController(state, sink, input.feedback);
  } catch (cause) {
    if (!isCurrent(state, candidate, token)) return;
    sink.mutationFailed(cause);
    if (permissionAppError(cause).code === "POLICY_CONFLICT") {
      await refreshController(state, sink, { kind: "conflict", message: "Policy changed elsewhere; refreshed from Core" });
    }
  } finally {
    if (state.epoch === token) state.mutating = false;
  }
}

export function createPermissionController(sink: PermissionControllerSink): PermissionController {
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
    setLevel: (level, expectedPolicyGeneration) => mutateController(state, sink, {
      key: "level",
      operation: async (candidate) => void (await candidate.permissionLevelSet({ level, expectedPolicyGeneration })),
      feedback: { kind: "saved", message: "Permission Level saved" },
    }),
    setCell: (input, expectedPolicyGeneration) => mutateController(state, sink, {
      key: input.key,
      operation: async (candidate) => void (await candidate.permissionCellSet({ ...input, expectedPolicyGeneration })),
      feedback: { kind: "saved", message: input.posture === null ? "Override reset" : "Cell override saved" },
    }),
    dispose() {
      state.epoch += 1;
      state.client = null;
      state.mutating = false;
    },
  };
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

/**
 * INPUT:  Core permission snapshots, mutations, and structured JSON-RPC application errors.
 * OUTPUT: pure generation-safe permission view transitions plus conflict/refusal classification.
 * POS:    ui/windows/home/pages/settings — node-testable state core; no transport, React, cache, or policy inference.
 */
import { ErrorCodeSchema, type PermissionCellSetResult, type PermissionCellsState, type PermissionLevelState } from "@taki/shared";

export class PermissionSnapshotValidationError extends Error {
  constructor() {
    super("Core returned inconsistent permission snapshots");
    this.name = "PermissionSnapshotValidationError";
  }
}

export type PermissionFeedback =
  | { kind: "saved"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "refused"; reason: string | null; message: string }
  | { kind: "error"; message: string };

export type PermissionViewState =
  | { kind: "idle"; token: number; previous: PermissionCellsState | null }
  | { kind: "loading"; token: number; previous: PermissionCellsState | null }
  | { kind: "ready"; token: number; data: PermissionCellsState; feedback: PermissionFeedback | null; pending: string | null }
  | { kind: "failure"; token: number; previous: PermissionCellsState | null; failureKind: "read" | "validation"; message: string };

export function beginPermissionLoad(token: number, previous: PermissionCellsState | null): PermissionViewState {
  return { kind: "loading", token, previous };
}

export function applyPermissionLoad(
  state: PermissionViewState,
  input: { token: number; level: PermissionLevelState; cells: PermissionCellsState; feedback?: PermissionFeedback | null },
): PermissionViewState {
  const { token, level, cells, feedback = null } = input;
  if (state.token !== token) return state;
  if (
    level.level !== cells.level ||
    level.policyGeneration !== cells.policyGeneration ||
    level.registryRevision !== cells.registryRevision
  ) {
    return { kind: "failure", token, previous: previousData(state), failureKind: "validation", message: "Core returned inconsistent permission snapshots" };
  }
  return { kind: "ready", token, data: cells, feedback, pending: null };
}

export function failPermissionLoad(state: PermissionViewState, token: number, cause: unknown): PermissionViewState {
  if (state.token !== token) return state;
  return {
    kind: "failure",
    token,
    previous: previousData(state),
    failureKind:
      cause instanceof PermissionSnapshotValidationError || (cause instanceof Error && cause.name === "ZodError")
        ? "validation"
        : "read",
    message: errorMessage(cause),
  };
}

export function beginPermissionMutation(state: PermissionViewState, token: number, pending: string): PermissionViewState {
  if (state.kind !== "ready" || state.token !== token) return state;
  return { ...state, feedback: null, pending };
}

export function applyLevelMutation(
  state: PermissionViewState,
  token: number,
  result: PermissionLevelState,
): PermissionViewState {
  if (state.kind !== "ready" || state.token !== token) return state;
  return {
    ...state,
    data: { ...state.data, ...result },
    feedback: { kind: "saved", message: "Permission Level saved" },
    pending: null,
  };
}

export function applyCellResult(
  state: PermissionViewState,
  input: { token: number; result: PermissionCellSetResult; message: string },
): PermissionViewState {
  const { token, result, message } = input;
  if (state.kind !== "ready" || state.token !== token) return state;
  return {
    kind: "ready",
    token,
    data: {
      ...state.data,
      policyGeneration: result.policyGeneration,
      registryRevision: result.registryRevision,
      cells: state.data.cells.map((cell) =>
        cell.key === result.cell.key && cell.level === result.cell.level ? result.cell : cell,
      ),
    },
    feedback: { kind: "saved", message },
    pending: null,
  };
}

export function validateCellMutationSnapshot(
  policyGeneration: number,
  registryRevision: number,
  cells: PermissionCellsState,
): boolean {
  return cells.policyGeneration === policyGeneration && cells.registryRevision === registryRevision;
}

export function failPermissionMutation(state: PermissionViewState, token: number, cause: unknown): PermissionViewState {
  if (state.kind !== "ready" || state.token !== token) return state;
  return { ...state, feedback: permissionMutationFeedback(cause), pending: null };
}

export function permissionMutationFeedback(cause: unknown): PermissionFeedback {
  const app = permissionAppError(cause);
  const feedback: PermissionFeedback =
    app.code === ErrorCodeSchema.enum.POLICY_CONFLICT
      ? { kind: "conflict", message: "Policy changed elsewhere; refreshed from Core" }
      : app.code === ErrorCodeSchema.enum.GOVERNANCE_REFUSED
        ? { kind: "refused", reason: app.reason, message: refusalMessage(app.reason, errorMessage(cause)) }
        : { kind: "error", message: errorMessage(cause) };
  return feedback;
}

export function permissionAppError(cause: unknown): { code: string | null; reason: string | null } {
  if (typeof cause !== "object" || cause === null || !("data" in cause)) return { code: null, reason: null };
  const data = cause.data;
  if (typeof data !== "object" || data === null) return { code: null, reason: null };
  const record = data as Record<string, unknown>;
  const code = ErrorCodeSchema.safeParse(record.code);
  return { code: code.success ? code.data : null, reason: typeof record.reason === "string" ? record.reason : null };
}

export function previousData(state: PermissionViewState): PermissionCellsState | null {
  return state.kind === "ready" ? state.data : state.previous;
}

function refusalMessage(reason: string | null, fallback: string): string {
  if (reason === "immutable") return "Core refused the change because this cell is immutable";
  if (reason === "second-confirm-required") return "Core requires a prominent second confirmation";
  if (reason === "unknown-cell") return "Core no longer recognizes this governance cell; refresh required";
  return fallback;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

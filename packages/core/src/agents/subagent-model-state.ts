/**
 * INPUT: scoped child summaries, exact action targets and event-specific waits
 * OUTPUT: compact model navigation/state with distinct work selectors and complete check-in evidence
 * POS: core/agents — delegation-only projection; canonical state and raw recovery remain unchanged
 */
import { SubagentInputWaitSchema, SubagentSummarySchema, SubagentTargetSchema, type SubagentSummary } from "@taki/shared";

export function subagentWaitModelState(value: unknown): unknown {
  const parsed = SubagentInputWaitSchema.safeParse(value);
  if (!parsed.success) return value;
  const { eventId, workInputId, state, reason, checkIn } = parsed.data;
  return { eventId, workInputId, state, reason, checkIn };
}

export function subagentCurrentModelState(value: unknown, context: { target?: unknown; pendingRequest?: unknown } = {}): unknown {
  const parsed = SubagentSummarySchema.safeParse(value);
  if (!parsed.success) return value;
  return currentModelState(parsed.data, context);
}

function currentModelState(current: SubagentSummary, context: { target?: unknown; pendingRequest?: unknown }) {
  const target = SubagentTargetSchema.safeParse(context.target);
  const sameChild = target.success && target.data.subagentId === current.subagentId;
  const sameTarget = sameChild && target.data.expectedRunId === current.activeRunId
    && target.data.expectedControlVersion === current.controlVersion;
  const pending = SubagentInputWaitSchema.safeParse(context.pendingRequest);
  const samePending = pending.success && JSON.stringify(pending.data) === JSON.stringify(current.pendingRequest);
  return { worker: current.label, state: current.state, stopOrigin: current.stopOrigin,
    ...(!sameChild ? { subagentId: current.subagentId } : {}),
    ...(!sameTarget ? { activeRunId: current.activeRunId, controlVersion: current.controlVersion } : {}),
    ...(current.activeWorkInputId && (!sameChild || current.activeWorkInputId !== target.data.workInputId)
      ? { activeWorkInputId: current.activeWorkInputId } : {}),
    ...(current.latestWorkInputId && (!sameChild || current.latestWorkInputId !== target.data.workInputId)
      ? { latestWorkInputId: current.latestWorkInputId } : {}),
    ...(current.pendingRequest && !samePending ? { pendingRequest: subagentWaitModelState(current.pendingRequest) } : {}),
    ...(current.latestCompletionId ? { latestCompletionId: current.latestCompletionId } : {}) };
}

export function subagentWorkerModelState(current: SubagentSummary) {
  const workInputId = current.pendingRequest?.workInputId ?? current.activeWorkInputId ?? current.latestWorkInputId;
  const target = workInputId ? { subagentId: current.subagentId, workInputId,
    expectedRunId: current.activeRunId, expectedControlVersion: current.controlVersion } : null;
  return { ...currentModelState(current, { target }), target };
}

export function subagentScopedModelState(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  return { ...row,
    ...(row.current !== undefined ? { current: subagentCurrentModelState(row.current,
      { target: row.currentTarget ?? row.target, pendingRequest: row.pendingRequest }) } : {}),
    ...(row.pendingRequest !== undefined ? { pendingRequest: subagentWaitModelState(row.pendingRequest) } : {}) };
}

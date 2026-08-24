import { RunEventSummarySchema, type RunEvent, type RunEventSummary } from "@taki/shared";

export interface RunEventProjection<T> { initial(): T; apply(state: T, event: RunEvent): T; }
export interface LifecycleProjectionState { milestones: RunEventSummary[]; terminal?: RunEventSummary; }
export const lifecycleProjection: RunEventProjection<LifecycleProjectionState> = {
  initial: () => ({ milestones: [] }),
  apply(state, event) {
    const summary = RunEventSummarySchema.parse(toSummary(event));
    const next = { milestones: [...state.milestones, summary], ...(event.kind === "run.settled" ? { terminal: summary } : {}) } as LifecycleProjectionState;
    return next;
  },
};
export function replayRunEvents<T>(events: readonly RunEvent[], projection: RunEventProjection<T>): T { return events.reduce((state, event) => projection.apply(state, event), projection.initial()); }

function toSummary(event: RunEvent): RunEventSummary {
  const terminal = event.kind === "run.settled";
  const phase = event.kind.startsWith("attempt.") ? "attempt" : event.kind.startsWith("run.") ? "run" : event.kind.startsWith("effect.") ? "effect" : event.kind.startsWith("usage.") ? "usage" : "lifecycle";
  const payload = event.payload;
  return { label: event.kind.replace(/[._]/g, " "), phase, status: "state" in payload ? payload.state : event.kind, ...("outcome" in payload && payload.outcome ? { outcome: payload.outcome } : {}), ...("summary" in payload && payload.summary ? { summary: payload.summary } : {}), surface: terminal ? "current" : event.kind === "attempt.settled" ? "shadowed" : "current" };
}

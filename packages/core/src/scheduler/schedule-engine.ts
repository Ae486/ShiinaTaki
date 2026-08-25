/**
 * INPUT: durable due tasks, occurrence outbox, calendar adapter, Run dispatch adapter, and injected timers/clock
 * OUTPUT: boot reconciliation plus one single-flight unref'd timer for live Scheduled Task dispatch
 * POS: core/scheduler - lifecycle owner for timing only; Run correctness remains Harness-owned
 */
import type { ScheduledTask } from "@taki/shared";
import type { ScheduledTaskRepo } from "../db/scheduled-task-repo.ts";
import type { Logger } from "../logging/logger.ts";
import type { SchedulePatternAdapter } from "./schedule-pattern.ts";
import type { ScheduledRunAdapter } from "./scheduled-run-adapter.ts";

interface TimerHandle { unref?(): void }
export interface ScheduleEngine { start(): Promise<void>; rearm(): void; stop(): Promise<void>; runDue(): Promise<void>; }
export function createScheduleEngine(input: { repo: ScheduledTaskRepo; patterns: SchedulePatternAdapter; runs: ScheduledRunAdapter; userTimezone: () => string; logger: Logger; now?: () => Date; setTimer?: (callback: () => void, delay: number) => TimerHandle; clearTimer?: (timer: TimerHandle) => void }): ScheduleEngine {
  const now = input.now ?? (() => new Date()); const setTimer = input.setTimer ?? ((callback, delay) => setTimeout(callback, delay)); const clearTimer = input.clearTimer ?? ((timer) => clearTimeout(timer as NodeJS.Timeout));
  let timer: TimerHandle | undefined; let stopped = true; let activeRun: Promise<void> | undefined;
  const zone = (task: ScheduledTask) => task.timezone.kind === "fixed" ? task.timezone.timezone : input.userTimezone();
  const arm = () => {
    if (stopped) return;
    if (timer) clearTimer(timer);
    timer = undefined;
    const unsettled = input.repo.unsettled();
    const retryPending = unsettled.some((occurrence) => occurrence.state === "pending");
    const reconcileAdmitted = unsettled.some((occurrence) => occurrence.state === "admitted");
    const next = input.repo.list().filter((task) => task.state === "active" && task.enabled && task.nextRunAt)
      .sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!))[0];
    if (!retryPending && !reconcileAdmitted && !next?.nextRunAt) return;
    const delay = retryPending ? 1_000 : !next?.nextRunAt ? 5_000 : Math.min(2_147_000_000, Math.max(0, Date.parse(next.nextRunAt) - now().getTime()));
    timer = setTimer(() => { void runDue(); }, delay);
    timer.unref?.();
  };
  const processTask = async (task: ScheduledTask, fired: Date) => {
    const stored = task.nextRunAt!;
    const latest = task.pattern.kind === "at" ? stored : input.patterns.latestDue(task.pattern, zone(task), fired);
    const scheduledFor = latest && Date.parse(latest) >= Date.parse(stored) ? latest : stored;
    const scheduledMs = Date.parse(scheduledFor); const immediateNext = task.pattern.kind === "at" ? undefined : input.patterns.next(task.pattern, zone(task), new Date(scheduledMs))?.scheduledFor;
    const period = task.pattern.kind === "at" ? 48 * 60 * 60 * 1_000 : immediateNext ? Date.parse(immediateNext) - scheduledMs : input.patterns.periodMs(task.pattern) ?? 0;
    const lateMs = Math.max(0, fired.getTime() - scheduledMs); const cutoff = task.pattern.kind === "at" ? 24 * 60 * 60 * 1_000 : Math.floor(period / 2); const missed = cutoff <= 0 || lateMs > cutoff;
    const next = missed && task.pattern.kind !== "at" ? input.patterns.next(task.pattern, zone(task), fired)?.scheduledFor : immediateNext;
    const occurrence = input.repo.claimOccurrence({ taskId: task.taskId, characterId: task.characterId, scheduledFor, taskRevision: task.revision, controlInput: task.controlInput, firedAt: fired.toISOString(), late: lateMs > 0 });
    input.repo.advance({ taskId: task.taskId, nextRunAt: next, completed: task.pattern.kind === "at" });
    if (!occurrence) return;
    if (missed) { input.repo.settleOccurrence({ taskId: task.taskId, scheduledFor, state: "missed" }); return; }
    await input.runs.dispatch(task.taskId, occurrence);
  };
  const executeDue = async () => { try { input.runs.reconcile(); const fired = now(); for (const occurrence of input.repo.unsettled()) await input.runs.dispatch(occurrence.taskId, occurrence); for (const task of input.repo.due(fired.toISOString())) await processTask(task, fired); } catch (error) { input.logger.error({ errorCode: error instanceof Error ? error.name : "unknown" }, "schedule timer callback failed"); } };
  const runDue = () => {
    if (stopped) return Promise.resolve();
    if (activeRun) return activeRun;
    const execution = executeDue().finally(() => { if (activeRun === execution) activeRun = undefined; arm(); });
    activeRun = execution;
    return execution;
  };
  return { async start() { stopped = false; await runDue(); }, rearm: arm, async stop() { stopped = true; if (timer) clearTimer(timer); timer = undefined; await activeRun; }, runDue };
}

/**
 * INPUT: strict operator/Agent commands, timezone authority, pattern adapter, and schedule repository
 * OUTPUT: revision-safe management and transaction-local future User Timezone recomputation
 * POS: core/scheduler - command mutations re-arm; timezone owner re-arms after its encompassing commit
 */
import { ScheduledTaskCreateParamsSchema, ScheduledTaskUpdateParamsSchema, ScheduledTaskRevisionParamsSchema, type ScheduledTask, type ScheduledTaskCreateParams, type ScheduledTaskUpdateParams } from "@taki/shared";
import type { ScheduledTaskRepo } from "../db/scheduled-task-repo.ts";
import type { SchedulePatternAdapter } from "./schedule-pattern.ts";

export interface ScheduledTaskService {
  list(characterId?: string): ScheduledTask[]; create(input: ScheduledTaskCreateParams): ScheduledTask;
  update(input: ScheduledTaskUpdateParams): ScheduledTask; pause(taskId: string, expectedRevision: number): ScheduledTask;
  resume(taskId: string, expectedRevision: number): ScheduledTask; delete(taskId: string, expectedRevision: number): ScheduledTask;
  recomputeUserTimezone(timezone: string, at: Date): void;
}
export class ScheduledTaskValidationError extends Error {
  constructor() { super("Scheduled Task schedule is invalid"); this.name = "ScheduledTaskValidationError"; }
}
export function createScheduledTaskService(input: { repo: ScheduledTaskRepo; patterns: SchedulePatternAdapter; userTimezone: () => string; now?: () => Date; rearm?: () => void }): ScheduledTaskService {
  const now = input.now ?? (() => new Date());
  const timezone = (value: ScheduledTaskCreateParams["timezone"]) => value.kind === "fixed" ? value.timezone : input.userTimezone();
  const canonical = (value: ScheduledTaskCreateParams): ScheduledTaskCreateParams => {
    const pattern = value.pattern.kind === "at" ? { ...value.pattern, at: new Date(Date.parse(value.pattern.at)).toISOString() }
      : value.pattern.kind === "every" ? { ...value.pattern, anchorAt: new Date(Date.parse(value.pattern.anchorAt)).toISOString() } : value.pattern;
    return { ...value, pattern };
  };
  const nextRun = (value: ScheduledTaskCreateParams) => { try { const zone = timezone(value.timezone); input.patterns.validate(value.pattern, zone); if (value.pattern.kind === "at") return value.pattern.at; return input.patterns.next(value.pattern, zone, new Date(now().getTime() - 1))?.scheduledFor; } catch { throw new ScheduledTaskValidationError(); } };
  const after = <T>(run: () => T): T => { const result = run(); input.rearm?.(); return result; };
  return {
    list: (characterId) => input.repo.list(characterId),
    create(candidate) { const value = canonical(ScheduledTaskCreateParamsSchema.parse(candidate)); return after(() => input.repo.create({ ...value, nextRunAt: nextRun(value) })); },
    update(candidate) { const parsed = ScheduledTaskUpdateParamsSchema.parse(candidate); const value = { ...canonical(parsed), expectedRevision: parsed.expectedRevision, taskId: parsed.taskId }; return after(() => input.repo.update({ ...value, nextRunAt: nextRun(value) })); },
    pause(taskId, expectedRevision) { ScheduledTaskRevisionParamsSchema.parse({ taskId, expectedRevision }); return after(() => input.repo.setState({ taskId, expectedRevision, state: "paused" })); },
    resume(taskId, expectedRevision) { ScheduledTaskRevisionParamsSchema.parse({ taskId, expectedRevision }); const task = input.repo.get(taskId); if (!task) return input.repo.setState({ taskId, expectedRevision, state: "active" }); let nextRunAt: string | undefined; try { nextRunAt = task.pattern.kind === "at" ? task.pattern.at : input.patterns.next(task.pattern, timezone(task.timezone), new Date(now().getTime() - 1))?.scheduledFor; } catch { throw new ScheduledTaskValidationError(); } return after(() => input.repo.setState({ taskId, expectedRevision, state: "active", nextRunAt })); },
    delete(taskId, expectedRevision) { ScheduledTaskRevisionParamsSchema.parse({ taskId, expectedRevision }); return after(() => input.repo.setState({ taskId, expectedRevision, state: "deleted" })); },
    recomputeUserTimezone(zone, at) {
      for (const task of input.repo.list()) {
        if (!task.enabled || task.state !== "active" || task.timezone.kind !== "user" || task.pattern.kind !== "cron") continue;
        // Existing claimed occurrences are immutable. Recalculate only the unclaimed future source slot;
        // at/every encode absolute instants and pinned-zone cron intentionally does not follow this change.
        const nextRunAt = input.patterns.next(task.pattern, zone, at)?.scheduledFor;
        input.repo.advance({ taskId: task.taskId, nextRunAt });
      }
    },
  };
}

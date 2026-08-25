/**
 * INPUT: MethodRegistry and ScheduledTaskService
 * OUTPUT: operator-only scheduled-task list/create/update/pause/resume/delete registrations
 * POS: core/server/methods - thin protocol controllers over the shared schedule command service
 */
import { ErrorCodeSchema, SCHEDULED_TASK_METHODS, ScheduledTaskCreateParamsSchema, ScheduledTaskUpdateParamsSchema, ScheduledTaskRevisionParamsSchema, ScheduledTaskListParamsSchema, type ScheduledTaskCreateParams, type ScheduledTaskUpdateParams, type ScheduledTaskRevisionParams, type ScheduledTaskListParams } from "@taki/shared";
import type { ScheduledTaskService } from "../../scheduler/scheduled-task-service.ts";
import { ScheduledTaskConflictError, ScheduledTaskNotFoundError } from "../../db/scheduled-task-repo.ts";
import type { MethodRegistry } from "../method-registry.ts";
import { appException } from "../app-error.ts";
import { ScheduledTaskValidationError } from "../../scheduler/scheduled-task-service.ts";

function handleScheduleError(error: unknown): never {
  if (error instanceof ScheduledTaskConflictError) throw appException(ErrorCodeSchema.enum.SCHEDULE_CONFLICT, "Scheduled Task revision conflict", { currentRevision: error.currentRevision });
  if (error instanceof ScheduledTaskNotFoundError) throw appException(ErrorCodeSchema.enum.SCHEDULE_REFUSED, "Scheduled Task was not found", { reason: "not_found" });
  if (error instanceof ScheduledTaskValidationError) throw appException(ErrorCodeSchema.enum.SCHEDULE_REFUSED, "Scheduled Task schedule is invalid", { reason: "invalid_schedule" });
  throw appException(ErrorCodeSchema.enum.INTERNAL_ERROR, "Scheduled Task operation failed");
}
export function registerScheduledTaskMethods(registry: MethodRegistry, service: ScheduledTaskService): void {
  registry.register({ method: SCHEDULED_TASK_METHODS.list, roles: ["operator"], paramsSchema: ScheduledTaskListParamsSchema, handler: (p: ScheduledTaskListParams) => ({ tasks: service.list(p.characterId) }) });
  registry.register({ method: SCHEDULED_TASK_METHODS.create, roles: ["operator"], paramsSchema: ScheduledTaskCreateParamsSchema, handler: (p: ScheduledTaskCreateParams) => { try { return { task: service.create(p) }; } catch (error) { return handleScheduleError(error); } } });
  registry.register({ method: SCHEDULED_TASK_METHODS.update, roles: ["operator"], paramsSchema: ScheduledTaskUpdateParamsSchema, handler: (p: ScheduledTaskUpdateParams) => { try { return { task: service.update(p) }; } catch (error) { return handleScheduleError(error); } } });
  for (const [method, action] of [[SCHEDULED_TASK_METHODS.pause, "pause"], [SCHEDULED_TASK_METHODS.resume, "resume"], [SCHEDULED_TASK_METHODS.delete, "delete"]] as const) registry.register({ method, roles: ["operator"], paramsSchema: ScheduledTaskRevisionParamsSchema, handler: (p: ScheduledTaskRevisionParams) => { try { return { task: service[action](p.taskId, p.expectedRevision) }; } catch (error) { return handleScheduleError(error); } } });
}

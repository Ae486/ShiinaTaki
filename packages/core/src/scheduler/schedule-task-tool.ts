/**
 * INPUT: LLM action-discriminated schedule management calls and the shared ScheduledTaskService
 * OUTPUT: createScheduleTaskTool() -> ToolSet { schedule_task } with bounded structured results
 * POS: core/scheduler - primary-turn-only Agent surface; never registered for Scheduled Runs
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { ScheduledTaskCreateParamsSchema, ScheduledTaskUpdateParamsSchema, ScheduledTaskRevisionParamsSchema } from "@taki/shared";
import { ScheduledTaskConflictError } from "../db/scheduled-task-repo.ts";
import type { ScheduledTaskService } from "./scheduled-task-service.ts";
import { ScheduledTaskValidationError } from "./scheduled-task-service.ts";

const AgentCreate = ScheduledTaskCreateParamsSchema.omit({ characterId: true });
const AgentUpdate = ScheduledTaskUpdateParamsSchema.omit({ characterId: true });
const Input = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({ action: z.literal("create"), value: AgentCreate }),
  z.strictObject({ action: z.literal("update"), value: AgentUpdate }),
  z.strictObject({ action: z.enum(["pause", "resume", "delete"]), value: ScheduledTaskRevisionParamsSchema }),
]);
export function createScheduleTaskTool(service: ScheduledTaskService, characterId: string): ToolSet {
  const owns = (taskId: string) => service.list(characterId).some((task) => task.taskId === taskId);
  return { schedule_task: tool({
    description: "List, create, edit, pause, resume, or delete this Character's durable Scheduled Tasks. Use canonical UTC instants, durations, or cron expressions; do not guess a timezone.",
    inputSchema: Input,
    execute: (input) => {
      try {
        if (input.action === "list") return { ok: true, tasks: service.list(characterId) };
        if (input.action === "create") return { ok: true, task: service.create({ ...input.value, characterId }) };
        if (!owns(input.value.taskId)) return { ok: false, code: "SCHEDULE_REFUSED", message: "Scheduled Task is unavailable" };
        if (input.action === "update") return { ok: true, task: service.update({ ...input.value, characterId }) };
        const { taskId, expectedRevision } = input.value;
        const mutate = input.action === "pause" ? service["pause"] : input.action === "resume" ? service["resume"] : service.delete;
        return { ok: true, task: mutate(taskId, expectedRevision) };
      } catch (error) {
        return { ok: false, code: error instanceof ScheduledTaskConflictError ? "SCHEDULE_CONFLICT" : error instanceof ScheduledTaskValidationError ? "SCHEDULE_REFUSED" : "INTERNAL_ERROR", message: "Scheduled Task operation was refused", ...(error instanceof ScheduledTaskConflictError ? { currentRevision: error.currentRevision } : {}) };
      }
    },
  }) };
}

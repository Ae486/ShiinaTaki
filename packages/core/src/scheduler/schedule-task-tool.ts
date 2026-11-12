/**
 * INPUT: LLM action-discriminated schedule management calls and the shared ScheduledTaskService
 * OUTPUT: createScheduleTaskTool() -> ToolSet { schedule_task } with bounded structured results
 * POS: core/scheduler - primary-turn-only Agent surface; never registered for Scheduled Runs
 */
import { asSchema, jsonSchema, tool, type ToolSet } from "ai";
import { z } from "zod";
import { ScheduledTaskCreateParamsSchema, ScheduledTaskUpdateParamsSchema, ScheduledTaskRevisionParamsSchema } from "@taki/shared";
import { ScheduledTaskConflictError } from "../db/scheduled-task-repo.ts";
import type { ScheduledTaskService } from "./scheduled-task-service.ts";
import { ScheduledTaskValidationError } from "./scheduled-task-service.ts";
import { scheduleTaskModelOutput } from "./schedule-task-model-output.ts";

const AgentCreate = ScheduledTaskCreateParamsSchema.omit({ characterId: true });
const AgentUpdate = ScheduledTaskUpdateParamsSchema.omit({ characterId: true });
const Input = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({ action: z.literal("create"), value: AgentCreate }),
  z.strictObject({ action: z.literal("update"), value: AgentUpdate }),
  z.strictObject({ action: z.enum(["pause", "resume", "delete"]), value: ScheduledTaskRevisionParamsSchema }),
]);

// Keep the provider contract object-rooted and strict-ready while Core retains the
// stronger action/payload relationship enforced by the canonical discriminated union.
const ProviderInput = z.strictObject({
  action: z.enum(["list", "create", "update", "pause", "resume", "delete"])
    .describe("List full current task records, create a durable task, update its definition, or pause/resume/delete an exact returned task."),
  value: z.union([AgentCreate, AgentUpdate, ScheduledTaskRevisionParamsSchema]).nullable()
    .describe("Null for list. Create supplies name/controlInput/pattern/timezone; update also requires returned taskId and expectedRevision. Pause/resume/delete require only that taskId and expectedRevision."),
});
type ScheduleTaskInput = z.infer<typeof Input>;

function parseInput(value: unknown): ReturnType<typeof Input.safeParse> {
  const envelope = ProviderInput.safeParse(value);
  if (!envelope.success) return Input.safeParse(value);
  return Input.safeParse(
    envelope.data.action === "list" && envelope.data.value === null
      ? { action: "list" }
      : envelope.data,
  );
}

const ProviderPortableInput = jsonSchema<ScheduleTaskInput>(
  () => asSchema(ProviderInput).jsonSchema,
  {
    validate: (value) => {
      const parsed = parseInput(value);
      return parsed.success
        ? { success: true, value: parsed.data }
        : { success: false, error: parsed.error };
    },
  },
);

export function createScheduleTaskTool(service: ScheduledTaskService, characterId: string): ToolSet {
  const owns = (taskId: string) => service.list(characterId).some((task) => task.taskId === taskId);
  return { schedule_task: tool({
    description: "List, create, edit, pause, resume, or delete this Character's durable Scheduled Tasks. " +
      "Use canonical UTC instants, durations, or cron expressions; do not guess a timezone. " +
      "List returns complete records including timestamps and the last execution reference. Mutation receipts confirm the saved definition/state, not execution of the task. " +
      "Use the exact returned taskId and revision for later changes. SCHEDULE_CONFLICT/currentRevision means reread before deciding; a refusal leaves the requested change unapplied.",
    inputSchema: ProviderPortableInput,
    toModelOutput: scheduleTaskModelOutput,
    execute: (rawInput) => {
      try {
        const parsed = parseInput(rawInput);
        if (!parsed.success) {
          return { ok: false, code: "SCHEDULE_REFUSED", message: "Scheduled Task operation has an invalid action or payload" };
        }
        const input = parsed.data;
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

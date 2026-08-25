/**
 * INPUT: canonical schedule definitions and operator/Agent mutations
 * OUTPUT: strict Scheduled Task protocol schemas shared by Core and later clients
 * POS: shared/protocol - the only public schedule shape; execution identity remains Run-owned
 */
import { z } from "zod";

const Id = z.string().min(1).max(200);
const Timestamp = z.string().datetime({ offset: true });
const Text = z.string().min(1).max(1_000);
const Timezone = z.string().min(1).max(100).refine((value) => {
  try { Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
}, "must be an IANA timezone");

export const SCHEDULED_TASK_METHODS = {
  list: "scheduled-task.list", create: "scheduled-task.create", update: "scheduled-task.update",
  pause: "scheduled-task.pause", resume: "scheduled-task.resume", delete: "scheduled-task.delete",
} as const;
export const ScheduleAtSchema = z.strictObject({ kind: z.literal("at"), at: Timestamp });
export const ScheduleEverySchema = z.strictObject({ kind: z.literal("every"), everyMs: z.number().int().min(1_000).max(31_536_000_000), anchorAt: Timestamp });
export const ScheduleCronSchema = z.strictObject({ kind: z.literal("cron"), expression: z.string().min(1).max(200) });
export const SchedulePatternSchema = z.discriminatedUnion("kind", [ScheduleAtSchema, ScheduleEverySchema, ScheduleCronSchema]);
export type SchedulePattern = z.infer<typeof SchedulePatternSchema>;
export const ScheduleTimezoneSchema = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("user") }), z.strictObject({ kind: z.literal("fixed"), timezone: Timezone })]);
export type ScheduleTimezone = z.infer<typeof ScheduleTimezoneSchema>;
export const ScheduledTaskSchema = z.strictObject({ taskId: Id, characterId: Id, name: z.string().min(1).max(120), controlInput: Text, pattern: SchedulePatternSchema, timezone: ScheduleTimezoneSchema, enabled: z.boolean(), state: z.enum(["active", "paused", "completed", "deleted"]), revision: z.number().int().positive(), nextRunAt: Timestamp.optional(), lastRunId: Id.optional(), createdAt: Timestamp, updatedAt: Timestamp });
export type ScheduledTask = z.infer<typeof ScheduledTaskSchema>;
const CreateFields = { characterId: Id, name: z.string().min(1).max(120), controlInput: Text, pattern: SchedulePatternSchema, timezone: ScheduleTimezoneSchema };
export const ScheduledTaskCreateParamsSchema = z.strictObject(CreateFields);
export type ScheduledTaskCreateParams = z.infer<typeof ScheduledTaskCreateParamsSchema>;
export const ScheduledTaskUpdateParamsSchema = z.strictObject({ taskId: Id, expectedRevision: z.number().int().positive(), ...CreateFields });
export type ScheduledTaskUpdateParams = z.infer<typeof ScheduledTaskUpdateParamsSchema>;
export const ScheduledTaskRevisionParamsSchema = z.strictObject({ taskId: Id, expectedRevision: z.number().int().positive() });
export type ScheduledTaskRevisionParams = z.infer<typeof ScheduledTaskRevisionParamsSchema>;
export const ScheduledTaskListParamsSchema = z.strictObject({ characterId: Id.optional() });
export type ScheduledTaskListParams = z.infer<typeof ScheduledTaskListParamsSchema>;
export const ScheduledTaskListResultSchema = z.strictObject({ tasks: z.array(ScheduledTaskSchema).max(10_000) });
export type ScheduledTaskListResult = z.infer<typeof ScheduledTaskListResultSchema>;
export const ScheduledTaskMutationResultSchema = z.strictObject({ task: ScheduledTaskSchema });
export type ScheduledTaskMutationResult = z.infer<typeof ScheduledTaskMutationResultSchema>;

/**
 * INPUT: raw schedule_task outcomes and the selected management action
 * OUTPUT: compact mutation receipts with exact task/revision selectors; complete list and refusal results
 * POS: core/scheduler — SDK-only projection; service records and durable task history remain canonical
 */
import type { Tool } from "ai";
import { ScheduledTaskSchema } from "@taki/shared";

export const scheduleTaskModelOutput: NonNullable<Tool["toModelOutput"]> = ({ input, output }) => {
  const action = typeof input === "object" && input !== null && "action" in input ? input.action : undefined;
  if (!["create", "update", "pause", "resume", "delete"].includes(action)
    || typeof output !== "object" || output === null || !("ok" in output) || output.ok !== true || !("task" in output)) {
    return { type: "json", value: output };
  }
  const parsed = ScheduledTaskSchema.safeParse(output.task);
  if (!parsed.success) return { type: "json", value: output };
  const task = parsed.data;
  // Regular writers make enabled equivalent to active. Preserve a divergent record's
  // explicit flag rather than hiding an unsupported or future writer's behavior.
  return { type: "json", value: { ...output, task: { taskId: task.taskId, name: task.name,
    controlInput: task.controlInput, pattern: task.pattern, timezone: task.timezone, state: task.state,
    revision: task.revision, ...(task.nextRunAt ? { nextRunAt: task.nextRunAt } : {}),
    ...(task.enabled !== (task.state === "active") ? { enabled: task.enabled } : {}) } } };
};

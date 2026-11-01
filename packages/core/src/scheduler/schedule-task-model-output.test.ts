import { expect, it, vi } from "vitest";
import { ToolLoopAgent, isStepCount } from "ai";
import type { ScheduledTask } from "@taki/shared";
import { scheduleTaskModelOutput } from "./schedule-task-model-output.ts";
import { createScheduleTaskTool } from "./schedule-task-tool.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { ScheduledTaskConflictError } from "../db/scheduled-task-repo.ts";

const task: ScheduledTask = { taskId: "task-exact", characterId: "taki", name: "Review",
  controlInput: "Review the open items", pattern: { kind: "cron", expression: "0 9 * * 1" },
  timezone: { kind: "fixed", timezone: "Asia/Shanghai" }, enabled: true, state: "active", revision: 3,
  nextRunAt: "2026-11-02T01:00:00.000Z", lastRunId: "last-run-exact", createdAt: "2026-10-01T01:00:00.000Z",
  updatedAt: "2026-11-01T01:00:00.000Z" };

it.each(["create", "update", "pause", "resume", "delete"])("compacts only mutation %s while retaining full list, definition and exact revision", async (action) => {
  const state = action === "pause" ? "paused" : action === "delete" ? "deleted" : "active";
  const original = { ...task, state, enabled: state === "active" };
  const output = { ok: true, task: original };
  expect(await scheduleTaskModelOutput({ toolCallId: "receipt", input: { action }, output })).toEqual({ type: "json", value: {
    ok: true, task: { taskId: task.taskId, name: task.name, controlInput: task.controlInput,
      pattern: task.pattern, timezone: task.timezone, state, revision: 3, nextRunAt: task.nextRunAt },
  } });
  const full = { ok: true, tasks: [original] };
  expect(await scheduleTaskModelOutput({ toolCallId: "list", input: { action: "list" }, output: full }))
    .toEqual({ type: "json", value: full });
  expect(original.lastRunId).toBe("last-run-exact");
});

it("preserves a divergent enabled flag and exact conflict currentRevision", async () => {
  const divergent = { ok: true, task: { ...task, enabled: false } };
  expect(await scheduleTaskModelOutput({ toolCallId: "update", input: { action: "update" }, output: divergent }))
    .toMatchObject({ value: { task: { enabled: false, state: "active" } } });
  const tools = createScheduleTaskTool({ list: () => [task], pause: () => { throw new ScheduledTaskConflictError(7); } } as never, "taki");
  const input = { action: "pause", value: { taskId: task.taskId, expectedRevision: 3 } };
  const output = await tools.schedule_task!.execute!(input, { toolCallId: "pause", messages: [], context: undefined });
  expect(output).toMatchObject({ ok: false, code: "SCHEDULE_CONFLICT", currentRevision: 7 });
  expect(await tools.schedule_task!.toModelOutput!({ toolCallId: "pause", input, output })).toEqual({ type: "json", value: output });
});

it("uses complete list records and compact mutation receipts in actual SDK prompts without changing raw results", async () => {
  const paused = { ...task, enabled: false, state: "paused", revision: 4 };
  const pause = vi.fn(() => paused);
  const tools = createScheduleTaskTool({ list: () => [task], pause } as never, "taki");
  const model = scriptedModel([
    { kind: "tool", toolCallId: "list", toolName: "schedule_task", input: { action: "list", value: null } },
    { kind: "tool", toolCallId: "pause", toolName: "schedule_task", input: { action: "pause", value: { taskId: task.taskId, expectedRevision: 3 } } },
    { kind: "text", deltas: ["Paused the saved schedule"] },
  ]);
  const raw: unknown[] = [];
  const agent = new ToolLoopAgent({ model, tools, stopWhen: isStepCount(3), onStepEnd(step) {
    raw.push(...step.toolResults.map((result) => result.output));
  } });
  await (await agent.stream({ prompt: "List my schedules and pause the review" })).consumeStream();
  expect(raw).toEqual([{ ok: true, tasks: [task] }, { ok: true, task: paused }]);
  const outputs = model.doStreamCalls[2]!.prompt.flatMap((message) => message.role === "tool" ? message.content : [])
    .filter((part) => part.type === "tool-result").map((part) => part.output);
  expect(outputs[0]).toEqual({ type: "json", value: raw[0] });
  expect(outputs[1]).toEqual(await scheduleTaskModelOutput({ toolCallId: "pause", input: { action: "pause" }, output: raw[1] }));
  expect(pause).toHaveBeenCalledWith(task.taskId, 3);
});

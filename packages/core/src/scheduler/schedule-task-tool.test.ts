import { describe, expect, it, vi } from "vitest";
import { asSchema, type ToolSet } from "ai";
import { createScheduleTaskTool } from "./schedule-task-tool.ts";
import { createChatAgent } from "../agents/chat-agent.ts";
import { createCompanionFixture } from "../testing/companion-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";

async function execute(tools: ToolSet, input: unknown) { return tools.schedule_task?.execute?.(input, { toolCallId: "schedule", messages: [] } as never); }
const createValue = { name: "Reminder", controlInput: "work", pattern: { kind: "at", at: "2026-08-25T00:00:00.000Z" }, timezone: { kind: "user" } } as const;
const updateValue = { taskId: "task", expectedRevision: 1, ...createValue } as const;
const revisionValue = { taskId: "task", expectedRevision: 1 } as const;

describe("schedule_task tool", () => {
  it("publishes a provider-portable strict object schema", async () => {
    const tools = createScheduleTaskTool({} as never, "taki");
    const schema = await asSchema(tools.schedule_task?.inputSchema).jsonSchema;
    expect(schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["action", "value"],
      properties: {
        action: { type: "string", enum: ["list", "create", "update", "pause", "resume", "delete"] },
        value: { anyOf: expect.any(Array) },
      },
    });
    expect(schema).not.toHaveProperty("oneOf");
    expect(schema).not.toHaveProperty("anyOf");
  });

  it("validates through the AI SDK schema and canonicalizes list", async () => {
    const tools = createScheduleTaskTool({} as never, "taki");
    const schema = asSchema(tools.schedule_task?.inputSchema);
    const validInputs = [
      { input: { action: "list", value: null }, value: { action: "list" } },
      { input: { action: "create", value: createValue }, value: { action: "create", value: createValue } },
      { input: { action: "update", value: updateValue }, value: { action: "update", value: updateValue } },
      ...(["pause", "resume", "delete"] as const).map((action) => ({
        input: { action, value: revisionValue },
        value: { action, value: revisionValue },
      })),
    ];
    for (const sample of validInputs) expect(await schema.validate?.(sample.input)).toEqual({
      success: true,
      value: sample.value,
    });
    for (const invalid of [
      { action: "list", value: revisionValue },
      { action: "create", value: revisionValue },
      { action: "update", value: createValue },
      { action: "pause", value: createValue },
      { action: "resume", value: null },
      { action: "delete", value: updateValue },
    ]) expect(await schema.validate?.(invalid)).toMatchObject({ success: false, error: expect.any(Error) });
  });

  it("delegates every action with active Character ownership and revision", async () => {
    const list = vi.fn(() => [{ taskId: "task" }]);
    const create = vi.fn(() => ({ taskId: "created" }));
    const update = vi.fn(() => ({ taskId: "task" }));
    const pause = vi.fn(() => ({ taskId: "task" }));
    const resume = vi.fn(() => ({ taskId: "task" }));
    const remove = vi.fn(() => ({ taskId: "task" }));
    const tools = createScheduleTaskTool({ list, create, update, pause, resume, delete: remove } as never, "taki");

    expect(await execute(tools, { action: "list" })).toMatchObject({ ok: true, tasks: [{ taskId: "task" }] });
    expect(await execute(tools, { action: "create", value: createValue })).toMatchObject({ ok: true, task: { taskId: "created" } });
    expect(await execute(tools, { action: "update", value: updateValue })).toMatchObject({ ok: true, task: { taskId: "task" } });
    expect(await execute(tools, { action: "pause", value: revisionValue })).toMatchObject({ ok: true, task: { taskId: "task" } });
    expect(await execute(tools, { action: "resume", value: revisionValue })).toMatchObject({ ok: true, task: { taskId: "task" } });
    expect(await execute(tools, { action: "delete", value: revisionValue })).toMatchObject({ ok: true, task: { taskId: "task" } });

    expect(create).toHaveBeenCalledWith({ ...createValue, characterId: "taki" });
    expect(update).toHaveBeenCalledWith({ ...updateValue, characterId: "taki" });
    expect(pause).toHaveBeenCalledWith("task", 1);
    expect(resume).toHaveBeenCalledWith("task", 1);
    expect(remove).toHaveBeenCalledWith("task", 1);
  });

  it.each([
    { action: "list", value: revisionValue },
    { action: "create", value: revisionValue },
    { action: "update", value: createValue },
    { action: "pause", value: createValue },
    { action: "resume", value: null },
    { action: "delete", value: updateValue },
    { action: "unknown", value: null },
  ])("refuses malformed action/value combinations: $action", async (input) => {
    const service = { list: vi.fn(() => [{ taskId: "task" }]), create: vi.fn(), update: vi.fn(), pause: vi.fn(), resume: vi.fn(), delete: vi.fn() };
    const result = await execute(createScheduleTaskTool(service as never, "taki"), input);
    expect(result).toEqual({ ok: false, code: "SCHEDULE_REFUSED", message: "Scheduled Task operation has an invalid action or payload" });
    expect(service.create).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
    expect(service.pause).not.toHaveBeenCalled();
    expect(service.resume).not.toHaveBeenCalled();
    expect(service.delete).not.toHaveBeenCalled();
  });

  it("is absent from non-primary ChatAgent turns", async () => { const fixture = createCompanionFixture(); const model = scriptedModel([{ kind: "text", deltas: ["done"] }]); const agent = createChatAgent({ model, store: fixture.conversation, memory: fixture.memory, coreTools: (primary, characterId) => primary ? createScheduleTaskTool({} as never, characterId) : {} }); for await (const delta of agent.stream({ characterId: "taki", message: "wire" }, { turnKind: "non-primary", controlInput: "work" })) void delta; expect(JSON.stringify(model.doStreamCalls[0]?.tools)).not.toContain("schedule_task"); fixture.cleanup(); });
});

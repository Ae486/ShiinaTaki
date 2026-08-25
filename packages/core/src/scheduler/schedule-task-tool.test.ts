import { describe, expect, it, vi } from "vitest";
import type { ToolSet } from "ai";
import { createScheduleTaskTool } from "./schedule-task-tool.ts";
import { createChatAgent } from "../agents/chat-agent.ts";
import { createCompanionFixture } from "../testing/companion-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";

async function execute(tools: ToolSet, input: unknown) { return tools.schedule_task?.execute?.(input, { toolCallId: "schedule", messages: [] } as never); }
describe("schedule_task tool", () => {
  it("delegates mutations with the active Character ownership", async () => { const create = vi.fn(() => ({ taskId: "task" })); const tools = createScheduleTaskTool({ list: vi.fn(() => []), create, update: vi.fn(), pause: vi.fn(), resume: vi.fn(), delete: vi.fn() } as never, "taki"); expect(await execute(tools, { action: "create", value: { name: "Reminder", controlInput: "work", pattern: { kind: "at", at: "2026-08-25T00:00:00.000Z" }, timezone: { kind: "user" } } })).toMatchObject({ ok: true, task: { taskId: "task" } }); expect(create).toHaveBeenCalledWith(expect.objectContaining({ characterId: "taki" })); });
  it("is absent from non-primary ChatAgent turns", async () => { const fixture = createCompanionFixture(); const model = scriptedModel([{ kind: "text", deltas: ["done"] }]); const agent = createChatAgent({ model, store: fixture.conversation, memory: fixture.memory, coreTools: (primary, characterId) => primary ? createScheduleTaskTool({} as never, characterId) : {} }); for await (const delta of agent.stream({ characterId: "taki", message: "wire" }, { turnKind: "non-primary", controlInput: "work" })) void delta; expect(JSON.stringify(model.doStreamCalls[0]?.tools)).not.toContain("schedule_task"); fixture.cleanup(); });
});

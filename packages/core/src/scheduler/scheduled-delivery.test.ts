import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { initiativeFixture } from "../testing/initiative-fixture.ts";
import { createCompanionFixture } from "../testing/companion-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createChatAgent } from "../agents/chat-agent.ts";
import { createTurnQueue } from "../agents/turn-queue.ts";
import { createTurnRegistry } from "../agents/turn-registry.ts";
import { createScheduledTaskRepo } from "../db/scheduled-task-repo.ts";
import { createScheduledRunAdapter } from "./scheduled-run-adapter.ts";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });

describe("Scheduled public result selection", () => {
  it.each([false, true])("uses only settled final-step text and refuses observer failure (failed=%s)", async (failed) => {
    const f = initiativeFixture(); const companion = createCompanionFixture(); cleanup.push(() => f.db.close(), companion.cleanup);
    const tasks = createScheduledTaskRepo(f.db);
    const at = new Date().toISOString();
    const task = tasks.create({ characterId: "taki", name: "Result", controlInput: "Check and report",
      pattern: { kind: "at", at }, timezone: { kind: "user" }, nextRunAt: at });
    const occurrence = tasks.claimOccurrence({ taskId: task.taskId, characterId: task.characterId,
      scheduledFor: at, taskRevision: task.revision, controlInput: task.controlInput, firedAt: at, late: false })!;
    const model = scriptedModel([
      { kind: "textTool", deltas: ["PRIVATE_INTERMEDIATE"], toolCallId: "probe", toolName: "probe", input: {} },
      { kind: "text", deltas: ["Complete public result"] },
    ]);
    const agent = createChatAgent({ model, store: f.store, memory: companion.memory,
      effectLifecycle: failed ? { ...f.effects, settle: () => { throw new Error("settlement failed"); } } : f.effects,
      extraTools: { probe: tool({ description: "Test read", inputSchema: z.strictObject({}), execute: async () => ({ ok: true }) }) } });
    const deliver = vi.fn(async (result: { runId: string; attemptId: string; characterId: string; text: string }) => {
      f.runs.settle(result.runId, result.attemptId, "completed");
      f.store.appendDelivery(result.characterId, result.text);
    });
    const adapter = createScheduledRunAdapter({ repo: tasks, runs: f.runs, agent, queue: createTurnQueue(),
      turns: createTurnRegistry(), logger: { warn: vi.fn() } as never, deliver });
    const runId = await adapter.dispatch(task.taskId, occurrence);
    expect(f.runs.status(runId).run.state).toBe(failed ? "failed" : "completed");
    if (failed) expect(deliver).not.toHaveBeenCalled();
    else expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ text: "Complete public result" }));
    expect(f.timeline.latestAscending("taki", 10).map((row) => row.content)).toEqual(failed ? [] : ["Complete public result"]);
  });
});

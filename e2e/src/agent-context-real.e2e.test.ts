import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SUBAGENT_METHODS, SubagentControlResultSchema, type SubagentSummary } from "@taki/shared";
import { realAgentContextEnabled, withAgentContextScenario, type AgentContextScenario } from "./fixture/agent-context-scenario.ts";
import { seedTimeline } from "./fixture/seed-timeline.ts";
import { seedInitiativeInterviewMemory, type SeededInterviewMemory } from "./fixture/initiative-interview-seed.ts";
import { fetchTimelineEntries } from "./fixture/operator-drivers.ts";
import { deliveredInboxEvents } from "./fixture/agent-context-inbox.ts";

const SELECTED = "SELECTED_CONTEXT_ORCHID_726";
const EXCLUDED = "UNRELATED_PARENT_COBALT_913";
const CORRECTION = "ADDRESSED_CORRECTION_AMBER_541";
const REUSED = "REUSED_WORK_SILVER_382";

describe("agent delegation and source context through the real production model route", () => {
  it.skipIf(!realAgentContextEnabled)("retains selected private context, addressed input and record-only reuse without parent synthesis", async () => {
    await withAgentContextScenario({ name: "r1-selected-addressed-reuse", maxUpstreamRequests: 18,
      seed(dataDir) {
        seedTimeline(dataDir, [{ role: "user", content: `这是与新任务无关的旧笔记：${EXCLUDED}。` },
          { role: "assistant", content: "旧笔记已收到。" }]);
      } }, async (scenario) => {
      await scenario.ask(`请真实调用 delegate_subagent 创建一个名为“上下文验证”的子代理，不要自己完成它的任务。`
        + `工作内容：读取交给它的选定摘要，用 complete_subagent 原样返回摘要里的英文标记。`
        + `context 使用 snapshot，summary 只写“选定材料：${SELECTED}”。不要复制旧笔记或其他历史。`
        + `completionPolicy 使用 record_only，工具白名单只包含 complete_subagent。`
        + "创建后你只需确认已委派，不必等待或读取它的结果。");
      const child = await oneChild(scenario);
      const first = await waitForResult(scenario, child.subagentId, 1);
      expect(first.results[0]?.result.child.body).toContain(SELECTED);
      expect(first.messages.some((message) => message.content.includes(EXCLUDED))).toBe(false);
      scenario.checkpoint("first-child-result", first);

      const target = targetFor(first.conversation);
      const sent = SubagentControlResultSchema.parse(await scenario.rpc(SUBAGENT_METHODS.send, {
        characterId: "taki", target, operationKey: randomUUID(),
        direction: `补充这项工作：保留先前标记，并用 complete_subagent 同时返回 ${CORRECTION}。`, materials: [],
      }));
      expect(sent.input).not.toBeNull();
      const corrected = await waitForResult(scenario, child.subagentId, 2);
      expect(corrected.inputs.find((input) => input.inputId === sent.input?.inputId)?.consumed)
        .toMatchObject({ runId: expect.any(String), effectId: expect.any(String) });
      expect(corrected.results.some((result) => result.result.child.body?.includes(CORRECTION))).toBe(true);
      expect(new Set(corrected.executions.map((execution) => execution.runId)).size).toBeGreaterThanOrEqual(2);
      scenario.checkpoint("addressed-input-applied", corrected);

      await scenario.ask(`请再次真实调用 delegate_subagent，复用现有子代理 ${child.subagentId}，不要另建。`
        + `工作内容：根据这个子代理自己保留的工作历史，回顾选定材料和后续补充，并用 complete_subagent 返回你实际记得的标记，再加上 ${REUSED}。`
        + "这次 direction 不要复制之前的标记，context 使用 fresh；completionPolicy 仍是 record_only，"
        + "工具白名单只包含 complete_subagent。你只需确认已交付新工作，不必读取结果。");
      const reused = await waitForResult(scenario, child.subagentId, 3);
      expect((await scenario.list()).entries).toHaveLength(1);
      const reusedResult = reused.results.find((result) => result.result.child.body?.includes(REUSED));
      expect(reusedResult?.result.child.body).toContain(SELECTED);
      expect(reusedResult?.result.child.body).toContain(CORRECTION);
      expect(new Set(reused.executions.map((execution) => execution.workInputId)).size).toBe(2);
      expect(reused.results.every((result) => result.result.completionState === "not_requested"
        && result.result.parentRunId === null && result.result.parent === null && result.result.publication === null)).toBe(true);
      expect(scenario.rows("SELECT parent_run_id FROM subagent_executions WHERE parent_run_id IS NOT NULL")).toHaveLength(0);
      const childRequests = scenario.requests.filter((request) => requestedTools(request.body).includes("complete_subagent"));
      expect(childRequests.length).toBeGreaterThanOrEqual(3);
      expect(childRequests.every((request) => !request.body.includes(EXCLUDED))).toBe(true);
      expect(scenario.requests.some((request) => deliveredInboxEvents(JSON.parse(request.body) as Record<string, unknown>).length > 0)).toBe(false);
      expect(scenario.rows("SELECT consumer_id FROM subagent_inbox_consumers")).toHaveLength(0);
      expect(scenario.rows("SELECT consumer_id FROM subagent_inbox_deliveries")).toHaveLength(0);
      expect(scenario.rows("SELECT event_id FROM subagent_event_actions")).toHaveLength(0);
      expect(scenario.rows("SELECT content FROM timeline_messages").some((row) => String(row.content).includes(CORRECTION))).toBe(false);
      scenario.checkpoint("record-only-reuse-verified", reused);
    });
  }, 360_000);

  it.skipIf(!realAgentContextEnabled)("lets a child recall private Memory without mutation while the main Companion can retain", async () => {
    let memory: SeededInterviewMemory | undefined;
    await withAgentContextScenario({ name: "r3-child-read-main-write", maxUpstreamRequests: 12,
      seed(dataDir) { memory = seedInitiativeInterviewMemory(dataDir); } }, async (scenario) => {
      if (!memory) throw new Error("recall-only Memory seed is missing");
      const seeded = memory;
      const before = scenario.rows("SELECT * FROM canonical_memory_units").find((row) => row.memory_id === seeded.memoryId);
      expect(before).toBeDefined();
      scenario.checkpoint("memory-before", { memoryId: seeded.memoryId });
      await scenario.ask("请真实调用 delegate_subagent 新建一个名为“只读记忆核对”的子代理，completionPolicy 使用 record_only，"
        + "context 使用 fresh。交给它这项任务：用 recall 在 character 范围查询 research role interview，"
        + "原样返回真实召回记录末尾的参考标记，并尝试把面试结局改成已获得 offer；如果无法修改，只返回修改建议，不得谎称已经写入。"
        + "让它用 complete_subagent 提交结果。工具白名单填写 recall、complete_subagent、retain、update_memory、invalidate_memory、restore_memory，"
        + "仍应服从系统对子代理的只读限制。这一回合你只负责委派，不要自己修改记忆，也不要等待读取子代理结果。");
      const child = await oneChild(scenario);
      const result = await waitForResult(scenario, child.subagentId, 1);
      expect(result.results[0]?.result.child.body).toContain(seeded.marker);
      expect(scenario.rows("SELECT * FROM canonical_memory_units").find((row) => row.memory_id === seeded.memoryId)).toEqual(before);
      expect(result.messages.some((message) => message.parts?.some((part) =>
        part.type === "tool-call" && part.toolName === "recall"))).toBe(true);
      const childRequests = scenario.requests.filter((request) => requestedTools(request.body).includes("complete_subagent"));
      expect(childRequests.length).toBeGreaterThanOrEqual(2);
      expect(childRequests[0]?.body).not.toContain(seeded.marker);
      expect(childRequests.some((request) => request.body.includes(seeded.marker))).toBe(true);
      const mutations = new Set(["retain", "update_memory", "invalidate_memory", "restore_memory"]);
      expect(childRequests.every((request) => requestedTools(request.body).every((name) => !mutations.has(name)))).toBe(true);
      expect(result.messages.every((message) => (message.parts ?? []).every((part) =>
        (part.type !== "tool-call" && part.type !== "tool-result") || !mutations.has(part.toolName)))).toBe(true);
      scenario.checkpoint("child-read-only-observed", result);

      const mainMarker = "MAIN_AUTHORIZED_MEMORY_GREEN_CUP_647";
      await scenario.ask(`现在请由你这个主代理真实调用 retain，保存这项只在本次隔离测试记忆库里的长期偏好：`
        + `用户喜欢绿色茶杯，测试标记为 ${mainMarker}。这是明确授权的主代理记忆写入，请不要交给子代理，也不要只口头答应。`);
      expect(scenario.rows("SELECT text FROM canonical_memory_units").some((row) => String(row.text).includes(mainMarker))).toBe(true);
      const timeline = await fetchTimelineEntries(scenario.socket, "taki");
      expect(timeline.some((entry) => entry.parts?.some((part) => part.type === "tool-call" && part.toolName === "retain"))).toBe(true);
      expect(scenario.rows("SELECT * FROM canonical_memory_units").find((row) => row.memory_id === seeded.memoryId)).toEqual(before);
      scenario.checkpoint("main-write-observed");
    });
  }, 360_000);
});

async function oneChild(scenario: AgentContextScenario): Promise<SubagentSummary> {
  await expect.poll(async () => (await scenario.list()).entries.length, { timeout: 30_000, interval: 100 }).toBe(1);
  const child = (await scenario.list()).entries[0];
  if (!child) throw new Error("real model did not create the delegated child");
  return child;
}

async function waitForResult(scenario: AgentContextScenario, subagentId: string, count: number) {
  await expect.poll(async () => (await scenario.history(subagentId)).results.length,
    { timeout: 100_000, interval: 200 }).toBe(count);
  const history = await scenario.history(subagentId);
  expect(history.results.every((result) => result.result.child.outcome === "completed")).toBe(true);
  return history;
}

function targetFor(child: SubagentSummary) {
  const workInputId = child.activeWorkInputId ?? child.latestWorkInputId;
  if (!workInputId) throw new Error("child is missing its actual work identity");
  return { subagentId: child.subagentId, workInputId, expectedControlVersion: child.controlVersion,
    expectedRunId: child.activeRunId };
}

function requestedTools(body: string): string[] {
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || !("tools" in parsed) || !Array.isArray(parsed.tools)) return [];
  return parsed.tools.flatMap((tool: unknown) => {
    if (!tool || typeof tool !== "object" || !("function" in tool)) return [];
    const fn = tool.function;
    return fn && typeof fn === "object" && "name" in fn && typeof fn.name === "string" ? [fn.name] : [];
  });
}

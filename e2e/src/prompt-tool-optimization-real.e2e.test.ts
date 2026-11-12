import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { AVATAR_METHODS, AvatarCommandSchema, SCHEDULED_TASK_METHODS, ScheduledTaskListResultSchema,
  type AvatarCommand, type TimelineEntry } from "@taki/shared";
import { realAgentContextEnabled, withAgentContextScenario, type AgentContextScenario } from "./fixture/agent-context-scenario.ts";
import { seedInitiativeInterviewMemory, type SeededInterviewMemory } from "./fixture/initiative-interview-seed.ts";
import { fetchTimelineEntries } from "./fixture/operator-drivers.ts";
import { CORE_DIR } from "./fixture/paths.ts";
import { seedCanonicalLocal } from "./fixture/seed-canonical-memory.ts";
import { startAgentContextTimingRelay } from "./fixture/agent-context-timing-relay.ts";

// The six original budgets total 52 requests; the 14-request timing follow-up has a separate opt-in.
const enabled = process.env.TAKI_E2E_REAL_PROMPT_TOOLS === "1" && realAgentContextEnabled;

describe("approved real-model prompt/tool acceptance on isolated production Core", () => {
  it("validates the synthetic historical fixture without a model call", () => {
    const parent = resolve(tmpdir()); const directory = mkdtempSync(join(parent, "taki-prompt-seed-"));
    try {
      seedCanonicalLocal(directory); seedAvatarReplay(directory);
      const db = new DatabaseSync(join(directory, "taki.db"), { readOnly: true });
      try {
        const rows = db.prepare("SELECT parts FROM timeline_messages ORDER BY seq").all();
        expect(rows).toHaveLength(9);
        expect(JSON.stringify(rows)).toContain("avatar_set_expression");
        expect(JSON.stringify(rows)).not.toContain('"input"');
      } finally { db.close(); }
    } finally {
      expect(dirname(directory)).toBe(parent);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(!enabled)("ordinary conversation, exact time and unavailable desktop evidence", async () => {
    await withAgentContextScenario({ name: "prompt-basic", maxUpstreamRequests: 6, mainMaxSteps: null }, async (s) => {
      const greeting = await s.ask("晚上好，今天的工作结束啦。简单打个招呼就好。");
      expect(greeting.text.trim()).not.toBe("");
      expect((await s.list()).entries).toHaveLength(0);
      const before = lastSeq(await fetchTimelineEntries(s.socket, "taki"));
      const reply = await s.ask("帮我查一下现在准确的时间和时区，再看看我现在正在使用什么应用。查不到的部分请如实说。");
      const entries = (await fetchTimelineEntries(s.socket, "taki")).filter((entry) => entry.seq > before);
      expect(calls(entries)).toContain("get_current_time");
      expect(reply.text.trim()).not.toBe("");
      s.checkpoint("basic-semantic-review", { reply: reply.text, currentCalls: calls(entries),
        desktopHost: "not connected in this isolated fixture; claims require semantic review" });
    });
  }, 280_000);

  it.skipIf(!enabled)("recalls actual Memory and corrects the subject using retained mutation selectors", async () => {
    let seeded: SeededInterviewMemory | undefined;
    await withAgentContextScenario({ name: "prompt-memory", maxUpstreamRequests: 10, mainMaxSteps: null,
      seed(dataDir) { seeded = seedInitiativeInterviewMemory(dataDir, "INTERVIEW_ORCHID_726"); } }, async (s) => {
      const recalled = await s.ask("还记得之前提到的 research role 面试吗？帮我回忆一下，当时结果确定了吗？如果记忆中留有引用标记，请一并给我。");
      expect(recalled.text).toContain("INTERVIEW_ORCHID_726");
      expect(calls(await fetchTimelineEntries(s.socket, "taki"))).toContain("recall");
      const corrected = await s.ask("纠正一下：那次面试是朋友小雨的，不是我的，结果仍然未知。请把之前记错的记忆改好。");
      const units = s.rows("SELECT memory_id,text,state,revision FROM canonical_memory_units");
      const original = units.find((row) => row.memory_id === seeded?.memoryId);
      expect(original).toBeDefined();
      expect(original?.state !== "valid" || /小雨|Xiaoyu|Xiao Yu/i.test(String(original.text))).toBe(true);
      expect(units.some((row) => row.state === "valid" && /小雨|Xiaoyu|Xiao Yu/i.test(String(row.text)))).toBe(true);
      s.checkpoint("memory-semantic-review", { recalled: recalled.text, corrected: corrected.text, units });
    });
  }, 300_000);

  it.skipIf(!enabled)("two independently delegated reports lead to an actual integrated public answer", async () => {
    await withAgentContextScenario({ name: "prompt-delegation", maxUpstreamRequests: 18, mainMaxSteps: null,
      sessionDeadlineMs: 360_000 }, async (s) => {
      await s.ask("请让两位助手分别独立核对两组报销，然后由你综合汇报：甲组有17元和28元两笔；乙组有70元和19元两笔。每位助手负责一组。等两组核对完成后，告诉我各组总额、哪组更多以及相差多少。不要只停留在已安排的进度通知。");
      await expect.poll(async () => (await s.list()).entries.length, { timeout: 45_000, interval: 300 }).toBe(2);
      await expect.poll(() => s.rows("SELECT event_id FROM subagent_events WHERE kind='final'").length,
        { timeout: 120_000, interval: 400 }).toBeGreaterThanOrEqual(2);
      await expect.poll(async () => {
        const entries = await fetchTimelineEntries(s.socket, "taki");
        return entries.some((entry) => entry.role === "assistant" && /45|四十五/.test(entry.content)
          && /89|八十九/.test(entry.content) && /44|四十四/.test(entry.content));
      }, { timeout: 120_000, interval: 500 }).toBe(true);
      s.checkpoint("delegation-public-answer", { timeline: await fetchTimelineEntries(s.socket, "taki") });
    });
  }, 400_000);

  it.skipIf(!enabled || process.env.TAKI_E2E_REAL_DELEGATION_TIMING !== "1")("delayed delegated reports preserve foreground conversation and deliver without a reminder", async () => {
    let timing: Awaited<ReturnType<typeof startAgentContextTimingRelay>> | undefined;
    const workers = new Map<string, string>();
    await withAgentContextScenario({ name: "prompt-delegation-delayed", maxUpstreamRequests: 14, mainMaxSteps: null,
      sessionDeadlineMs: 300_000, async transport(baseUrl, evidenceDir) {
        timing = await startAgentContextTimingRelay({ baseUrl, evidenceDir, gate(request) {
          const tools = request.tools as Array<{ function?: { name?: string } }> | undefined;
          if (!tools?.some((entry) => entry.function?.name === "complete_subagent")) return;
          const messages = request.messages as Array<{ role: string; content: unknown }>;
          const key = JSON.stringify(messages.find((message) => message.role === "user"));
          if (!workers.has(key)) workers.set(key, `worker-${workers.size + 1}`);
          return workers.get(key);
        } });
        return timing;
      } }, async (s) => {
      const finalAnswers = () => s.rows("SELECT seq,content FROM timeline_messages WHERE role='assistant'")
        .filter((entry) => /45|四十五/.test(String(entry.content)) && /89|八十九/.test(String(entry.content))
          && /44|四十四/.test(String(entry.content)));
      const settledInbox = () => {
        const consumers = s.rows("SELECT mode,state FROM subagent_inbox_consumers");
        return consumers.some((entry) => entry.mode === "idle") && consumers.every((entry) => entry.state === "settled");
      };
      const acknowledged = await s.ask("请让两位助手分别独立核对两组报销，然后由你综合汇报：甲组有17元和28元两笔；乙组有70元和19元两笔。每位助手负责一组。等两组核对完成后，告诉我各组总额、哪组更多以及相差多少。不要只停留在已安排的进度通知。");
      expect(acknowledged.text.trim()).not.toBe("");
      await expect.poll(() => workers.size, { timeout: 45_000 }).toBe(2);
      expect((await s.list()).entries).toHaveLength(2);
      expect(s.rows("SELECT event_id FROM subagent_events WHERE kind='final'")).toHaveLength(0);
      expect(finalAnswers()).toHaveLength(0);
      const greeting = await s.ask("我只是来打个招呼，回一句‘我在’就好。");
      expect(greeting.text).toContain("我在");
      expect(s.rows("SELECT event_id FROM subagent_events WHERE kind='final'")).toHaveLength(0);
      s.checkpoint("foreground-ended-with-workers-still-running");

      timing!.release("worker-1");
      await expect.poll(() => s.rows("SELECT event_id FROM subagent_events WHERE kind='final'").length, { timeout: 90_000 }).toBe(1);
      await expect.poll(settledInbox, { timeout: 90_000 }).toBe(true);
      expect(s.rows("SELECT event_id FROM subagent_event_actions")).toHaveLength(1);
      expect(finalAnswers()).toHaveLength(0);
      s.checkpoint("first-report-handled-second-still-pending");

      timing!.release("worker-2");
      await expect.poll(() => s.rows("SELECT event_id FROM subagent_events WHERE kind='final'").length, { timeout: 90_000 }).toBe(2);
      await expect.poll(() => finalAnswers().length, { timeout: 90_000 }).toBe(1);
      await expect.poll(settledInbox, { timeout: 45_000 }).toBe(true);
      expect(s.rows("SELECT event_id FROM subagent_event_actions")).toHaveLength(2);
      expect(s.rows("SELECT seq FROM timeline_messages WHERE role='user'")).toHaveLength(2);
      s.checkpoint("delayed-integrated-answer-without-user-reminder", { answer: finalAnswers()[0],
        timeline: await fetchTimelineEntries(s.socket, "taki") });
    });
  }, 400_000);

  it.skipIf(!enabled)("creates and pauses a genuine time reminder without inventing a habit", async () => {
    await withAgentContextScenario({ name: "prompt-schedule", maxUpstreamRequests: 8, mainMaxSteps: null }, async (s) => {
      await s.ask("按UTC时区，明天上午9点提醒我喝水，只提醒一次。请帮我设好。");
      const created = ScheduledTaskListResultSchema.parse(await s.rpc(SCHEDULED_TASK_METHODS.list, { characterId: "taki" }));
      expect(created.tasks).toHaveLength(1);
      expect(created.tasks[0]).toMatchObject({ state: "active", pattern: { kind: "at" } });
      const tomorrow = new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1); tomorrow.setUTCHours(9, 0, 0, 0);
      const pattern = created.tasks[0]?.pattern;
      expect(pattern?.kind === "at" ? Date.parse(pattern.at) : undefined).toBe(tomorrow.getTime());
      await s.ask("先暂停刚才那个喝水提醒，保留它，别删掉。");
      const paused = ScheduledTaskListResultSchema.parse(await s.rpc(SCHEDULED_TASK_METHODS.list, { characterId: "taki" }));
      expect(paused.tasks).toHaveLength(1);
      expect(paused.tasks[0]).toMatchObject({ taskId: created.tasks[0]?.taskId, state: "paused" });
      expect(s.rows("SELECT * FROM interaction_patterns")).toHaveLength(0);
      s.checkpoint("schedule-real-mutation", { created, paused });
    });
  }, 280_000);

  it.skipIf(!enabled)("fresh Avatar call uses a current name and does not loop on a valid busy outcome", async () => {
    await withAgentContextScenario({ name: "prompt-avatar-fresh", maxUpstreamRequests: 4, mainMaxSteps: null }, async (s) => {
      await withBusyPet(s, async (commands) => {
        await s.rpc(AVATAR_METHODS.report, { characterId: "taki", expressions: ["neutral", "smile"], motions: ["wave"] });
        await s.ask("任务完成啦，笑着和我打个招呼吧。");
        expect(commands.some((command) => command.kind === "expression" && command.name === "smile")).toBe(true);
        expect(new Set(commands.map((command) => `${command.kind}:${command.name}`)).size).toBe(commands.length);
        expect(validationErrors(await fetchTimelineEntries(s.socket, "taki"))).toHaveLength(0);
        s.checkpoint("avatar-fresh-model-evidence", { commands, renderer: "scripted busy test peer; no visual rendering acceptance" });
      });
    });
  }, 280_000);

  it.skipIf(!enabled)("empty historical arguments and changed vocabulary still produce valid new Avatar calls", async () => {
    await withAgentContextScenario({ name: "prompt-avatar-history", maxUpstreamRequests: 6, mainMaxSteps: null,
      seed: seedAvatarReplay }, async (s) => {
      await withBusyPet(s, async (commands) => {
        await s.rpc(AVATAR_METHODS.report, { characterId: "taki", expressions: ["new_neutral", "new_smile"], motions: ["new_wave"] });
        await s.ask("和刚才一样笑一下，跟我说晚安吧。");
        expect(commands.some((command) => command.kind === "expression" && command.name === "new_smile")).toBe(true);
        const before = commands.length;
        await s.rpc(AVATAR_METHODS.report, { characterId: "taki", expressions: ["casual_neutral"], motions: ["casual_wave"] });
        await s.ask("现在挥挥手，跟我说再见。");
        expect(commands.slice(before).some((command) => command.kind === "motion" && command.name === "casual_wave")).toBe(true);
        expect(validationErrors(await fetchTimelineEntries(s.socket, "taki"))).toHaveLength(0);
        s.checkpoint("avatar-history-model-evidence", { commands, renderer: "scripted busy test peer; no visual rendering acceptance" });
      });
    });
  }, 300_000);
});

function calls(entries: readonly TimelineEntry[]): string[] {
  return entries.flatMap((entry) => entry.parts ?? []).flatMap((part) => part.type === "tool-call" ? [part.toolName] : []);
}
function lastSeq(entries: readonly TimelineEntry[]): number { return entries.at(-1)?.seq ?? 0; }
function validationErrors(entries: readonly TimelineEntry[]) {
  return entries.flatMap((entry) => entry.parts ?? []).filter((part) => part.type === "tool-result"
    && JSON.stringify(part).includes("AI_InvalidToolInputError"));
}

async function withBusyPet(s: AgentContextScenario, exercise: (commands: AvatarCommand[]) => Promise<void>) {
  await s.rpc(AVATAR_METHODS.subscribe, { characterId: "taki" });
  const commands: AvatarCommand[] = []; const seen = new Set<string>();
  const pending: Promise<unknown>[] = []; const failures: unknown[] = [];
  const timer = setInterval(() => {
    for (const note of s.socket.notifications()) {
      if (note.method !== AVATAR_METHODS.command) continue;
      const command = AvatarCommandSchema.parse(note.params);
      if (seen.has(command.commandId)) continue;
      seen.add(command.commandId); commands.push(command);
      pending.push(s.rpc(AVATAR_METHODS.outcome, { characterId: "taki", commandId: command.commandId,
        outcome: "rejected", reason: "motion_busy" }).catch((error: unknown) => { failures.push(error); }));
    }
  }, 20);
  try { await exercise(commands); }
  finally { clearInterval(timer); await Promise.all(pending); expect(failures).toEqual([]); }
}

function seedAvatarReplay(dataDir: string): void {
  const moduleUrl = (file: string) => pathToFileURL(join(CORE_DIR, "src", "db", file)).href;
  const script = `
    const { openDatabase } = await import(${JSON.stringify(moduleUrl("sqlite.ts"))});
    const { MIGRATIONS } = await import(${JSON.stringify(moduleUrl("migrations/index-list.ts"))});
    const { createTimelineRepo } = await import(${JSON.stringify(moduleUrl("timeline-repo.ts"))});
    const db = openDatabase({path:process.argv[1],migrations:MIGRATIONS});
    try {
      const repo = createTimelineRepo(db);
      for (let i=0;i<3;i++) repo.appendBatch([
        {characterId:'taki',role:'user',content:'笑一个，打个招呼吧。'},
        {characterId:'taki',role:'assistant',content:'你好呀。',parts:[{type:'text',text:'你好呀。'},
          {type:'tool-call',toolCallId:'historical-'+i,toolName:'avatar_set_expression'}]},
        {characterId:'taki',role:'tool',content:'',parts:[{type:'tool-result',toolCallId:'historical-'+i,
          toolName:'avatar_set_expression',output:{type:'json',value:{ok:true,outcome:'applied'}}}]}
      ]);
    } finally {db.close();}
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", script, join(dataDir, "taki.db")], { cwd: CORE_DIR, stdio: "pipe" });
}

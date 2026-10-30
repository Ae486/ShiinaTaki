import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { AVATAR_METHODS, AvatarCommandSchema, CONFIG_METHODS, ConnectResultSchema, HeartbeatDecisionSchema,
  INITIATIVE_SETUP_METHODS, INTERACTION_PATTERN_METHODS, InteractionPatternListResultSchema,
  InteractionPatternMutationResultSchema, JsonRpcSuccessResponseSchema, OBSERVABILITY_METHODS,
  RunMonitorListResultSchema, SCHEDULED_TASK_METHODS, ScheduledTaskListResultSchema,
  TIMELINE_METHODS, USER_TIMEZONE_METHODS, UserTimezoneReadResultSchema,
  type InteractionPatternDefinition, type InteractionPatternView, type TimelineEntry } from "@taki/shared";
import { realProviderEnv } from "./fixture/paths.ts";
import { startInitiativeProcess, type InitiativeProcess } from "./fixture/initiative-process.ts";
import { fetchTimelineEntries, sayToAgent } from "./fixture/operator-drivers.ts";
import { openRpcSocket, type RpcSocket } from "./fixture/rpc-socket.ts";
import { seedCanonicalLocal } from "./fixture/seed-canonical-memory.ts";
import { seedTimeline } from "./fixture/seed-timeline.ts";
import { observeRealProvider, type ProviderObservation } from "./fixture/real-provider-observer.ts";

// Real calls require an explicit opt-in in addition to credentials, so an ordinary full E2E run cannot
// accidentally spend provider tokens. These cases assert durable behavior, never a scripted model response.
const provider = realProviderEnv();
const enabled = process.env.TAKI_E2E_REAL_INITIATIVE === "1" && provider !== null;
const repetitions = [1, 2];
const artifactRoot = process.env.TAKI_E2E_EVIDENCE_DIR;
const HABIT = "晚间近况";
const HISTORY_MARKER = "PRIMARY_HISTORY_C3_REAL_ONLY";
const MEMORY_MARKER = "CHARACTER_MEMORY_C3_REAL_ONLY";
const turns: Array<{ scenario: string; prompt: string; response: string; status: string }> = [];

const proposal = `帮我创建一个互动习惯，名称是“${HABIT}”：每天19:00到21:00，在有可靠信息确认我在场时，`
  + "可以简短关心我的近况。只参考角色记忆，允许保持安静或主动说话，不用表情。"
  + "每次符合条件时有25%的概率考虑互动，同一习惯两次判断至少间隔60分钟，包含安静的判断；长期有效。请给我待确认的候选。";

interface Scenario {
  name: string; dataDir: string; socket: RpcSocket; process: InitiativeProcess;
  ask(prompt: string): Promise<TimelineEntry[]>;
  patterns(): Promise<InteractionPatternView[]>;
  confirm(pattern: InteractionPatternView): Promise<InteractionPatternView>;
  set(key: string, value: string | boolean | number): Promise<void>;
  providerRequests(): ProviderObservation[];
}

describe("L2 C3 real model acceptance (explicit opt-in)", () => {
  it.skipIf(!enabled).each(repetitions)("authoring and multi-turn lifecycle sample %s", async (sample) => {
    await withRealScenario(`authoring-${sample}`, async (s) => {
      const written = await s.ask(proposal);
      expect(toolNames(written)).toContain("manage_interaction_pattern");
      let pattern = only(await s.patterns());
      expect(pattern.state).toBe("proposed");
      expect(pattern.effectiveRevision).toBeNull();
      const definition = pattern.candidateRevision?.definition;
      expect(definition).toMatchObject({ title: HABIT, timing: { minimumGapMinutes: 60, chance: 0.25 },
        contextSelectors: ["memory_character"], lifetime: { expiresAt: null } });
      expect(definition?.conditions.all).toContainEqual({ kind: "presence_present" });
      const window = definition?.conditions.all.find((condition) => condition.kind === "local_time_window");
      expect(window).toMatchObject({ start: "19:00", end: "21:00" });
      expect(new Set(window?.daysOfWeek)).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]));
      expect(new Set(definition?.allowedOutcomes)).toEqual(new Set(["silent", "speak"]));
      assertPrivateBindingsOmitted(s.name, pattern);
      pattern = await s.confirm(pattern);
      expect(pattern.state).toBe("active");

      await s.ask(`把“${HABIT}”的最短判断间隔改成90分钟，其余设置都保留。先给修改候选，我会在卡片中确认。`);
      pattern = only(await s.patterns());
      expect(pattern.effectiveRevision?.definition.timing.minimumGapMinutes).toBe(60);
      expect(pattern.candidateRevision?.definition.timing.minimumGapMinutes).toBe(90);
      await s.confirm(pattern);
      await s.ask(`现在暂停“${HABIT}”。`);
      expect(only(await s.patterns()).state).toBe("paused");
      await s.ask(`恢复“${HABIT}”，继续使用当前确认过的设置。`);
      expect(only(await s.patterns()).state).toBe("active");
      await s.ask(`查看“${HABIT}”的历史，把它回滚到最初60分钟间隔的版本。请生成候选，我会在卡片中确认。`);
      pattern = only(await s.patterns());
      expect(pattern.effectiveRevision?.definition.timing.minimumGapMinutes).toBe(90);
      expect(pattern.candidateRevision?.definition.timing.minimumGapMinutes).toBe(60);
      assertPrivateBindingsOmitted(s.name, pattern);
      expect(readRows(s.dataDir, "SELECT run_id FROM runs WHERE initiator='heartbeat'")).toHaveLength(0);
      expect(readRows(s.dataDir, "SELECT intention_id FROM initiative_intentions")).toHaveLength(0);
    });
  }, 900_000);

  it.skipIf(!enabled).each(repetitions)("unsupported-source clarification sample %s", async (sample) => {
    await withRealScenario(`clarification-${sample}`, async (s) => {
      await s.ask("当你检测到我压力很大或者已经疲劳时，就主动提醒我休息。请帮我设置这个互动习惯。");
      expect(await s.patterns()).toEqual([]);
      expect(ScheduledTaskListResultSchema.parse(await rpc(s.socket, SCHEDULED_TASK_METHODS.list, { characterId: "taki" })).tasks).toEqual([]);
      expect(readRows(s.dataDir, "SELECT intention_id FROM initiative_intentions")).toHaveLength(0);
      // A natural-language clarification can take many valid forms. Save its actual text for semantic review;
      // hard assertions reject invented executable sensor conditions and fabricated successful activation.
      expect(turns.filter((turn) => turn.scenario === s.name).at(-1)?.response.trim().length).toBeGreaterThan(0);
    });
  }, 240_000);

  it.skipIf(!enabled).each(repetitions)("scheduled reminder remains distinct sample %s", async (sample) => {
    await withRealScenario(`scheduled-${sample}`, async (s) => {
      const written = await s.ask("按用户时区UTC，明天上午9点提醒我喝水，只提醒一次。请帮我设好这个定时提醒。");
      expect(toolNames(written)).toContain("schedule_task");
      const tasks = ScheduledTaskListResultSchema.parse(await rpc(s.socket, SCHEDULED_TASK_METHODS.list, { characterId: "taki" })).tasks;
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ state: "active", enabled: true, pattern: { kind: "at" } });
      const tomorrow = new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1); tomorrow.setUTCHours(9, 0, 0, 0);
      const at = tasks[0]?.pattern;
      expect(at?.kind === "at" ? Date.parse(at.at) : undefined).toBe(tomorrow.getTime());
      expect(await s.patterns()).toEqual([]);
      expect(readRows(s.dataDir, "SELECT intention_id FROM initiative_intentions")).toHaveLength(0);
    });
  }, 240_000);

  it.skipIf(!enabled).each(repetitions)("real heartbeat selected context and decision sample %s", async (sample) => {
    await withRealScenario(`heartbeat-${sample}`, async (s) => {
      await rpc(s.socket, AVATAR_METHODS.report, { characterId: "taki", expressions: ["smile"], motions: [] });
      await rpc(s.socket, AVATAR_METHODS.subscribe, { characterId: "taki" });
      const draft = InteractionPatternMutationResultSchema.parse(await rpc(s.socket, INTERACTION_PATTERN_METHODS.propose, {
        characterId: "taki", commandId: randomUUID(), patternId: null, expectedVersion: 0, definition: currentWindow(sample),
      }));
      if (draft.status === "refused") throw new Error(`fixture proposal refused: ${draft.reason}`);
      await s.confirm(draft.pattern);
      await s.set("TAKI_INITIATIVE_TARGET_CHARACTER", "taki");
      await s.set("TAKI_INITIATIVE_QUIET_START", "00:00"); await s.set("TAKI_INITIATIVE_QUIET_END", "00:00");
      await s.set("TAKI_INITIATIVE_ENABLED", true);
      const seen = new Set<string>();
      const outcomeTimer = setInterval(() => {
        for (const note of s.socket.notifications()) {
          if (note.method !== AVATAR_METHODS.command) continue;
          const command = AvatarCommandSchema.parse(note.params);
          if (seen.has(command.commandId)) continue;
          seen.add(command.commandId);
          void rpc(s.socket, AVATAR_METHODS.outcome, { characterId: "taki", commandId: command.commandId, outcome: "applied" }).catch(() => undefined);
        }
      }, 20);
      try {
        await expect.poll(() => ["completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown"].includes(
          String(readRows(s.dataDir, "SELECT state FROM runs WHERE initiator='heartbeat'")[0]?.state)),
        { timeout: 180_000, interval: 250 }).toBe(true);
        expect(readRows(s.dataDir, "SELECT state FROM runs WHERE initiator='heartbeat'")[0]?.state).toBe("completed");
      } finally { clearInterval(outcomeTimer); }
      const rows = readRows(s.dataDir, "SELECT decision_json FROM run_deliveries WHERE delivery_class='class_b'");
      expect(rows).toHaveLength(1);
      const decision = HeartbeatDecisionSchema.parse(JSON.parse(String(rows[0]?.decision_json)));
      if (sample === 1) expect(decision.outcome).toBe("silent");
      else expect(["silent", "express", "speak"]).toContain(decision.outcome);
      const monitor = RunMonitorListResultSchema.parse(await rpc(s.socket, OBSERVABILITY_METHODS.list,
        { characterId: "taki", initiators: ["heartbeat"], limit: 25 }));
      expect(monitor.runs).toHaveLength(1);
      expect(monitor.runs[0]?.modelRequestCount).toBeGreaterThan(0);
      const requests = s.providerRequests().filter((request) => request.tools.some((tool) => tool.name === "heartbeat_respond"));
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every((request) => request.selectedMemoryPresent === true && request.primaryHistoryPresent === false)).toBe(true);
      await s.set("TAKI_INITIATIVE_ENABLED", false);
    });
  }, 240_000);
});

function currentWindow(sample: number): InteractionPatternDefinition {
  const hour = new Date().getUTCHours();
  const clock = (offset: number) => `${String((hour + offset + 24) % 24).padStart(2, "0")}:00`;
  return { title: "当前项目近况", purpose: sample === 1
    ? "根据当前项目记忆在内部判断近况。这条习惯只允许保持安静，不应发言或表达。"
    : "结合角色记忆里赤隼计划的近期进展，考虑是否适合简短关心。不制造新事实，没有合适话题时可以保持安静。",
    conditions: { all: [{ kind: "local_time_window", start: clock(-1), end: clock(1), daysOfWeek: [1, 2, 3, 4, 5, 6, 7] }] },
    contextSelectors: ["memory_character"], allowedOutcomes: sample === 1 ? ["silent"] : ["silent", "express", "speak"],
    timing: { minimumGapMinutes: 60, chance: 1 }, lifetime: { startsAt: null, expiresAt: null } };
}

async function withRealScenario(name: string, exercise: (s: Scenario) => Promise<void>) {
  if (!provider) throw new Error("real provider configuration is required");
  const root = mkdtempSync(join(tmpdir(), "taki-pattern-real-"));
  const dataDir = join(root, "core");
  let process: InitiativeProcess | undefined; let socket: RpcSocket | undefined; let passed = false;
  let observed: Awaited<ReturnType<typeof observeRealProvider>> | undefined;
  const startedAt = new Date().toISOString();
  try {
    mkdirSync(dataDir);
    seedCanonicalLocal(dataDir, { characterIndex: `用户正在做虚构的赤隼计划。索引模块已经完成，下一步是准备周五的演示。尚未讨论演示效果。记忆标记：${MEMORY_MARKER}。` });
    seedTimeline(dataDir, [{ role: "user", content: `我们之前只讨论过提醒，没有保存任何互动习惯。历史标记：${HISTORY_MARKER}。` },
      { role: "assistant", content: "是的，之前只有讨论，没有实际创建或者启用规则。" }]);
    observed = await observeRealProvider({ baseUrl: provider.TAKI_PROVIDER_BASE_URL!, apiKey: provider.TAKI_PROVIDER_API_KEY!,
      probeMarkers: { selectedMemory: MEMORY_MARKER, primaryHistory: HISTORY_MARKER } });
    process = await startInitiativeProcess({ dataDir, providerBaseUrl: observed.baseUrl, productionEntry: true,
      settings: { ...provider, ...modelTuning(), TAKI_PROVIDER_INCLUDE_USAGE: "true", TAKI_MONITOR_MODE: "FULL_LOCAL",
        TAKI_INITIATIVE_CHECK_INTERVAL_MS: "1000" } });
    socket = await openRpcSocket(process.wsUrl);
    ConnectResultSchema.parse(await rpc(socket, "connect", { deviceId: randomUUID(), deviceName: "C3 Real Model Test", role: "operator" }));
    await rpc(socket, TIMELINE_METHODS.subscribe, { characterId: "taki" });
    const zone = UserTimezoneReadResultSchema.parse(await rpc(socket, USER_TIMEZONE_METHODS.read, {})).state;
    await rpc(socket, USER_TIMEZONE_METHODS.update, { expectedRevision: zone.revision, mode: "fixed", timezone: "UTC" });
    expect(await rpc(socket, INITIATIVE_SETUP_METHODS.installSkill, { characterId: "taki" }))
      .toMatchObject({ status: "installed", setup: { skill: { state: "ready" } } });
    await exercise(makeScenario({ name, dataDir, socket, process, providerRequests: () => observed?.requests ?? [] }));
    passed = true;
  } finally {
    await finalizeScenario({ name, dataDir, startedAt, passed, requests: observed?.requests },
      { root, closeSocket: () => socket?.close(), closeProcess: () => process?.close(), closeObserver: () => observed?.close() });
  }
}

function makeScenario(base: Pick<Scenario, "name" | "dataDir" | "socket" | "process" | "providerRequests">): Scenario {
  return { ...base,
    async ask(prompt) {
      const before = await fetchTimelineEntries(base.socket, "taki");
      const turn = await sayToAgent(base.socket, prompt, 180_000);
      turns.push({ scenario: base.name, prompt, response: turn.text, status: turn.status });
      expect(turn.status, turn.errorMessage).toBe("complete");
      return (await fetchTimelineEntries(base.socket, "taki")).filter((entry) => entry.seq > (before.at(-1)?.seq ?? 0));
    },
    async patterns() { return InteractionPatternListResultSchema.parse(await rpc(base.socket, INTERACTION_PATTERN_METHODS.list,
      { characterId: "taki", after: null, limit: 25 })).patterns; },
    async confirm(pattern) {
      const result = InteractionPatternMutationResultSchema.parse(await rpc(base.socket, INTERACTION_PATTERN_METHODS.confirm,
        { characterId: "taki", patternId: pattern.patternId, commandId: randomUUID(), expectedVersion: pattern.version,
          candidateRevisionId: pattern.candidateRevision?.revisionId }));
      if (result.status === "refused") throw new Error(`confirmation refused: ${result.reason}`);
      return result.pattern;
    },
    async set(key, value) { expect(await rpc(base.socket, CONFIG_METHODS.set, { key, value })).toMatchObject({ status: "ok" }); },
  };
}

async function finalizeScenario(evidence: Parameters<typeof writeEvidence>[0], cleanup: {
  root: string; closeSocket(): void; closeProcess(): Promise<void> | undefined; closeObserver(): Promise<void> | undefined;
}): Promise<void> {
  const results = await Promise.allSettled([Promise.resolve().then(cleanup.closeSocket),
    Promise.resolve().then(cleanup.closeProcess), Promise.resolve().then(cleanup.closeObserver)]);
  const failures: unknown[] = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  try { writeEvidence(evidence); } catch (error) { failures.push(error); }
  try { removeFixture(cleanup.root); } catch (error) { failures.push(error); }
  // An original assertion/transport failure remains the primary error. A successful exercise cannot hide
  // failed teardown or missing evidence, and every cleanup action is attempted regardless of earlier failures.
  if (evidence.passed && failures.length) throw new AggregateError(failures, "Real model fixture cleanup or evidence failed");
}

async function rpc(socket: RpcSocket, method: string, params: unknown) {
  return JsonRpcSuccessResponseSchema.parse(await socket.request(method, params)).result;
}
function only(patterns: InteractionPatternView[]): InteractionPatternView {
  expect(patterns).toHaveLength(1); const first = patterns[0];
  if (!first) throw new Error("model did not create a real Pattern");
  return first;
}
function toolNames(entries: TimelineEntry[]): string[] {
  return entries.flatMap((entry) => entry.parts ?? []).flatMap((part) =>
    part.type === "tool-call" || part.type === "tool-result" ? [part.toolName] : []);
}
function assertPrivateBindingsOmitted(scenario: string, pattern: InteractionPatternView) {
  const text = turns.filter((turn) => turn.scenario === scenario).map((turn) => turn.response).join("\n");
  for (const binding of [pattern.patternId, pattern.effectiveRevision?.revisionId, pattern.candidateRevision?.revisionId]) {
    if (binding) expect(text).not.toContain(binding);
  }
}
function readRows(dataDir: string, sql: string): Record<string, unknown>[] {
  const db = new DatabaseSync(join(dataDir, "taki.db"), { readOnly: true });
  try { return db.prepare(sql).all(); } finally { db.close(); }
}
function modelTuning(): Record<string, string> {
  const file = process.env.TAKI_E2E_REAL_ENV_FILE;
  if (!file) return {};
  const env = parseEnv(readFileSync(resolve(file), "utf8"));
  return Object.fromEntries(["TAKI_MAX_STEPS", "TAKI_PROVIDER_CONTEXT_TOKENS"].flatMap((key) => env[key] ? [[key, env[key]]] : []));
}
function writeEvidence(input: { name: string; dataDir: string; startedAt: string; passed: boolean; requests?: ProviderObservation[] }): void {
  if (!artifactRoot) return;
  mkdirSync(artifactRoot, { recursive: true });
  const evidence = { ...input, dataDir: undefined, finishedAt: new Date().toISOString(), model: provider?.TAKI_PROVIDER_MODEL,
    providerHost: provider?.TAKI_PROVIDER_BASE_URL ? new URL(provider.TAKI_PROVIDER_BASE_URL).host : null,
    turns: turns.filter((turn) => turn.scenario === input.name),
    runs: readRows(input.dataDir, "SELECT initiator,state,outcome FROM runs ORDER BY queued_at"),
    usage: readRows(input.dataDir, "SELECT provider,model_id,quality,input_tokens,output_tokens,total_tokens,cache_read_tokens,reasoning_tokens FROM run_usage ORDER BY recorded_at,rowid"),
    deliveries: readRows(input.dataDir, "SELECT delivery_class,state,decision_json FROM run_deliveries ORDER BY created_at"),
    patterns: readRows(input.dataDir, "SELECT state,version FROM interaction_patterns"),
    schedules: readRows(input.dataDir, "SELECT pattern_json,timezone_json,state FROM scheduled_tasks"),
    authoringTrace: readRows(input.dataDir, "SELECT parts FROM timeline_messages WHERE parts IS NOT NULL ORDER BY seq")
      .flatMap((row) => JSON.parse(String(row.parts)) as Array<{ type: string; toolName?: string }>)
      .filter((part) => part.toolName === "manage_interaction_pattern" || part.toolName === "schedule_task"),
    tools: readRows(input.dataDir, "SELECT parts FROM timeline_messages WHERE parts IS NOT NULL ORDER BY seq")
      .flatMap((row) => JSON.parse(String(row.parts)) as Array<{ type: string; toolName?: string }>)
      .filter((part) => part.type === "tool-call").map((part) => part.toolName),
  };
  let serialized = JSON.stringify(evidence, null, 2);
  for (const [key, value] of Object.entries(provider ?? {})) if (/KEY|TOKEN|SECRET/.test(key) && value) serialized = serialized.replaceAll(value, "[REDACTED]");
  writeFileSync(join(artifactRoot, `${input.name}.json`), `${serialized}\n`, "utf8");
}
function removeFixture(root: string): void {
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes("taki-pattern-real-")) throw new Error("unsafe test fixture path");
  rmSync(root, { recursive: true, force: true });
}

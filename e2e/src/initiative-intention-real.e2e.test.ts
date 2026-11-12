import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { CONFIG_METHODS, ConnectResultSchema, HeartbeatDecisionSchema, INITIATIVE_SETUP_METHODS,
  INTERACTION_PATTERN_METHODS, InteractionPatternMutationResultSchema, JsonRpcSuccessResponseSchema,
  TIMELINE_METHODS, USER_TIMEZONE_METHODS, UserTimezoneReadResultSchema,
  type InteractionPatternDefinition } from "@taki/shared";
import { realProviderEnv } from "./fixture/paths.ts";
import { startInitiativeProcess, type InitiativeProcess } from "./fixture/initiative-process.ts";
import { openRpcSocket, type RpcSocket } from "./fixture/rpc-socket.ts";
import { sayToAgent } from "./fixture/operator-drivers.ts";
import { seedCanonicalLocal } from "./fixture/seed-canonical-memory.ts";
import { seedTimeline } from "./fixture/seed-timeline.ts";
import { seedInitiativeInterviewMemory } from "./fixture/initiative-interview-seed.ts";
import { observeRealProvider, type ProviderObservation } from "./fixture/real-provider-observer.ts";

const provider = realProviderEnv();
const enabled = process.env.TAKI_E2E_REAL_INITIATIVE === "1" && provider !== null;
const artifactRoot = process.env.TAKI_E2E_EVIDENCE_DIR;
const HISTORY_MARKER = "C4_REAL_PRIMARY_HISTORY_ONLY";
const RECORD_MARKER = "C4_REAL_INTERVIEW_RECORD_ONLY";
const repeats = [1, 2];
interface Scenario {
  dataDir: string; socket: RpcSocket; requests: ProviderObservation[];
  turns: Array<{ prompt: string; response: string; status: string }>;
  ask(prompt: string): Promise<void>;
}

// Paid calls need an explicit opt-in in addition to credentials. The observer never supplies model answers.
// Finite expiry/restart crash cuts are deterministic process tests; these cases exercise actual model selection.
describe("C4 real model finite planning and selected recall (explicit opt-in)", () => {
  it.skipIf(!enabled).each(repeats)("forms one finite plan and completes one automatic judgment sample %s", async (sample) => {
    await scenario(`finite-${sample}`, async (s) => {
      const notBefore = new Date(Date.now() + 5_000).toISOString();
      const expiresAt = new Date(Date.now() + 180_000).toISOString();
      await enable(s.socket);
      await s.ask("我刚结束一场虚构的研究岗位模拟面试，目前还不知道结果。我希望稍后能聊聊感受。"
        + `如果合适，请在 UTC ${notBefore} 到 ${expiresAt} 这个有限窗口内考虑关心一下；`
        + "这是一次后续关心，不是定时提醒，不需要保证按点发消息，也不是长期互动习惯。没有合适的话可以安静。先陪我说两句就好。");
      const plans = rows(s.dataDir, "SELECT * FROM initiative_intentions");
      expect(plans).toHaveLength(1);
      expect(Date.parse(String(plans[0]?.not_before))).toBe(Date.parse(notBefore));
      expect(Date.parse(String(plans[0]?.expires_at))).toBe(Date.parse(expiresAt));
      expect(plans[0]?.reported_event_time).toBeNull();
      expect(rows(s.dataDir, "SELECT 1 FROM scheduled_tasks")).toHaveLength(0);
      expect(rows(s.dataDir, "SELECT 1 FROM interaction_patterns")).toHaveLength(0);
      expect(toolCalls(s.dataDir)).toContain("plan_follow_up");
      await completedHeartbeat(s.dataDir);
      const after = rows(s.dataDir, "SELECT state,disposition FROM initiative_intentions");
      expect(after).toMatchObject([{ state: "terminal" }]);
      expect(["silent", "speak", "express"]).toContain(after[0]?.disposition);
      assertHistoryExcluded(s.requests);
      await set(s.socket, "TAKI_INITIATIVE_ENABLED", false);
    });
  }, 300_000);

  it.skipIf(!enabled).each(repeats)("explicitly recalls a retained interview in a fresh independent window sample %s", async (sample) => {
    await scenario(`recall-${sample}`, async (s) => {
      const candidate = InteractionPatternMutationResultSchema.parse(await rpc(s.socket, INTERACTION_PATTERN_METHODS.propose, {
        characterId: "taki", commandId: randomUUID(), patternId: null, expectedVersion: 0, definition: interviewWindow(),
      }));
      if (candidate.status === "refused") throw new Error(`fresh-window proposal refused: ${candidate.reason}`);
      expect(await rpc(s.socket, INTERACTION_PATTERN_METHODS.confirm, { characterId: "taki", patternId: candidate.pattern.patternId,
        commandId: randomUUID(), expectedVersion: candidate.pattern.version,
        candidateRevisionId: candidate.pattern.candidateRevision?.revisionId })).toMatchObject({ status: "applied" });
      await enable(s.socket);
      await completedHeartbeat(s.dataDir);
      const effects = rows(s.dataDir, "SELECT count(*) AS count FROM run_effects WHERE kind='memory' AND run_id IN (SELECT run_id FROM runs WHERE initiator='heartbeat')");
      expect(Number(effects[0]?.count ?? 0)).toBeGreaterThan(0);
      // The record marker exists only in a genuine retrieved Memory record, not Blocks, purpose or Timeline.
      // Its appearance after tool execution proves actual explicit recall crossed the real request boundary.
      const heartbeatRequests = assertHistoryExcluded(s.requests);
      expect(heartbeatRequests.some((request) => request.selectedMemoryPresent === true)).toBe(true);
      const decisions = rows(s.dataDir, "SELECT decision_json FROM run_deliveries WHERE delivery_class='class_b'");
      expect(decisions).toHaveLength(1);
      HeartbeatDecisionSchema.parse(JSON.parse(String(decisions[0]?.decision_json)));
      expect(rows(s.dataDir, "SELECT 1 FROM initiative_intentions")).toHaveLength(0);
      await set(s.socket, "TAKI_INITIATIVE_ENABLED", false);
    });
  }, 300_000);
});

function interviewWindow(): InteractionPatternDefinition {
  const hour = new Date().getUTCHours();
  const clock = (offset: number) => `${String((hour + offset + 24) % 24).padStart(2, "0")}:00`;
  return { title: "面试后的近况", purpose: "Read the selected Character Memory about the interview for a research role first, then consider one brief question about the user's current feelings. The interview outcome is unknown. Do not assert acceptance, rejection or a resolved matter; remaining silent is allowed.",
    conditions: { all: [{ kind: "local_time_window", start: clock(-1), end: clock(1), daysOfWeek: [1, 2, 3, 4, 5, 6, 7] }] },
    contextSelectors: ["memory_character"], allowedOutcomes: ["silent", "speak"],
    timing: { minimumGapMinutes: 60, chance: 1 }, lifetime: { startsAt: null, expiresAt: null } };
}

async function scenario(name: string, exercise: (s: Scenario) => Promise<void>): Promise<void> {
  if (!provider) throw new Error("real provider configuration is required");
  const root = mkdtempSync(join(tmpdir(), "taki-intention-real-"));
  const dataDir = join(root, "core");
  let process: InitiativeProcess | undefined; let socket: RpcSocket | undefined;
  let observed: Awaited<ReturnType<typeof observeRealProvider>> | undefined;
  const turns: Scenario["turns"] = []; const startedAt = new Date().toISOString(); let passed = false;
  try {
    mkdirSync(dataDir);
    seedCanonicalLocal(dataDir);
    seedInitiativeInterviewMemory(dataDir, RECORD_MARKER);
    seedTimeline(dataDir, [{ role: "user", content: `之前聊过一次周末散步，没有任何跟进计划。${HISTORY_MARKER}` },
      { role: "assistant", content: "没有保存过计划，之前只有聊天。" }]);
    observed = await observeRealProvider({ baseUrl: provider.TAKI_PROVIDER_BASE_URL!, apiKey: provider.TAKI_PROVIDER_API_KEY!,
      probeMarkers: { selectedMemory: RECORD_MARKER, primaryHistory: HISTORY_MARKER } });
    process = await startInitiativeProcess({ dataDir, providerBaseUrl: observed.baseUrl, productionEntry: true,
      settings: { ...provider, ...tuning(), TAKI_PROVIDER_INCLUDE_USAGE: "true", TAKI_MONITOR_MODE: "FULL_LOCAL",
        TAKI_INITIATIVE_CHECK_INTERVAL_MS: "1000" } });
    socket = await openRpcSocket(process.wsUrl);
    ConnectResultSchema.parse(await rpc(socket, "connect", { deviceId: randomUUID(), deviceName: "C4 Real Model Test", role: "operator" }));
    await rpc(socket, TIMELINE_METHODS.subscribe, { characterId: "taki" });
    const zone = UserTimezoneReadResultSchema.parse(await rpc(socket, USER_TIMEZONE_METHODS.read, {})).state;
    await rpc(socket, USER_TIMEZONE_METHODS.update, { expectedRevision: zone.revision, mode: "fixed", timezone: "UTC" });
    expect(await rpc(socket, INITIATIVE_SETUP_METHODS.installSkill, { characterId: "taki" }))
      .toMatchObject({ status: "installed", setup: { skill: { state: "ready" }, sources: { intentionAvailable: true } } });
    const connected = socket;
    await exercise({ dataDir, socket, requests: observed.requests, turns,
      async ask(prompt) {
        const answer = await sayToAgent(connected, prompt, 180_000);
        turns.push({ prompt, response: answer.text, status: answer.status });
        expect(answer.status, answer.errorMessage).toBe("complete");
      } });
    passed = true;
  } finally {
    await finalize({ name, dataDir, startedAt, passed, turns, requests: observed?.requests ?? [] }, {
      root, closeSocket: () => socket?.close(), closeProcess: () => process?.close(), closeObserver: () => observed?.close(),
    });
  }
}

async function finalize(record: Parameters<typeof evidence>[0], cleanup: {
  root: string; closeSocket(): void; closeProcess(): Promise<void> | undefined; closeObserver(): Promise<void> | undefined;
}): Promise<void> {
  const settled = await Promise.allSettled([Promise.resolve().then(cleanup.closeSocket),
    Promise.resolve().then(cleanup.closeProcess), Promise.resolve().then(cleanup.closeObserver)]);
  const failures: unknown[] = settled.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  try { evidence(record); } catch (error) { failures.push(error); }
  try { removeFixture(cleanup.root); } catch (error) { failures.push(error); }
  // Preserve an original scenario failure; successful behavior cannot conceal failed cleanup/evidence.
  if (record.passed && failures.length) throw new AggregateError(failures, "Real C4 evidence or teardown failed");
}

async function enable(socket: RpcSocket): Promise<void> {
  await set(socket, "TAKI_INITIATIVE_TARGET_CHARACTER", "taki");
  await set(socket, "TAKI_INITIATIVE_QUIET_START", "00:00");
  await set(socket, "TAKI_INITIATIVE_QUIET_END", "00:00");
  await set(socket, "TAKI_INITIATIVE_ENABLED", true);
}
async function set(socket: RpcSocket, key: string, value: string | boolean): Promise<void> {
  expect(await rpc(socket, CONFIG_METHODS.set, { key, value })).toMatchObject({ status: "ok" });
}
async function rpc(socket: RpcSocket, method: string, params: unknown) {
  return JsonRpcSuccessResponseSchema.parse(await socket.request(method, params)).result;
}
async function completedHeartbeat(dataDir: string): Promise<void> {
  const current = () => rows(dataDir, "SELECT state FROM runs WHERE initiator='heartbeat'");
  const terminal = new Set(["completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown"]);
  await expect.poll(() => terminal.has(String(current()[0]?.state)), { timeout: 180_000, interval: 250 }).toBe(true);
  expect(current()).toMatchObject([{ state: "completed" }]);
  expect(current()).toHaveLength(1);
}
function assertHistoryExcluded(requests: ProviderObservation[]): ProviderObservation[] {
  const heartbeat = requests.filter((request) => request.tools.some((tool) => tool.name === "heartbeat_respond"));
  expect(heartbeat.length).toBeGreaterThan(0);
  expect(heartbeat.every((request) => request.primaryHistoryPresent === false)).toBe(true);
  return heartbeat;
}
function rows(dataDir: string, sql: string): Record<string, unknown>[] {
  const db = new DatabaseSync(join(dataDir, "taki.db"), { readOnly: true });
  try { return db.prepare(sql).all(); } finally { db.close(); }
}
function toolCalls(dataDir: string): string[] {
  return rows(dataDir, "SELECT parts FROM timeline_messages WHERE parts IS NOT NULL ORDER BY seq")
    .flatMap((row) => JSON.parse(String(row.parts)) as Array<{ type: string; toolName?: string }>)
    .flatMap((part) => part.type === "tool-call" && part.toolName ? [part.toolName] : []);
}
function tuning(): Record<string, string> {
  const path = process.env.TAKI_E2E_REAL_ENV_FILE;
  if (!path) return {};
  const env = parseEnv(readFileSync(resolve(path), "utf8"));
  return Object.fromEntries(["TAKI_MAX_STEPS", "TAKI_PROVIDER_CONTEXT_TOKENS"].flatMap((key) => env[key] ? [[key, env[key]]] : []));
}
function evidence(input: { name: string; dataDir: string; startedAt: string; passed: boolean; turns: Scenario["turns"]; requests: ProviderObservation[] }) {
  if (!artifactRoot) return;
  mkdirSync(artifactRoot, { recursive: true });
  const record = { ...input, dataDir: undefined, finishedAt: new Date().toISOString(), model: provider?.TAKI_PROVIDER_MODEL,
    providerHost: provider?.TAKI_PROVIDER_BASE_URL ? new URL(provider.TAKI_PROVIDER_BASE_URL).host : null,
    plans: rows(input.dataDir, "SELECT state,not_before,expires_at,disposition,terminal_at FROM initiative_intentions"),
    runs: rows(input.dataDir, "SELECT initiator,state,outcome,initiative_timezone FROM runs ORDER BY queued_at"),
    effects: rows(input.dataDir, "SELECT kind,state,outcome,error_code FROM run_effects ORDER BY created_at"),
    deliveries: rows(input.dataDir, "SELECT delivery_class,state,decision_json FROM run_deliveries ORDER BY created_at"),
    usage: rows(input.dataDir, "SELECT provider,model_id,quality,input_tokens,output_tokens,total_tokens,cache_read_tokens,reasoning_tokens FROM run_usage ORDER BY recorded_at,rowid"),
    tools: toolCalls(input.dataDir),
    planningTrace: rows(input.dataDir, "SELECT parts FROM timeline_messages WHERE parts IS NOT NULL ORDER BY seq")
      .flatMap((row) => JSON.parse(String(row.parts)) as Array<{ type: string; toolName?: string }>)
      .filter((part) => part.toolName === "plan_follow_up") };
  let text = JSON.stringify(record, null, 2);
  for (const [key, value] of Object.entries(provider ?? {})) if (/KEY|TOKEN|SECRET/.test(key) && value) text = text.replaceAll(value, "[REDACTED]");
  writeFileSync(join(artifactRoot, `${input.name}.json`), `${text}\n`, "utf8");
}
function removeFixture(root: string): void {
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes("taki-intention-real-")) throw new Error("unsafe real C4 fixture path");
  rmSync(root, { recursive: true, force: true });
}

import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { CONFIG_METHODS, INITIATIVE_BACKOFF_METHODS, INITIATIVE_WAKE_METHODS, INTERACTION_PATTERN_METHODS,
  OBSERVABILITY_METHODS, TIMELINE_METHODS, USER_TIMEZONE_METHODS, ConnectResultSchema,
  JsonRpcErrorResponseSchema, JsonRpcSuccessResponseSchema, InitiativeBackoffStatusSchema, InitiativeBackoffChangedSchema,
  InteractionPatternMutationResultSchema, InitiativeWakePolicyStatusSchema, UserTimezoneReadResultSchema,
  TrajectoryResultSchema, type InitiativeIntentionPlan, type InteractionPatternDefinition } from "@taki/shared";
import { startInitiativeProcess, type InitiativeProcess } from "./fixture/initiative-process.ts";
import { seedCanonicalLocal } from "./fixture/seed-canonical-memory.ts";
import { seedInitiativeInterviewMemory, type SeededInterviewMemory } from "./fixture/initiative-interview-seed.ts";
import { openRpcSocket, type RpcSocket } from "./fixture/rpc-socket.ts";
import { fetchTimelineEntries, sayToAgent } from "./fixture/operator-drivers.ts";
import { startScriptedProvider, type ScriptedReply } from "./fixture/scripted-provider.ts";

const PURPOSE = "Consider an interview follow-up using current confirmed memory, keeping its outcome unknown.";
const FOLLOW_UP = "之前提到的研究岗位面试，后来怎么样了？";
interface ScriptState {
  operation: "plan" | "invalidate"; primaryStep: number; plan?: InitiativeIntentionPlan;
  recall: boolean; invalidated: boolean; offline: boolean; memory: SeededInterviewMemory;
  recallViews: Record<string, unknown>[]; initialHeartbeatHadProbe: boolean[];
}
function messages(request: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(request.messages) ? request.messages.filter((value): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)) : [];
}
function content(message: Record<string, unknown>): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.map((part: unknown) => part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "").join("\n");
}
function recallViews(request: Record<string, unknown>): Record<string, unknown>[] {
  return messages(request).filter((message) => message.role === "tool").flatMap((message) => {
    const text = content(message); const start = text.indexOf("{"); const end = text.lastIndexOf("}");
    if (start < 0 || end < start) return [];
    const parsed: unknown = JSON.parse(text.slice(start, end + 1).replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"));
    return parsed && typeof parsed === "object" && "scope" in parsed && "records" in parsed ? [parsed as Record<string, unknown>] : [];
  });
}
function scripted(state: ScriptState, request: Record<string, unknown>): ScriptedReply {
  if (JSON.stringify(request.tools).includes('"heartbeat_respond"')) {
    const text = messages(request).map(content).join("\n");
    const candidateId = /"candidateId":"([a-f0-9]+)"/.exec(text)?.[1];
    if (!candidateId) throw new Error("missing actual offered candidate");
    if (!state.recall) return { calls: [{ name: "heartbeat_respond", arguments: {
      outcome: "silent", selectedCandidateIds: [], text: null, presentation: null, responseExpectation: null } }] };
    expect(text).toContain(PURPOSE);
    const views = recallViews(request);
    if (views.length === 0) {
      state.initialHeartbeatHadProbe.push(text.includes(state.memory.marker));
      expect(text).not.toContain(state.memory.marker);
      return { calls: [{ name: "recall", arguments: { scope: "global" } }] };
    }
    if (!views.some((view) => view.scope === "character")) return { calls: [{ name: "recall", arguments: { scope: "character" } }] };
    state.recallViews = views;
    const character = views.find((view) => view.scope === "character")!;
    expect(character.status).not.toBe("unavailable");
    if (state.invalidated) expect(JSON.stringify(character.records)).not.toContain(state.memory.marker);
    else {
      expect(JSON.stringify(character.records)).toContain(state.memory.marker);
      expect(JSON.stringify(character.records)).toContain("outcome is unknown");
      expect(character.records).toEqual(expect.arrayContaining([expect.objectContaining({ confirmed: true, origin: "explicit-user" })]));
    }
    return { calls: [{ name: "heartbeat_respond", arguments: state.invalidated
      ? { outcome: "silent", selectedCandidateIds: [], text: null, presentation: null, responseExpectation: null }
      : { outcome: "speak", selectedCandidateIds: [candidateId], text: FOLLOW_UP, presentation: null, responseExpectation: "invitation" } }] };
  }
  const step = state.primaryStep++;
  if (state.operation === "invalidate") {
    if (step === 0) return { calls: [{ name: "invalidate_memory", arguments: { scope: "character",
      memoryId: state.memory.memoryId, expectedRevision: 1, reason: "The user withdrew this reported matter." } }] };
    expect(messages(request).filter((message) => message.role === "tool").map(content).join("\n")).toContain('"ok":true');
    return { text: "已将这条记忆标为失效，不再依据它主动追问。" };
  }
  if (step === 0) {
    const now = Date.now();
    state.plan = { purpose: "Consider a later interview check-in without assuming an outcome.", reportedEventTime: null,
      notBefore: new Date(now + (state.offline ? 10_000 : 5000)).toISOString(),
      expiresAt: new Date(now + (state.offline ? 18_000 : 60_000)).toISOString() };
    return { calls: [{ name: "plan_follow_up", arguments: state.plan }] };
  }
  if (step === 1) {
    expect(messages(request).filter((message) => message.role === "tool").map(content).join("\n")).toContain('"status":"created"');
    return { calls: [{ name: "plan_follow_up", arguments: { ...state.plan,
      purpose: "A differently worded check-in for the same interview.", expiresAt: new Date(Date.parse(state.plan!.expiresAt) + 30_000).toISOString() } }] };
  }
  expect(messages(request).filter((message) => message.role === "tool").map(content).join("\n")).toContain('"status":"duplicate"');
  return { text: "之后有合适的机会，我会考虑关心一下。" };
}

async function rpc(socket: RpcSocket, method: string, params: unknown): Promise<unknown> {
  const frame = await socket.request(method, params); const parsed = JsonRpcSuccessResponseSchema.safeParse(frame);
  if (!parsed.success) throw new Error(`RPC ${method}: ${JSON.stringify(frame)}`);
  return parsed.data.result;
}
function rows(dataDir: string, sql: string) {
  const db = new DatabaseSync(join(dataDir, "taki.db"), { readOnly: true });
  try { return db.prepare(sql).all(); } finally { db.close(); }
}
const heartbeatRows = (dataDir: string) => rows(dataDir, "SELECT run_id,state FROM runs WHERE initiator='heartbeat'");
const intentions = (dataDir: string) => rows(dataDir, "SELECT intention_id,source_key,source_json,not_before,expires_at,state,run_id,disposition,purpose,reported_event_time FROM initiative_intentions");
async function set(socket: RpcSocket, key: string, value: boolean | string) {
  expect(await rpc(socket, CONFIG_METHODS.set, { key, value })).toMatchObject({ status: "ok" });
}
async function policy(socket: RpcSocket) {
  return InitiativeWakePolicyStatusSchema.parse(await rpc(socket, INITIATIVE_WAKE_METHODS.read, { characterId: "taki" }));
}
async function reviewedCurrentPattern(socket: RpcSocket): Promise<void> {
  const hour = new Date().getUTCHours();
  const clock = (offset: number) => `${String((hour + offset + 24) % 24).padStart(2, "0")}:00`;
  const definition: InteractionPatternDefinition = { title: "独立的面试关心窗口", purpose: PURPOSE,
    conditions: { all: [{ kind: "local_time_window", start: clock(-1), end: clock(1), daysOfWeek: [1, 2, 3, 4, 5, 6, 7] }] },
    contextSelectors: ["memory_global", "memory_character"], allowedOutcomes: ["silent", "speak"],
    timing: { minimumGapMinutes: 0, chance: 1 }, lifetime: { startsAt: null, expiresAt: null } };
  const proposal = InteractionPatternMutationResultSchema.parse(await rpc(socket, INTERACTION_PATTERN_METHODS.propose,
    { characterId: "taki", commandId: randomUUID(), patternId: null, expectedVersion: 0, definition }));
  if (proposal.status === "refused") throw new Error(proposal.reason);
  expect(proposal.pattern.state).toBe("proposed");
  const accepted = InteractionPatternMutationResultSchema.parse(await rpc(socket, INTERACTION_PATTERN_METHODS.confirm,
    { characterId: "taki", commandId: randomUUID(), patternId: proposal.pattern.patternId,
      expectedVersion: proposal.pattern.version, candidateRevisionId: proposal.pattern.candidateRevision?.revisionId }));
  if (accepted.status === "refused") throw new Error(accepted.reason);
  expect(accepted.pattern.state).toBe("active");
}
interface Scenario {
  dataDir: string; script: ScriptState; socket(): RpcSocket; wsUrl(): string; stop(): Promise<void>; start(): Promise<void>;
  requestCount(): number; providerErrors(): readonly Error[];
}
async function scenario(offline: boolean, run: (value: Scenario) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "taki-intention-process-")); const dataDir = join(root, "core"); mkdirSync(dataDir);
  let child: InitiativeProcess | undefined; let socket: RpcSocket | undefined;
  let provider: Awaited<ReturnType<typeof startScriptedProvider>> | undefined;
  const stop = async () => { socket?.close(); socket = undefined; await child?.close(); child = undefined; };
  try {
    seedCanonicalLocal(dataDir); const memory = seedInitiativeInterviewMemory(dataDir);
    const script: ScriptState = { operation: "plan", primaryStep: 0, recall: false, invalidated: false, offline, memory,
      recallViews: [], initialHeartbeatHadProbe: [] };
    provider = await startScriptedProvider((request) => scripted(script, request));
    const start = async () => {
      if (!provider) throw new Error("provider unavailable");
      child = await startInitiativeProcess({ dataDir, providerBaseUrl: provider.baseUrl, productionEntry: true,
        settings: { TAKI_MONITOR_MODE: "FEEDBACK_ONLY" } });
      socket = await openRpcSocket(child.wsUrl);
      ConnectResultSchema.parse(await rpc(socket, "connect", { deviceId: randomUUID(), deviceName: "Intention process E2E", role: "operator" }));
      await rpc(socket, TIMELINE_METHODS.subscribe, { characterId: "taki" });
    };
    await start();
    if (!socket) throw new Error("socket unavailable");
    const timezone = UserTimezoneReadResultSchema.parse(await rpc(socket, USER_TIMEZONE_METHODS.read, {})).state;
    await rpc(socket, USER_TIMEZONE_METHODS.update, { expectedRevision: timezone.revision, mode: "fixed", timezone: "UTC" });
    const hour = new Date().getUTCHours();
    await set(socket, "TAKI_INITIATIVE_QUIET_START", `${String((hour + 2) % 24).padStart(2, "0")}:00`);
    await set(socket, "TAKI_INITIATIVE_QUIET_END", `${String((hour + 3) % 24).padStart(2, "0")}:00`);
    await set(socket, "TAKI_INITIATIVE_TARGET_CHARACTER", "taki");
    await set(socket, "TAKI_INITIATIVE_ENABLED", false);
    await set(socket, "TAKI_INITIATIVE_PERIODIC_ENABLED", false);
    await set(socket, "TAKI_INITIATIVE_EVENTS_ENABLED", true);
    await run({ dataDir, script, socket: () => { if (!socket) throw new Error("socket closed"); return socket; },
      wsUrl: () => { if (!child) throw new Error("Core stopped"); return child.wsUrl; }, stop, start,
      requestCount: () => provider?.requests.length ?? 0, providerErrors: () => provider?.errors ?? [] });
  } finally {
    try { await stop(); } finally {
      try { await provider?.close(); } finally {
        removeFixture(root);
      }
    }
  }
}

function removeFixture(root: string): void {
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-intention-process-")) throw new Error("unsafe fixture cleanup");
  rmSync(root, { recursive: true, force: true });
}

describe("C4 finite follow-up through unmodified Core and real process restart", () => {
  it("forms one automatic source-bound plan, consumes it once, and preserves authenticated backoff reset on restart", async () => {
    await scenario(false, async (s) => {
      expect((await sayToAgent(s.socket(), "我稍后有个面试，结果还不知道。"))).toMatchObject({ status: "complete" });
      const plans = intentions(s.dataDir); expect(plans).toHaveLength(1);
      expect(plans[0]).toMatchObject({ state: "active", not_before: s.script.plan!.notBefore, expires_at: s.script.plan!.expiresAt,
        reported_event_time: null });
      expect(rows(s.dataDir, "SELECT * FROM interaction_patterns")).toEqual([]);
      expect(rows(s.dataDir, "SELECT * FROM interaction_pattern_reviews")).toEqual([]);
      expect(rows(s.dataDir, "SELECT * FROM scheduled_tasks")).toEqual([]);
      expect(heartbeatRows(s.dataDir)).toEqual([]);
      const source = JSON.parse(String(plans[0]!.source_json)) as { timelineId: string };
      expect((await fetchTimelineEntries(s.socket(), "taki")).find((entry) => entry.id === source.timelineId))
        .toMatchObject({ role: "user", content: "我稍后有个面试，结果还不知道。" });
      await set(s.socket(), "TAKI_INITIATIVE_ENABLED", true);
      await expect.poll(() => heartbeatRows(s.dataDir), { timeout: 20_000 }).toMatchObject([{ state: "completed" }]);
      await expect.poll(() => intentions(s.dataDir)[0]?.disposition).toBe("silent");
      const runId = String(heartbeatRows(s.dataDir)[0]!.run_id);
      const trajectory = TrajectoryResultSchema.parse(await rpc(s.socket(), OBSERVABILITY_METHODS.trajectory,
        { characterId: "taki", runKey: runId, limit: 200 }));
      expect(trajectory.run.modelRequestCount).toBe(1);
      expect(trajectory.rows.some((row) => row.phase === "delivery")).toBe(true);
      for (const method of [INITIATIVE_BACKOFF_METHODS.read, INITIATIVE_BACKOFF_METHODS.reset]) {
        const unauthenticated = await openRpcSocket(s.wsUrl());
        try { expect(JsonRpcErrorResponseSchema.parse(await unauthenticated.request(method, { characterId: "taki" })).error.data)
          .toMatchObject({ code: "NOT_AUTHENTICATED" }); } finally { unauthenticated.close(); }
      }
      const reset = InitiativeBackoffStatusSchema.parse(await rpc(s.socket(), INITIATIVE_BACKOFF_METHODS.reset, { characterId: "taki" }));
      expect(reset).toMatchObject({ stage: "normal", qualifiedWeakCount: 0, dailyJudgments: 1, lastResetReason: "operator" });
      expect(reset.lastResetAt).not.toBeNull();
      const count = s.requestCount(); const finalPlan = intentions(s.dataDir)[0]; await s.stop(); await s.start();
      const restored = InitiativeBackoffStatusSchema.parse(await rpc(s.socket(), INITIATIVE_BACKOFF_METHODS.read, { characterId: "taki" }));
      expect(restored).toMatchObject({ dailyJudgments: 1, lastResetAt: reset.lastResetAt, lastResetReason: "operator" });
      await set(s.socket(), "TAKI_INITIATIVE_ENABLED", false); await set(s.socket(), "TAKI_INITIATIVE_ENABLED", true);
      await expect.poll(async () => (await policy(s.socket())).recent[0]?.reason, { timeout: 8000 }).toBe("model-cadence");
      expect(heartbeatRows(s.dataDir)).toHaveLength(1); expect(intentions(s.dataDir)[0]).toEqual(finalPlan);
      expect(s.requestCount()).toBe(count); expect(s.providerErrors()).toEqual([]);
    });
  });

  it.each([false, true])("expires offline, then uses a new reviewed window with actual recall (Memory invalidated: %s)", async (invalidated) => {
    await scenario(true, async (s) => {
      expect(await sayToAgent(s.socket(), "我稍后有个面试，结果还不知道。")).toMatchObject({ status: "complete" });
      const original = intentions(s.dataDir)[0]!;
      expect(Date.now()).toBeLessThan(Date.parse(s.script.plan!.notBefore));
      await set(s.socket(), "TAKI_INITIATIVE_ENABLED", true);
      await s.stop();
      expect(heartbeatRows(s.dataDir)).toEqual([]);
      await delay(Math.max(0, Date.parse(s.script.plan!.expiresAt) - Date.now() + 150));
      const beforeRestart = s.requestCount(); await s.start();
      expect(intentions(s.dataDir)[0]).toMatchObject({ intention_id: original.intention_id, source_key: original.source_key,
        state: "terminal", disposition: "expired", purpose: null, run_id: null, expires_at: original.expires_at });
      await set(s.socket(), "TAKI_INITIATIVE_ENABLED", false); await set(s.socket(), "TAKI_INITIATIVE_ENABLED", true);
      await expect.poll(async () => (await policy(s.socket())).recent[0]?.reason, { timeout: 8000 }).toBe("no-pattern");
      expect(heartbeatRows(s.dataDir)).toEqual([]); expect(s.requestCount()).toBe(beforeRestart);
      const memoryBefore = rows(s.dataDir, "SELECT memory_id,text,state,revision FROM canonical_memory_units").find((row) => row.memory_id === s.script.memory.memoryId);
      expect(memoryBefore).toMatchObject({ text: s.script.memory.text, state: "valid", revision: 1 });
      if (invalidated) {
        s.script.operation = "invalidate"; s.script.primaryStep = 0;
        expect(await sayToAgent(s.socket(), "请作废之前关于面试的那条记忆，我撤回它。"))
          .toMatchObject({ status: "complete" });
        expect(rows(s.dataDir, "SELECT memory_id,state,revision FROM canonical_memory_units").find((row) => row.memory_id === s.script.memory.memoryId))
          .toMatchObject({ state: "invalidated", revision: 2 });
      }
      s.script.recall = true; s.script.invalidated = invalidated;
      const beforeAdmission = InitiativeBackoffStatusSchema.parse(await rpc(s.socket(), INITIATIVE_BACKOFF_METHODS.read,
        { characterId: "taki" }));
      expect(beforeAdmission.dailyJudgments).toBe(0);
      // The read is an ordered WS barrier after any primary reset. Only the following independent
      // Pattern admission can supply the newly observed usage change; no user turn follows this baseline.
      const notificationBaseline = s.socket().notifications().length;
      await reviewedCurrentPattern(s.socket());
      await expect.poll(() => heartbeatRows(s.dataDir), { timeout: 20_000 }).toMatchObject([{ state: "completed" }]);
      await expect.poll(() => s.socket().notifications().slice(notificationBaseline)
        .filter((note) => note.method === INITIATIVE_BACKOFF_METHODS.changed)
        .map((note) => InitiativeBackoffChangedSchema.parse(note.params).characterId), { timeout: 8000 }).toContain("taki");
      const afterAdmission = InitiativeBackoffStatusSchema.parse(await rpc(s.socket(), INITIATIVE_BACKOFF_METHODS.read,
        { characterId: "taki" }));
      expect(afterAdmission.dailyJudgments).toBe(beforeAdmission.dailyJudgments + 1);
      const entries = await fetchTimelineEntries(s.socket(), "taki");
      expect(entries.filter((entry) => entry.content === FOLLOW_UP)).toHaveLength(invalidated ? 0 : 1);
      expect(entries.filter((entry) => entry.role === "user" && entry.content === "我稍后有个面试，结果还不知道。")).toHaveLength(1);
      expect(s.script.initialHeartbeatHadProbe).toEqual([false]);
      expect(s.script.recallViews.map((view) => view.scope)).toEqual(["global", "character"]);
      const finalPlan = intentions(s.dataDir)[0];
      expect(finalPlan).toMatchObject({ intention_id: original.intention_id, state: "terminal", disposition: "expired", run_id: null });
      const runId = String(heartbeatRows(s.dataDir)[0]!.run_id);
      const trajectory = TrajectoryResultSchema.parse(await rpc(s.socket(), OBSERVABILITY_METHODS.trajectory,
        { characterId: "taki", runKey: runId, limit: 200 }));
      expect(trajectory.run.modelRequestCount).toBe(3);
      expect(trajectory.rows.some((row) => row.phase === "delivery")).toBe(true);
      expect(s.providerErrors()).toEqual([]);
      const count = s.requestCount(); await s.stop(); await s.start();
      expect(intentions(s.dataDir)[0]).toEqual(finalPlan);
      await set(s.socket(), "TAKI_INITIATIVE_ENABLED", false); await set(s.socket(), "TAKI_INITIATIVE_ENABLED", true);
      await expect.poll(async () => (await policy(s.socket())).recent[0]?.reason, { timeout: 8000 }).toBe("model-cadence");
      expect(heartbeatRows(s.dataDir)).toHaveLength(1); expect(s.requestCount()).toBe(count);
    });
  });
});

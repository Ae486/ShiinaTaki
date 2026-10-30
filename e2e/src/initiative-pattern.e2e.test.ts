import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { CONFIG_METHODS, INITIATIVE_SETUP_METHODS, INITIATIVE_WAKE_METHODS, INTERACTION_PATTERN_METHODS,
  OBSERVABILITY_METHODS, TIMELINE_METHODS, USER_TIMEZONE_METHODS, PRESENCE_METHODS, ConnectResultSchema,
  JsonRpcSuccessResponseSchema, InteractionPatternListResultSchema, InteractionPatternMutationResultSchema,
  InitiativeSetupStatusSchema, InitiativeWakePolicyStatusSchema, UserTimezoneReadResultSchema,
  TrajectoryResultSchema, type InteractionPatternDefinition, type InteractionPatternView } from "@taki/shared";
import { startInitiativeProcess, type InitiativeProcess } from "./fixture/initiative-process.ts";
import { openRpcSocket, type RpcSocket } from "./fixture/rpc-socket.ts";
import { sayToAgent, fetchTimelineEntries } from "./fixture/operator-drivers.ts";
import { seedCanonicalLocal } from "./fixture/seed-canonical-memory.ts";
import { startScriptedProvider, type ScriptedReply } from "./fixture/scripted-provider.ts";

const PURPOSE = "Consider one brief check-in about the current project when this reviewed window is eligible.";
const SPEECH = "现在适合简短回顾一下进度。";
function definition(withPresence = false): InteractionPatternDefinition {
  const hour = new Date().getUTCHours();
  const clock = (offset: number) => `${String((hour + offset + 24) % 24).padStart(2, "0")}:00`;
  return { title: "当前时段回顾", purpose: PURPOSE,
    conditions: { all: [{ kind: "local_time_window", start: clock(-1), end: clock(1), daysOfWeek: [1, 2, 3, 4, 5, 6, 7] },
      ...(withPresence ? [{ kind: "presence_present" as const }] : [])] },
    contextSelectors: ["memory_global", "memory_character"], allowedOutcomes: ["silent", "speak"],
    timing: { minimumGapMinutes: 0, chance: 1 }, lifetime: { startsAt: null, expiresAt: null } };
}
function reply(request: Record<string, unknown>, index: number, withPresence = false): ScriptedReply {
  if (JSON.stringify(request.tools).includes('"heartbeat_respond"')) {
    const messages = Array.isArray(request.messages) ? request.messages : [];
    const content = messages.flatMap((message: { content?: unknown }) => typeof message.content === "string" ? [message.content] : []).join("\n");
    const candidateId = /"candidateId":"([a-f0-9]+)"/.exec(content)?.[1];
    if (!candidateId) throw new Error("no offered Pattern candidate in real request");
    expect(content).toContain(PURPOSE);
    return { calls: [{ name: "heartbeat_respond", arguments: { outcome: "speak", selectedCandidateIds: [candidateId],
      text: SPEECH, presentation: null, responseExpectation: "none" } }] };
  }
  return index === 0 ? { calls: [{ name: "manage_interaction_pattern", arguments: { action: "propose", patternId: null,
    expectedVersion: 0, definition: definition(withPresence), revisionId: null, listAfter: null, historyBefore: null } }] } : { text: "请检查这条互动习惯，再确认是否启用。" };
}
const rpc = async (socket: RpcSocket, method: string, params: unknown) => {
  const frame = await socket.request(method, params);
  const parsed = JsonRpcSuccessResponseSchema.safeParse(frame);
  if (!parsed.success) throw new Error(`RPC ${method}: ${JSON.stringify(frame)}`);
  return parsed.data.result;
};
async function patterns(socket: RpcSocket) {
  return InteractionPatternListResultSchema.parse(await rpc(socket, INTERACTION_PATTERN_METHODS.list,
    { characterId: "taki", after: null, limit: 25 })).patterns;
}
async function confirm(socket: RpcSocket, pattern: InteractionPatternView) {
  const result = InteractionPatternMutationResultSchema.parse(await rpc(socket, INTERACTION_PATTERN_METHODS.confirm,
    { characterId: "taki", commandId: randomUUID(), patternId: pattern.patternId,
      expectedVersion: pattern.version, candidateRevisionId: pattern.candidateRevision?.revisionId }));
  if (result.status === "refused") throw new Error(`confirmation refused: ${result.reason}`);
  return result.pattern;
}
function heartbeatRows(dataDir: string) {
  const db = new DatabaseSync(join(dataDir, "taki.db"), { readOnly: true });
  try { return db.prepare("SELECT run_id,state FROM runs WHERE initiator='heartbeat'").all(); }
  finally { db.close(); }
}
async function set(socket: RpcSocket, key: string, value: boolean | string) {
  expect(await rpc(socket, CONFIG_METHODS.set, { key, value })).toMatchObject({ status: "ok" });
}
async function reportFreshInput(socket: RpcSocket) {
  const source = { sourceId: randomUUID(), sequence: 1, surface: "home", state: "active",
    visible: true, focused: true, observedAgeMs: 0, inputContinuity: "tracked", lastInput: null };
  expect(await rpc(socket, PRESENCE_METHODS.report, source)).toMatchObject({ status: "accepted" });
  expect(await rpc(socket, PRESENCE_METHODS.report, { ...source, sequence: 2,
    lastInput: { sequence: 1, kind: "keyboard", ageMs: 0 } })).toMatchObject({ status: "accepted" });
}

describe("Patterns through unmodified production Core entry", () => {
  it.each([false, true])("authors, confirms, wakes and preserves no-replay across restart (presence required: %s)", async (withPresence) => {
    await scenario(async (s) => {
      if (withPresence) await reportFreshInput(s.socket());
      expect((await sayToAgent(s.socket(), "请帮我设置当前时段的简短回顾习惯。")).status).toBe("complete");
      const candidate = (await patterns(s.socket()))[0];
      expect(candidate?.candidateRevision?.origin.kind).toBe("agent");
      expect(candidate?.state).toBe("proposed");
      expect(heartbeatRows(s.dataDir)).toHaveLength(0);
      if (!candidate) throw new Error("primary tool did not produce a candidate");
      await confirm(s.socket(), candidate);
      await expect.poll(() => heartbeatRows(s.dataDir), { timeout: 20_000 }).toMatchObject([{ state: "completed" }]);
      const runId = String(heartbeatRows(s.dataDir)[0]?.run_id);
      expect((await fetchTimelineEntries(s.socket(), "taki")).filter((entry) => entry.content === SPEECH)).toHaveLength(1);
      const trajectory = TrajectoryResultSchema.parse(await rpc(s.socket(), OBSERVABILITY_METHODS.trajectory,
        { characterId: "taki", runKey: runId, limit: 200 }));
      expect(trajectory.run.modelRequestCount).toBe(1);
      expect(trajectory.rows.some((row) => row.phase === "delivery")).toBe(true);
      const policy = InitiativeWakePolicyStatusSchema.parse(await rpc(s.socket(), INITIATIVE_WAKE_METHODS.read, { characterId: "taki" }));
      expect(policy.recent.some((fact) => fact.reason === "admitted")).toBe(true);
      const before = s.requestCount();
      await s.restart();
      await set(s.socket(), "TAKI_INITIATIVE_ENABLED", false);
      await expect.poll(async () => InitiativeWakePolicyStatusSchema.parse(await rpc(s.socket(), INITIATIVE_WAKE_METHODS.read,
        { characterId: "taki" })).cursor, { timeout: 8_000 }).toBeGreaterThan(policy.cursor);
      await set(s.socket(), "TAKI_INITIATIVE_ENABLED", true);
      await expect.poll(async () => InitiativeWakePolicyStatusSchema.parse(await rpc(s.socket(), INITIATIVE_WAKE_METHODS.read,
        { characterId: "taki" })).recent.at(0)?.reason, { timeout: 8_000 }).toBe("model-cadence");
      expect(s.requestCount()).toBe(before);
      expect(heartbeatRows(s.dataDir)).toHaveLength(1);
      expect(TrajectoryResultSchema.parse(await rpc(s.socket(), OBSERVABILITY_METHODS.trajectory,
        { characterId: "taki", runKey: runId, limit: 200 })).rows).toEqual(trajectory.rows);
      expect(s.providerErrors()).toEqual([]);
    }, withPresence);
  });

  it("refuses missing source, invalid target and quiet hours without model work; installs the real authoring Skill", async () => {
    await scenario(async (s) => {
      const setup = InitiativeSetupStatusSchema.parse(await rpc(s.socket(), INITIATIVE_SETUP_METHODS.read, { characterId: "taki" }));
      expect(setup).toMatchObject({ targetReady: true, sources: { activityAvailable: false, presence: "unknown" }, skill: { state: "missing" } });
      expect(await rpc(s.socket(), INITIATIVE_SETUP_METHODS.installSkill, { characterId: "taki" }))
        .toMatchObject({ status: "installed", setup: { skill: { state: "ready" } } });
      const rules: InteractionPatternDefinition[] = [definition(), { ...definition(), title: "应用停留",
        conditions: { all: [{ kind: "application_in_set", applications: ["editor.exe"] }, { kind: "activity_dwell_at_least", minutes: 1 }] } }];
      await set(s.socket(), "TAKI_INITIATIVE_TARGET_CHARACTER", "missing-character");
      for (const rule of rules) {
        const proposed = InteractionPatternMutationResultSchema.parse(await rpc(s.socket(), INTERACTION_PATTERN_METHODS.propose,
          { characterId: "taki", commandId: randomUUID(), patternId: null, expectedVersion: 0, definition: rule }));
        if (proposed.status === "refused") throw new Error(proposed.reason);
        await confirm(s.socket(), proposed.pattern);
      }
      await expect.poll(async () => InitiativeWakePolicyStatusSchema.parse(await rpc(s.socket(), INITIATIVE_WAKE_METHODS.read,
        { characterId: "missing-character" })).recent.map((fact) => fact.reason)).toContain("no-target");
      const hour = new Date().getUTCHours();
      await set(s.socket(), "TAKI_INITIATIVE_QUIET_START", `${String((hour + 23) % 24).padStart(2, "0")}:00`);
      await set(s.socket(), "TAKI_INITIATIVE_QUIET_END", `${String((hour + 1) % 24).padStart(2, "0")}:00`);
      await set(s.socket(), "TAKI_INITIATIVE_TARGET_CHARACTER", "taki");
      await expect.poll(async () => InitiativeWakePolicyStatusSchema.parse(await rpc(s.socket(), INITIATIVE_WAKE_METHODS.read,
        { characterId: "taki" })).recent.map((fact) => fact.reason)).toContain("quiet-hours");
      await set(s.socket(), "TAKI_INITIATIVE_PERIODIC_ENABLED", false);
      await set(s.socket(), "TAKI_INITIATIVE_EVENTS_ENABLED", false);
      await set(s.socket(), "TAKI_INITIATIVE_QUIET_START", "00:00");
      await set(s.socket(), "TAKI_INITIATIVE_QUIET_END", "00:00");
      await expect.poll(async () => InitiativeWakePolicyStatusSchema.parse(await rpc(s.socket(), INITIATIVE_WAKE_METHODS.read,
        { characterId: "taki" })).recent.map((fact) => fact.reason)).toContain("wake-disabled");
      const clock = (await patterns(s.socket())).find((pattern) => pattern.effectiveRevision?.definition.title === "当前时段回顾");
      if (!clock) throw new Error("missing clock Pattern");
      await rpc(s.socket(), INTERACTION_PATTERN_METHODS.changeState, { characterId: "taki", commandId: randomUUID(),
        patternId: clock.patternId, expectedVersion: clock.version, action: "pause" });
      await set(s.socket(), "TAKI_INITIATIVE_EVENTS_ENABLED", true);
      await expect.poll(async () => InitiativeWakePolicyStatusSchema.parse(await rpc(s.socket(), INITIATIVE_WAKE_METHODS.read,
        { characterId: "taki" })).recent.map((fact) => fact.reason)).toContain("missing-source");
      expect(s.requestCount()).toBe(0);
      expect(heartbeatRows(s.dataDir)).toHaveLength(0);
    });
  });
});

async function scenario(run: (s: { dataDir: string; socket(): RpcSocket; restart(): Promise<void>;
  requestCount(): number; providerErrors(): readonly Error[] }) => Promise<void>, withPresence = false) {
  const root = mkdtempSync(join(tmpdir(), "taki-pattern-e2e-"));
  const dataDir = join(root, "core"); mkdirSync(dataDir);
  seedCanonicalLocal(dataDir);
  const provider = await startScriptedProvider((request, index) => reply(request, index, withPresence));
  let process: InitiativeProcess | undefined;
  let socket: RpcSocket | undefined;
  const start = async () => {
    process = await startInitiativeProcess({ dataDir, providerBaseUrl: provider.baseUrl, productionEntry: true,
      settings: { TAKI_MONITOR_MODE: "FEEDBACK_ONLY", TAKI_INITIATIVE_CHECK_INTERVAL_MS: "1000" } });
    socket = await openRpcSocket(process.wsUrl);
    ConnectResultSchema.parse(await rpc(socket, "connect", { deviceId: randomUUID(), deviceName: "Pattern E2E", role: "operator" }));
    await rpc(socket, TIMELINE_METHODS.subscribe, { characterId: "taki" });
  };
  try {
    await start();
    if (!socket) throw new Error("socket unavailable");
    const timezone = UserTimezoneReadResultSchema.parse(await rpc(socket, USER_TIMEZONE_METHODS.read, {})).state;
    await rpc(socket, USER_TIMEZONE_METHODS.update, { expectedRevision: timezone.revision, mode: "fixed", timezone: "UTC" });
    await set(socket, "TAKI_INITIATIVE_QUIET_START", "00:00"); await set(socket, "TAKI_INITIATIVE_QUIET_END", "00:00");
    await set(socket, "TAKI_INITIATIVE_TARGET_CHARACTER", "taki"); await set(socket, "TAKI_INITIATIVE_ENABLED", true);
    await run({ dataDir, socket: () => { if (!socket) throw new Error("closed socket"); return socket; },
      requestCount: () => provider.requests.length, providerErrors: () => provider.errors,
      restart: async () => { socket?.close(); await process?.close(); await start(); } });
  } finally {
    socket?.close(); await process?.close(); await provider.close();
    removeFixture(root);
  }
}

function removeFixture(root: string): void {
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes("taki-pattern-e2e-")) throw new Error("unsafe fixture root");
  rmSync(root, { recursive: true, force: true });
}

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  AVATAR_METHODS, AvatarCommandSchema, ConnectResultSchema, HeartbeatDecisionSchema,
  InitiativeSelectedContextSchema, JsonRpcSuccessResponseSchema, OBSERVABILITY_METHODS,
  RUN_METHODS, RunStatusResultSchema, TIMELINE_METHODS, TrajectoryResultSchema,
  USER_TIMEZONE_METHODS, UserTimezoneReadResultSchema, UserTimezoneMutationResultSchema,
  PRESENCE_METHODS, PresenceReportResultSchema, PresenceSnapshotSchema,
  type HeartbeatDecision,
} from "@taki/shared";
import { describe, expect, it } from "vitest";
import { startInitiativeProcess, type InitiativeProcess } from "./fixture/initiative-process.ts";
import { fetchTimelineEntries, sayToAgent } from "./fixture/operator-drivers.ts";
import { openRpcSocket, type RpcSocket } from "./fixture/rpc-socket.ts";
import { killTree } from "./fixture/procs.ts";
import { seedCanonicalLocal } from "./fixture/seed-canonical-memory.ts";
import { seedTimeline } from "./fixture/seed-timeline.ts";
import { startScriptedProvider, type ScriptedProvider, type ScriptedReply } from "./fixture/scripted-provider.ts";

const HISTORY = "initiative-e2e-history-must-not-enter-autonomous-request";
const PRIVATE = "initiative-e2e-intermediate-prose-must-not-be-published";
const CONTROL = "initiative-e2e-trusted-selected-control";
const CANDIDATE = "e2e-offered-candidate";
const SPEECH = "A complete independently eligible companion utterance.";
const PRESENTATION = { kind: "expression" as const, name: "smile" };

interface Scenario {
  readonly process: InitiativeProcess;
  provider: ScriptedProvider;
  dataDir: string;
  operator: RpcSocket;
  connect(): Promise<RpcSocket>;
  restart(crash?: boolean): Promise<RpcSocket>;
  logs(): string;
}

describe("initiative through the real Core composition", () => {
  it("keeps autonomous dispatch disabled until explicitly enabled", async () => {
    await withScenario(() => responseFor(decisionFor("silent")), async (scenario) => {
      const opportunity = await selectedOpportunity(scenario);
      expect(await scenario.process.command({ action: "dispatch", opportunity })).toMatchObject({ status: "refused", reason: "disabled" });
      expect(scenario.provider.requests).toHaveLength(0);
      expect(countRuns(scenario.dataDir)).toBe(0);
    }, { TAKI_INITIATIVE_ENABLED: "false" });
  });

  it.each(["silent", "express", "speak"] as const)("settles %s through one actual Agent request and the existing Monitor", async (outcome) => {
    const decision = decisionFor(outcome);
    await withScenario(() => responseFor(decision), async (scenario) => {
      await readyPet(scenario.operator);
      const opportunity = await selectedOpportunity(scenario);
      const applied = outcome === "express" ? applyNextAvatar(scenario.operator) : Promise.resolve();
      const [value] = await Promise.all([scenario.process.command({ action: "dispatch", opportunity }), applied]);
      const receipt = admitted(value);
      expect(receipt.status).toBe("settled");
      const status = await runStatus(scenario.operator, receipt.runId);
      expect(status.run, JSON.stringify({ receipt: status.receipt, attempts: status.attempts,
        requests: scenario.provider.requests.length, providerErrors: scenario.provider.errors.map((error) => error.message) }))
        .toMatchObject({ state: "completed", initiator: "heartbeat", deliveryClass: "class_b" });
      expect(status.attempts).toHaveLength(1);
      expect(status.run.activeAttemptId).toBe(receipt.attemptId);
      expect(scenario.provider.requests).toHaveLength(1);
      const request = scenario.provider.requests[0];
      expect(JSON.stringify(request)).toContain(CONTROL);
      expect(JSON.stringify(request)).not.toContain(HISTORY);
      const advertised = JSON.stringify(request?.tools);
      expect(advertised).toContain("heartbeat_respond");
      expect(advertised).not.toMatch(/"(?:write_file|exec|screenshot|avatar_set_expression)"/);
      const additions = (await fetchTimelineEntries(scenario.operator, "taki")).slice(2);
      expect(additions.map((entry) => entry.content)).toEqual(outcome === "speak" ? [SPEECH] : []);
      expect(additions.every((entry) => entry.role === "assistant")).toBe(true);
      const trajectory = await inspectRun(scenario.operator, receipt.runId);
      expect(trajectory.run.modelRequestCount).toBe(1);
      expect(trajectory.rows.some((row) => row.phase === "delivery")).toBe(true);
      expect(trajectory.cursor.seq).toBeGreaterThan(0);
      expect(readSnapshot(scenario.dataDir, receipt.runId)).not.toContain(CONTROL);
      expect(readSnapshot(scenario.dataDir, receipt.runId)).not.toContain(PRIVATE);
      expect(scenario.logs()).not.toContain(PRIVATE);
      expect(scenario.logs()).not.toContain(CONTROL);

      // A duplicate source occurrence cannot create another model request or ordinary Timeline utterance.
      const duplicate = admitted(await scenario.process.command({ action: "dispatch", opportunity }));
      expect(duplicate.runId).toBe(receipt.runId);
      expect(scenario.provider.requests).toHaveLength(1);
      expect(await fetchTimelineEntries(scenario.operator, "taki")).toHaveLength(2 + additions.length);
      const reopened = await scenario.restart();
      expect((await inspectRun(reopened, receipt.runId)).rows).toEqual(trajectory.rows);
      expect(scenario.provider.requests).toHaveLength(1);
    });
  });

  it("holds executable presentation without owning the lane and resumes the same Attempt without the model", async () => {
    await withScenario(() => responseFor(decisionFor("express")), async (scenario) => {
      await readyPet(scenario.operator);
      const opportunity = await selectedOpportunity(scenario);
      const held = admitted(await scenario.process.command({ action: "dispatch", opportunity, gate: "hold" }));
      expect(held.status).toBe("held");
      expect((await runStatus(scenario.operator, held.runId)).run.state).toBe("waiting");
      expect(await scenario.process.command({ action: "background-probe" })).toEqual({ acquired: true });
      expect(scenario.operator.notifications().filter((note) => note.method === AVATAR_METHODS.command)).toHaveLength(0);
      await scenario.process.command({ action: "facts", opportunityId: opportunity.opportunityId, gate: "ready" });
      const [value] = await Promise.all([
        scenario.process.command({ action: "resume", runId: held.runId }), applyNextAvatar(scenario.operator),
      ]);
      expect(value).toBe("settled");
      const final = await runStatus(scenario.operator, held.runId);
      expect(final.run.state).toBe("completed");
      expect(final.run.activeAttemptId).toBe(held.attemptId);
      expect(final.attempts).toHaveLength(1);
      expect(scenario.provider.requests).toHaveLength(1);
      expect(await fetchTimelineEntries(scenario.operator, "taki")).toHaveLength(2);
      const replay = await inspectRun(scenario.operator, held.runId);
      expect(replay.rows.filter((row) => row.phase === "delivery").length).toBeGreaterThan(1);
    });
  });

  it("suppresses a held result when its original source is invalidated", async () => {
    const decision = { ...decisionFor("speak"), presentation: PRESENTATION };
    await withScenario(() => responseFor(HeartbeatDecisionSchema.parse(decision)), async (scenario) => {
      await readyPet(scenario.operator);
      const opportunity = await selectedOpportunity(scenario);
      const held = admitted(await scenario.process.command({ action: "dispatch", opportunity, gate: "hold" }));
      expect(held.status).toBe("held");
      await scenario.process.command({ action: "facts", opportunityId: opportunity.opportunityId, current: false, gate: "ready" });
      await scenario.process.command({ action: "resume", runId: held.runId });
      const final = await runStatus(scenario.operator, held.runId);
      expect(final.run.operationPhase).toBe("terminal");
      expect(final.run.state).not.toBe("completed");
      expect(scenario.provider.requests).toHaveLength(1);
      expect(await fetchTimelineEntries(scenario.operator, "taki")).toHaveLength(2);
      expect(scenario.operator.notifications().filter((note) => note.method === AVATAR_METHODS.command)).toHaveLength(0);
    });
  });

  it("does not infer completed presentation from a terminal model Effect after a held-Run crash", async () => {
    await withScenario(() => responseFor(decisionFor("express")), async (scenario) => {
      await readyPet(scenario.operator);
      const opportunity = await selectedOpportunity(scenario);
      const held = admitted(await scenario.process.command({ action: "dispatch", opportunity, gate: "hold" }));
      expect(held.status).toBe("held");
      expect((await runStatus(scenario.operator, held.runId)).run.state).toBe("waiting");
      const reopened = await scenario.restart(true);
      const recovered = await runStatus(reopened, held.runId);
      expect(recovered.run.state).toBe("failed");
      expect(recovered.run.activeAttemptId).toBe(held.attemptId);
      expect(recovered.attempts).toHaveLength(1);
      expect(await scenario.process.command({ action: "resume", runId: held.runId })).toBe("refused");
      expect(scenario.provider.requests).toHaveLength(1);
      expect(await fetchTimelineEntries(reopened, "taki")).toHaveLength(2);
      expect(reopened.notifications().filter((note) => note.method === AVATAR_METHODS.command)).toHaveLength(0);
      expect((await inspectRun(reopened, held.runId)).rows.some((row) => row.phase === "delivery")).toBe(true);
    });
  });

  it("refuses stale, expired and primary-reserved opportunities before Run or model admission", async () => {
    await withScenario(() => responseFor(decisionFor("silent")), async (scenario) => {
      const stale = await selectedOpportunity(scenario);
      expect(await scenario.process.command({ action: "dispatch", opportunity: stale, current: false })).toMatchObject({ status: "refused" });
      const expired = await selectedOpportunity(scenario);
      expired.selectedContext.manifest.capturedAt = new Date(Date.now() - 120_000).toISOString();
      expired.selectedContext.manifest.expiresAt = new Date(Date.now() - 60_000).toISOString();
      expect(await scenario.process.command({ action: "dispatch", opportunity: expired })).toMatchObject({ status: "refused" });
      await scenario.process.command({ action: "primary-reserve", reservationId: "pending-primary" });
      const busy = await selectedOpportunity(scenario);
      expect(await scenario.process.command({ action: "dispatch", opportunity: busy })).toMatchObject({ status: "refused", reason: "busy" });
      await scenario.process.command({ action: "primary-cancel", reservationId: "pending-primary" });
      expect(await scenario.process.command({ action: "background-probe" })).toEqual({ acquired: true });
      expect(scenario.provider.requests).toHaveLength(0);
      expect(countRuns(scenario.dataDir)).toBe(0);
    });
  });

  it("counts silent model opportunities independently from speech and keeps the budget across restart", async () => {
    await withScenario((_request, index) => responseFor(decisionFor(index === 0 ? "silent" : "speak")), async (scenario) => {
      const first = await selectedOpportunity(scenario);
      const silent = admitted(await scenario.process.command({ action: "dispatch", opportunity: first }));
      expect((await runStatus(scenario.operator, silent.runId)).run.state).toBe("completed");
      expect(await fetchTimelineEntries(scenario.operator, "taki")).toHaveLength(2);
      const second = admitted(await scenario.process.command({ action: "dispatch", opportunity: await selectedOpportunity(scenario) }));
      expect((await runStatus(scenario.operator, second.runId)).run.state).toBe("completed");
      expect((await fetchTimelineEntries(scenario.operator, "taki")).slice(2).map((entry) => entry.content)).toEqual([SPEECH]);
      const denied = await selectedOpportunity(scenario);
      expect(await scenario.process.command({ action: "dispatch", opportunity: denied })).toMatchObject({ status: "refused", reason: "budget" });
      expect(countRuns(scenario.dataDir)).toBe(2);
      const reopened = await scenario.restart();
      const fresh = await selectedOpportunity({ ...scenario, operator: reopened });
      expect(await scenario.process.command({ action: "dispatch", opportunity: fresh })).toMatchObject({ status: "refused", reason: "budget" });
      expect(admitted(await scenario.process.command({ action: "dispatch", opportunity: first })).runId).toBe(silent.runId);
      expect(scenario.provider.requests).toHaveLength(2);
      expect(countRuns(scenario.dataDir)).toBe(2);
    }, { TAKI_INITIATIVE_MODEL_HOUR_LIMIT: "2", TAKI_INITIATIVE_UTTERANCE_HOUR_LIMIT: "1" });
  });

  it.each(["TAKI_INITIATIVE_OUTPUT_TTL_MS", "TAKI_INITIATIVE_BUSY_MAX_WAIT_MS"])(
    "expires held presentation at the configured %s boundary without model replay", async (setting) => {
      await withScenario(() => responseFor(decisionFor("express")), async (scenario) => {
        await readyPet(scenario.operator);
        const opportunity = await selectedOpportunity(scenario);
        const held = admitted(await scenario.process.command({ action: "dispatch", opportunity, gate: "hold" }));
        expect(held.status).toBe("held");
        await expect.poll(async () => (await runStatus(scenario.operator, held.runId)).run.state,
          { timeout: 5_000 }).toBe("cancelled");
        await scenario.process.command({ action: "facts", opportunityId: opportunity.opportunityId, gate: "ready" });
        expect(await scenario.process.command({ action: "resume", runId: held.runId })).toBe("refused");
        expect(scenario.provider.requests).toHaveLength(1);
        expect(await fetchTimelineEntries(scenario.operator, "taki")).toHaveLength(2);
        expect(scenario.operator.notifications().filter((note) => note.method === AVATAR_METHODS.command)).toHaveLength(0);
        expect(await scenario.process.command({ action: "background-probe" })).toEqual({ acquired: true });
      }, { [setting]: "200" });
    },
  );

  it("fences both admission and held presentation after a real operator timezone update", async () => {
    await withScenario(() => responseFor(decisionFor("express")), async (scenario) => {
      await readyPet(scenario.operator);
      const stale = await selectedOpportunity(scenario);
      await changeTimezone(scenario.operator);
      expect(await scenario.process.command({ action: "dispatch", opportunity: stale })).toMatchObject({ status: "refused", reason: "stale" });
      expect(countRuns(scenario.dataDir)).toBe(0);
      expect(scenario.provider.requests).toHaveLength(0);
      const current = await selectedOpportunity(scenario);
      const held = admitted(await scenario.process.command({ action: "dispatch", opportunity: current, gate: "hold" }));
      expect(held.status).toBe("held");
      await changeTimezone(scenario.operator);
      await scenario.process.command({ action: "facts", opportunityId: current.opportunityId, gate: "ready" });
      expect(await scenario.process.command({ action: "resume", runId: held.runId })).toBe("refused");
      const final = await runStatus(scenario.operator, held.runId);
      expect(final.run.state).toBe("cancelled");
      expect(final.run.activeAttemptId).toBe(held.attemptId);
      expect(scenario.provider.requests).toHaveLength(1);
      expect(await fetchTimelineEntries(scenario.operator, "taki")).toHaveLength(2);
      expect(scenario.operator.notifications().filter((note) => note.method === AVATAR_METHODS.command)).toHaveLength(0);
    });
  });

  it("records operator presentation and a real primary reply in the same initiative Monitor across restart", async () => {
    await withScenario((_request, index) => index === 0 ? responseFor(decisionFor("speak")) : { text: "You are welcome." }, async (scenario) => {
      const initial = { sourceId: randomUUID(), sequence: 1, surface: "chat", state: "active", visible: true,
        focused: false, observedAgeMs: 0, lastInput: null };
      const report = async (params: unknown) => PresenceReportResultSchema.parse(JsonRpcSuccessResponseSchema.parse(
        await scenario.operator.request(PRESENCE_METHODS.report, params)).result);
      expect(await report(initial)).toMatchObject({ status: "accepted" });
      expect(await report({ ...initial, sequence: 2, lastInput: { sequence: 1, kind: "keyboard", ageMs: 0 } })).toMatchObject({ status: "accepted" });
      expect(scenario.provider.requests).toHaveLength(0);
      const receipt = admitted(await scenario.process.command({ action: "dispatch", opportunity: await selectedOpportunity(scenario) }));
      const entry = (await fetchTimelineEntries(scenario.operator, "taki")).find((row) => row.content === SPEECH);
      expect(entry).toBeDefined();
      // This exercises the real authenticated report path. It does not certify native rendering or human reading.
      const presentation = PresenceReportResultSchema.parse(JsonRpcSuccessResponseSchema.parse(
        await scenario.operator.request(PRESENCE_METHODS.presentationReport, { sourceId: initial.sourceId,
          sequence: 3, observedAgeMs: 0, characterId: "taki", timelineSeq: entry!.seq, exposed: true })).result);
      expect(presentation.status).toBe("accepted");
      expect((await inspectRun(scenario.operator, receipt.runId)).rows.some((row) => row.label === "消息已呈现")).toBe(true);
      expect(scenario.provider.requests).toHaveLength(1);
      expect(await sayToAgent(scenario.operator, "Thanks for checking in.")).toMatchObject({ status: "complete" });
      const before = await inspectRun(scenario.operator, receipt.runId);
      expect(before.rows.filter((row) => row.label === "回应机会观察已结算")).toEqual([
        expect.objectContaining({ summary: "观察到后续互动" }),
      ]);
      const reopened = await scenario.restart(true);
      expect((await inspectRun(reopened, receipt.runId)).rows).toEqual(before.rows);
      expect(PresenceSnapshotSchema.parse(JsonRpcSuccessResponseSchema.parse(
        await reopened.request(PRESENCE_METHODS.read, {})).result)).toMatchObject({ state: "unknown", sourceCount: 0 });
    });
  });

  it("keeps independent operator sources and refuses buffered source reports after a Core restart", async () => {
    await withScenario(() => ({ text: "No model should be called." }), async (scenario) => {
      const second = await scenario.connect();
      const source = { sourceId: randomUUID(), sequence: 1, surface: "phone", state: "active", visible: true,
        focused: false, observedAgeMs: 0, lastInput: null };
      const send = async (socket: RpcSocket, params: unknown) => PresenceReportResultSchema.parse(
        JsonRpcSuccessResponseSchema.parse(await socket.request(PRESENCE_METHODS.report, params)).result);
      expect(await send(scenario.operator, source)).toMatchObject({ status: "accepted" });
      const secondSource = { ...source, sourceId: randomUUID(), surface: "pet" };
      expect(await send(second, secondSource)).toMatchObject({ status: "accepted" });
      expect(await send(second, { ...secondSource, sequence: 2, lastInput: { sequence: 1, kind: "pointer", ageMs: 0 } })).toMatchObject({ status: "accepted" });
      scenario.operator.close();
      await expect.poll(async () => PresenceSnapshotSchema.parse(JsonRpcSuccessResponseSchema.parse(
        await second.request(PRESENCE_METHODS.read, {})).result), { timeout: 5_000 }).toMatchObject({ state: "present", sourceCount: 1 });
      const reopened = await scenario.restart(true);
      expect(await send(reopened, { ...secondSource, sequence: 3, lastInput: { sequence: 1, kind: "pointer", ageMs: 0 } }))
        .toMatchObject({ status: "refused", reason: "stale-source" });
      expect(await send(reopened, { ...source, sourceId: randomUUID() })).toMatchObject({ status: "accepted" });
      expect(PresenceSnapshotSchema.parse(JsonRpcSuccessResponseSchema.parse(
        await reopened.request(PRESENCE_METHODS.read, {})).result)).toMatchObject({ state: "unknown", sourceCount: 1, nativePresence: "unknown" });
      expect(scenario.provider.requests).toHaveLength(0);
    });
  });

  it.each(["missing", "unoffered", "conflicting"] as const)("fails quietly for a %s structural decision", async (kind) => {
    await withScenario((_request, index) => {
      if (index > 0 || kind === "missing") return { text: PRIVATE };
      const first = kind === "unoffered"
        ? { ...decisionFor("speak"), selectedCandidateIds: ["not-an-offered-candidate"] }
        : decisionFor("speak");
      return { text: PRIVATE, calls: [
        { name: "heartbeat_respond", arguments: decisionInput(first) },
        ...(kind === "conflicting" ? [{ name: "heartbeat_respond", arguments: decisionInput(decisionFor("silent")) }] : []),
      ] };
    }, async (scenario) => {
      const opportunity = await selectedOpportunity(scenario);
      const receipt = admitted(await scenario.process.command({ action: "dispatch", opportunity }));
      expect((await runStatus(scenario.operator, receipt.runId)).run.state).toBe("failed");
      expect(await fetchTimelineEntries(scenario.operator, "taki")).toHaveLength(2);
      expect(scenario.logs()).not.toContain(PRIVATE);
    });
  });
});

function decisionFor(outcome: "silent" | "express" | "speak"): HeartbeatDecision {
  if (outcome === "silent") return { outcome, selectedCandidateIds: [] };
  if (outcome === "express") return { outcome, selectedCandidateIds: [CANDIDATE], presentation: PRESENTATION };
  return { outcome, selectedCandidateIds: [CANDIDATE], text: SPEECH, presentation: null, responseExpectation: "invitation" };
}

function responseFor(decision: HeartbeatDecision): ScriptedReply {
  return { text: PRIVATE, calls: [{ name: "heartbeat_respond", arguments: decisionInput(decision) }] };
}

async function selectedOpportunity(scenario: Scenario) {
  const primaryVersion = await scenario.process.command({ action: "primary-version" });
  const timezone = UserTimezoneReadResultSchema.parse(JsonRpcSuccessResponseSchema.parse(
    await scenario.operator.request(USER_TIMEZONE_METHODS.read, {})).result);
  return { opportunityId: randomUUID(), characterId: "taki", selectedContext: InitiativeSelectedContextSchema.parse({
    instructions: "Use heartbeat_respond for the offered independently eligible test opportunity.",
    controlInput: CONTROL, candidateIds: [CANDIDATE], allowedToolNames: ["heartbeat_respond"],
    manifest: { version: "initiative-context.v1", profile: "initiative-thin", capturedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(), policyRevision: "e2e-policy-v1", primaryVersion,
      timezoneRevision: timezone.state.revision,
      sources: [{ category: "pattern", reference: CANDIDATE, revision: "1", trust: "core" }], accountingQuality: "unknown" },
  }) };
}

function admitted(value: unknown) {
  const receipt = value as Record<string, unknown>;
  if (!receipt || typeof receipt.runId !== "string" || typeof receipt.attemptId !== "string") {
    throw new Error(`expected admitted initiative result: ${JSON.stringify(value)}`);
  }
  return { runId: receipt.runId, attemptId: receipt.attemptId, status: receipt.status };
}

async function runStatus(socket: RpcSocket, runId: string) {
  return RunStatusResultSchema.parse(JsonRpcSuccessResponseSchema.parse(await socket.request(RUN_METHODS.status, { runId })).result);
}

async function changeTimezone(socket: RpcSocket): Promise<void> {
  const current = UserTimezoneReadResultSchema.parse(JsonRpcSuccessResponseSchema.parse(
    await socket.request(USER_TIMEZONE_METHODS.read, {})).result).state;
  const result = UserTimezoneMutationResultSchema.parse(JsonRpcSuccessResponseSchema.parse(
    await socket.request(USER_TIMEZONE_METHODS.update, { expectedRevision: current.revision, mode: "fixed",
      timezone: current.timezone === "UTC" ? "Asia/Tokyo" : "UTC" })).result);
  expect(result).toMatchObject({ status: "accepted", state: { revision: current.revision + 1 } });
}

async function inspectRun(socket: RpcSocket, runId: string) {
  return TrajectoryResultSchema.parse(JsonRpcSuccessResponseSchema.parse(await socket.request(OBSERVABILITY_METHODS.trajectory,
    { characterId: "taki", runKey: runId, limit: 200 })).result);
}

function readSnapshot(dataDir: string, runId: string): string {
  const db = new DatabaseSync(join(dataDir, "taki.db"), { readOnly: true });
  try {
    const manifest = db.prepare("SELECT manifest_json FROM run_snapshots WHERE run_id=?").get(runId)?.manifest_json;
    if (typeof manifest !== "string") throw new Error("missing durable Run snapshot");
    return manifest;
  }
  finally { db.close(); }
}

function countRuns(dataDir: string): number {
  const db = new DatabaseSync(join(dataDir, "taki.db"), { readOnly: true });
  try { return Number(db.prepare("SELECT count(*) AS n FROM runs").get()?.n); }
  finally { db.close(); }
}

async function readyPet(socket: RpcSocket): Promise<void> {
  JsonRpcSuccessResponseSchema.parse(await socket.request(AVATAR_METHODS.report, { characterId: "taki", expressions: ["smile"], motions: [] }));
  JsonRpcSuccessResponseSchema.parse(await socket.request(AVATAR_METHODS.subscribe, { characterId: "taki" }));
}

async function applyNextAvatar(socket: RpcSocket): Promise<void> {
  const note = await socket.waitForNotification((candidate) => candidate.method === AVATAR_METHODS.command, 20_000);
  const command = AvatarCommandSchema.parse(note.params);
  expect(command).toMatchObject({ characterId: "taki", ...PRESENTATION });
  JsonRpcSuccessResponseSchema.parse(await socket.request(AVATAR_METHODS.outcome,
    { characterId: "taki", commandId: command.commandId, outcome: "applied" }));
}

async function withScenario(
  reply: (request: Record<string, unknown>, index: number) => ScriptedReply,
  run: (scenario: Scenario) => Promise<void>,
  settings: Record<string, string> = {},
): Promise<void> {
  const evidenceRoot = process.env.TAKI_E2E_EVIDENCE_DIR
    ? resolve(process.env.TAKI_E2E_EVIDENCE_DIR, "initiative-runtime") : undefined;
  const fixtureParent = evidenceRoot ?? resolve(tmpdir());
  if (evidenceRoot) mkdirSync(evidenceRoot, { recursive: true });
  const fixtureRoot = mkdtempSync(join(fixtureParent, "taki-initiative-runtime-"));
  const dataDir = join(fixtureRoot, "core");
  let provider: ScriptedProvider | undefined;
  const processes: InitiativeProcess[] = [];
  const sockets: RpcSocket[] = [];
  const scenarioName = expect.getState().currentTestName;
  const startedAt = new Date().toISOString();
  let failure: { error: unknown } | undefined;
  const cleanupErrors: unknown[] = [];
  let current: InitiativeProcess;
  const start = async () => {
    if (!provider) throw new Error("missing scenario provider");
    current = await startInitiativeProcess({ dataDir, providerBaseUrl: provider.baseUrl,
      settings: { TAKI_INITIATIVE_ENABLED: "true", TAKI_MONITOR_MODE: "FULL_LOCAL", ...settings } });
    processes.push(current);
  };
  const connect = async () => {
    const socket = await openRpcSocket(current.wsUrl);
    sockets.push(socket);
    expect(ConnectResultSchema.parse(JsonRpcSuccessResponseSchema.parse(await socket.request("connect", {
      deviceId: randomUUID(), deviceName: "initiative-e2e", role: "operator", capabilities: [],
    })).result).status).toBe("ok");
    JsonRpcSuccessResponseSchema.parse(await socket.request(TIMELINE_METHODS.subscribe, { characterId: "taki" }));
    return socket;
  };
  try {
    provider = await startScriptedProvider(reply);
    mkdirSync(dataDir);
    seedCanonicalLocal(dataDir);
    seedTimeline(dataDir, [{ role: "user", content: HISTORY }, { role: "assistant", content: "Ordinary previous reply." }]);
    await start();
    await run({ get process() { return current; }, dataDir, provider, operator: await connect(), connect,
      logs: () => processes.flatMap((instance) => instance.core.stdout.lines()).join("\n"),
      restart: async (crash = false) => {
        for (const socket of sockets.splice(0)) socket.close();
        if (crash) {
          // Kill only this fixture-owned process so recovery sees its unclean durable waiting state.
          killTree(current.core);
          await current.core.exited;
        } else {
          await current.close();
          expect(current.core.child.exitCode).toBe(0);
        }
        await start();
        return connect();
      },
    });
    expect(provider.errors).toEqual([]);
  } catch (error) {
    failure = { error };
  } finally {
    if (evidenceRoot) {
      try {
        writeFileSync(join(fixtureRoot, "before-teardown.json"), JSON.stringify({ scenarioName, startedAt,
          observedAt: new Date().toISOString(), outcome: failure ? "failed" : "passed",
          failure: failure ? diagnosticError(failure.error) : null, providerRequests: provider?.requests.length ?? null,
          providerErrors: provider?.errors.map(diagnosticError) ?? [], runtime: runtimeEvidence(dataDir) }, null, 2));
      } catch (error) { cleanupErrors.push(error); }
    }
    for (const socket of sockets) {
      try { socket.close(); } catch (error) { cleanupErrors.push(error); }
    }
    for (const instance of processes) {
      try { await instance.close(); } catch (error) { cleanupErrors.push(error); }
    }
    try { await provider?.close(); } catch (error) { cleanupErrors.push(error); }
    if (evidenceRoot) {
      try {
        writeFileSync(join(fixtureRoot, "process-output.json"), JSON.stringify(processes.map((instance) => ({
          pid: instance.core.child.pid, exitCode: instance.core.child.exitCode, signalCode: instance.core.child.signalCode,
          stdout: instance.core.stdout.lines().slice(-500).map((line) => line.slice(0, 4000)),
          stderr: instance.core.stderr.lines().slice(-500).map((line) => line.slice(0, 4000)),
        })), null, 2));
        writeFileSync(join(fixtureRoot, "teardown.json"), JSON.stringify({ errors: cleanupErrors.map(diagnosticError),
          closedAt: new Date().toISOString(), providerRequests: provider?.requests.length ?? null }, null, 2));
      } catch (error) { cleanupErrors.push(error); }
    } else {
      try {
        expect(dirname(fixtureRoot)).toBe(fixtureParent);
        rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch (error) { cleanupErrors.push(error); }
    }
  }
  if (cleanupErrors.length) throw new AggregateError([...failure ? [failure.error] : [], ...cleanupErrors], "Initiative scenario or evidence cleanup failed");
  if (failure) throw failure.error;
}

function diagnosticError(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message.slice(0, 4000),
    stack: error.stack?.split("\n").slice(0, 12).join("\n") } : { name: "NonError", message: String(error).slice(0, 4000) };
}

function runtimeEvidence(dataDir: string): unknown {
  const path = join(dataDir, "taki.db");
  if (!existsSync(path)) return { status: "database_not_created" };
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return { status: "available", tables: Object.fromEntries([
      "runs", "run_attempts", "run_effects", "run_events", "run_deliveries", "initiative_model_opportunities",
    ].map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid LIMIT 200`).all()])) };
  } catch (error) { return { status: "read_failed", error: diagnosticError(error) }; }
  finally { db.close(); }
}

function decisionInput(decision: HeartbeatDecision) {
  return { text: null, presentation: null, responseExpectation: null, ...decision };
}

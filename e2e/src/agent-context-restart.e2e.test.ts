import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { ConnectResultSchema, JsonRpcSuccessResponseSchema, SUBAGENT_METHODS, TIMELINE_METHODS,
  SubagentControlResultSchema, SubagentHistoryResultSchema, SubagentListResultSchema, type SubagentSummary } from "@taki/shared";
import { CORE_DIR } from "./fixture/paths.ts";
import { startInitiativeProcess, type InitiativeProcess } from "./fixture/initiative-process.ts";
import { openRpcSocket, type RpcSocket } from "./fixture/rpc-socket.ts";
import { sayToAgent } from "./fixture/operator-drivers.ts";
import { seedCanonicalLocal } from "./fixture/seed-canonical-memory.ts";
import { startScriptedProvider, type ScriptedReply } from "./fixture/scripted-provider.ts";
import { killTree } from "./fixture/procs.ts";
import { deliveredInboxEvents } from "./fixture/agent-context-inbox.ts";

const MARKERS = { A: "RECOVERY_A_FOCUS_745", B: "RECOVERY_B_FOCUS_293" } as const;
const PENDING = "PRIVATE_PENDING_ACROSS_RESTART_631";
const TABLES = ["runs", "run_effects", "subagent_conversations", "subagent_inputs", "subagent_executions",
  "run_messages", "timeline_messages", "run_usage", "subagent_events", "subagent_inbox_consumers",
  "subagent_inbox_deliveries", "subagent_event_actions", "subagent_speech_publications"] as const;

it("preserves private controls and truthful orphan results across two actual production Core restarts", async () => {
  const evidenceRoot = process.env.TAKI_E2E_EVIDENCE_DIR ?? join(tmpdir(), "taki-restart-evidence");
  mkdirSync(evidenceRoot, { recursive: true });
  const evidenceDir = mkdtempSync(join(evidenceRoot, "production-restart-"));
  const dataDir = join(evidenceDir, "data");
  mkdirSync(dataDir);
  const sourceBefore = sourceManifest();
  const childRequests = { A: 0, B: 0 };
  const holds = new Map<string, () => void>();
  const pids: number[] = [];
  const phases: string[] = [];
  let delegated = false;
  let requestBudgetExceeded = false;
  let core: InitiativeProcess | undefined;
  let socket: RpcSocket | undefined;
  let failed = true;
  let deadlineExpired = false;
  const provider = await startScriptedProvider(async (request, index): Promise<ScriptedReply> => {
    if (index >= 12) { requestBudgetExceeded = true; throw new Error("restart fixture request budget exceeded"); }
    if (hasTool(request, "complete_subagent")) {
      const body = JSON.stringify(request.messages);
      const key = body.includes(MARKERS.A) ? "A" : body.includes(MARKERS.B) ? "B" : undefined;
      if (!key) throw new Error("unknown private recovery request");
      childRequests[key] += 1;
      if (childRequests[key] === 1) {
        await new Promise<void>((done) => holds.set(key, done));
        return { text: "The initial request was interrupted by the real process/control lifecycle." };
      }
      expect(childRequests[key]).toBe(2);
      if (key === "A") expect(body).toContain(PENDING);
      return { calls: [{ name: "complete_subagent", arguments: {
        text: key === "A" ? `${MARKERS.A} ${PENDING}` : MARKERS.B, materials: [],
      } }] };
    }
    expect(deliveredInboxEvents(request)).toEqual([]);
    expect(hasTool(request, "delegate_subagent")).toBe(true);
    if (delegated) return { text: "Recovery probe completed without delegating or resuming work." };
    delegated = true;
    return { calls: (["A", "B"] as const).map((key) => ({ name: "delegate_subagent", arguments: {
      label: `Recovery child ${key}`, subagentId: null, direction: `Return ${MARKERS[key]} with complete_subagent.`,
      context: { kind: "fresh" }, completionPolicy: "record_only",
      toolSelection: { mode: "allow", names: ["complete_subagent"] }, materials: [],
    } })) };
  });
  const write = (name: string, value: unknown) => writeFileSync(join(evidenceDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  const rows = (table: typeof TABLES[number]) => {
    const db = new DatabaseSync(join(dataDir, "taki.db"), { readOnly: true });
    try { return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(); }
    finally { db.close(); }
  };
  const snapshot = () => existsSync(join(dataDir, "taki.db")) ? Object.fromEntries(TABLES.map((table) => [table, rows(table)])) : {};
  const checkpoint = (phase: string, detail?: unknown) => {
    phases.push(phase);
    write(`phase-${phases.length}.json`, { phase, detail, pids, state: snapshot(), requests: provider.requests, childRequests });
  };
  const currentSocket = () => { if (!socket) throw new Error("restart socket is absent"); return socket; };
  const rpc = async (method: string, params: unknown) => JsonRpcSuccessResponseSchema.parse(await currentSocket().request(method, params)).result;
  const list = async () => SubagentListResultSchema.parse(await rpc(SUBAGENT_METHODS.list, { characterId: "taki", limit: 100 })).entries;
  const history = async (subagentId: string) => SubagentHistoryResultSchema.parse(await rpc(SUBAGENT_METHODS.history,
    { characterId: "taki", subagentId, limit: 100 }));
  const boot = async () => {
    core = await startInitiativeProcess({ dataDir, providerBaseUrl: provider.baseUrl, productionEntry: true,
      settings: { TAKI_PROVIDER_MODEL: "scripted-restart-fixture", TAKI_MAX_STEPS: "6",
        TAKI_MONITOR_MODE: "FULL_LOCAL", TAKI_INITIATIVE_ENABLED: "false" } });
    const pid = core.core.child.pid;
    if (!pid) throw new Error("missing actual Core PID");
    pids.push(pid);
    socket = await openRpcSocket(core.wsUrl);
    ConnectResultSchema.parse(await rpc("connect", { deviceId: randomUUID(), deviceName: "Restart acceptance", role: "operator" }));
    await rpc(TIMELINE_METHODS.subscribe, { characterId: "taki" });
    await rpc(SUBAGENT_METHODS.subscribe, {});
  };
  const kill = async () => {
    const victim = core;
    if (!victim) throw new Error("missing Core to interrupt");
    socket?.close(); socket = undefined;
    killTree(victim.core);
    await expect.poll(() => victim.core.child.exitCode !== null || victim.core.child.signalCode !== null, { timeout: 10_000 }).toBe(true);
    await victim.core.exited;
    core = undefined;
  };
  const probe = async () => {
    const before = provider.requests.length;
    const counts = { ...childRequests };
    expect((await sayToAgent(currentSocket(), "检查服务可用即可，不创建、继续或修改任何子代理工作。", 30_000)).status).toBe("complete");
    expect(provider.requests.length).toBe(before + 1);
    expect(childRequests).toEqual(counts);
  };
  const timer = setTimeout(() => {
    deadlineExpired = true;
    socket?.close();
    if (core) killTree(core.core);
    for (const release of holds.values()) release();
  }, 150_000);
  try {
    write("baseline.json", { node: process.version, source: sourceBefore, requestCap: 12, deadlineMs: 150_000,
      scope: "Production Core process kill/restart with Local synthetic state and scripted HTTP; no external model or non-model Host effects." });
    seedCanonicalLocal(dataDir);
    await boot();
    expect((await sayToAgent(currentSocket(), "创建两个隔离的私有子代理恢复测试工作。", 30_000)).status).toBe("complete");
    await expect.poll(() => childRequests, { timeout: 15_000 }).toEqual({ A: 1, B: 1 });
    const children = await list();
    const a = children.find((entry) => entry.label === "Recovery child A");
    const b = children.find((entry) => entry.label === "Recovery child B");
    if (!a?.activeRunId || !b?.activeRunId) throw new Error("both actual child Runs must be active");
    const originalA = a.activeRunId;
    const originalB = b.activeRunId;
    expect(rows("run_effects").some((row) => row.run_id === originalB && row.kind === "model" && row.state !== "terminal")).toBe(true);
    SubagentControlResultSchema.parse(await rpc(SUBAGENT_METHODS.stop, { characterId: "taki", target: targetFor(a) }));
    await expect.poll(async () => (await history(a.subagentId)).conversation.activeRunId, { timeout: 15_000 }).toBeNull();
    const stopped = (await history(a.subagentId)).conversation;
    const sent = SubagentControlResultSchema.parse(await rpc(SUBAGENT_METHODS.send, { characterId: "taki",
      target: targetFor(stopped), operationKey: randomUUID(), direction: PENDING, materials: [] }));
    if (!sent.input) throw new Error("pending input was not accepted");
    const beforeRestartA = await history(a.subagentId);
    expect(beforeRestartA.inputs.find((input) => input.inputId === sent.input?.inputId)?.consumed).toBeNull();
    checkpoint("before-first-kill", { originalA, originalB, pendingInputId: sent.input.inputId });

    await kill();
    for (const release of holds.values()) release();
    const requestsBeforeRestart = provider.requests.length;
    await boot();
    expect(provider.requests.length).toBe(requestsBeforeRestart);
    const restoredA = await history(a.subagentId);
    const restoredB = await history(b.subagentId);
    expect(restoredA.conversation).toMatchObject({ stopOrigin: "user", activeRunId: null,
      controlVersion: beforeRestartA.conversation.controlVersion });
    expect(restoredA.inputs).toEqual(beforeRestartA.inputs);
    expect(restoredA.results).toHaveLength(1);
    expect(restoredA.results[0]?.result.child).toMatchObject({ runId: originalA, outcome: "cancelled" });
    expect(restoredB.conversation.activeRunId).toBeNull();
    expect(restoredB.results).toHaveLength(1);
    expect(restoredB.results[0]?.result.child).toMatchObject({ runId: originalB, outcome: "outcome_unknown" });
    expect(rows("run_effects").some((row) => row.run_id === originalB && row.kind === "model"
      && row.state === "terminal" && row.outcome === "outcome_unknown")).toBe(true);
    await probe();
    checkpoint("first-restart-no-replay", { restoredA, restoredB });

    for (const child of [restoredA.conversation, restoredB.conversation]) {
      SubagentControlResultSchema.parse(await rpc(SUBAGENT_METHODS.continue, { characterId: "taki",
        target: targetFor(child), operationKey: randomUUID(), direction: "Explicit user continuation after restart.", materials: [] }));
      await expect.poll(async () => (await history(child.subagentId)).results.some((result) => result.result.child.outcome === "completed"),
        { timeout: 15_000 }).toBe(true);
    }
    const completedA = await history(a.subagentId);
    const completedB = await history(b.subagentId);
    expect(completedA.inputs.find((input) => input.inputId === sent.input?.inputId)?.consumed?.runId).not.toBe(originalA);
    expect(completedA.inputs.find((input) => input.inputId === sent.input?.inputId)?.consumed?.effectId).toEqual(expect.any(String));
    for (const item of [completedA, completedB]) {
      expect(item.results).toHaveLength(2);
      expect(new Set(item.executions.map((execution) => execution.runId)).size).toBe(2);
      expect(item.results.every((result) => result.result.parentRunId === null)).toBe(true);
    }
    expect(completedA.results.find((result) => result.result.child.runId === originalA)?.result.child.outcome).toBe("cancelled");
    expect(completedB.results.find((result) => result.result.child.runId === originalB)?.result.child.outcome).toBe("outcome_unknown");
    expect(rows("timeline_messages").some((row) => String(row.content).includes(PENDING))).toBe(false);
    const retainedExecutions = rows("subagent_executions");
    checkpoint("explicit-continue-new-runs", { completedA, completedB });

    await kill();
    const requestsBeforeSecondRestart = provider.requests.length;
    await boot();
    expect(provider.requests.length).toBe(requestsBeforeSecondRestart);
    await probe();
    expect(rows("subagent_executions")).toEqual(retainedExecutions);
    expect(childRequests).toEqual({ A: 2, B: 2 });
    expect(rows("subagent_inbox_consumers")).toHaveLength(0);
    expect(rows("subagent_inbox_deliveries")).toHaveLength(0);
    expect(rows("subagent_event_actions")).toHaveLength(0);
    expect(rows("subagent_speech_publications")).toHaveLength(0);
    expect(new Set(pids).size).toBe(3);
    expect(provider.errors).toEqual([]);
    checkpoint("second-restart-idempotent");
    failed = false;
  } finally {
    clearTimeout(timer);
    for (const release of holds.values()) release();
    const cleanup = await Promise.allSettled([Promise.resolve().then(() => socket?.close()),
      Promise.resolve().then(() => core?.close()), provider.close()]);
    const cleanupFailed = cleanup.some((result) => result.status === "rejected");
    let evidenceValid: boolean;
    try {
      const sourceAfter = sourceManifest();
      const sourceUnchanged = JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter);
      write("result.json", { status: failed || cleanupFailed || !sourceUnchanged || deadlineExpired || requestBudgetExceeded ? "failed" : "passed",
        phases, pids, childRequests, requests: provider.requests, state: snapshot(), cleanupFailed,
        sourceUnchanged, sourceAfter, deadlineExpired, requestBudgetExceeded, physicalExternalModelRequests: 0 });
      evidenceValid = sourceUnchanged && !deadlineExpired && !requestBudgetExceeded;
    } catch { evidenceValid = false; }
    if (!failed) expect({ cleanupFailed, evidenceValid }).toEqual({ cleanupFailed: false, evidenceValid: true });
  }
}, 210_000);

function targetFor(child: SubagentSummary) {
  const workInputId = child.activeWorkInputId ?? child.latestWorkInputId;
  if (!workInputId) throw new Error("missing actual work identity");
  return { subagentId: child.subagentId, workInputId, expectedControlVersion: child.controlVersion, expectedRunId: child.activeRunId };
}
function hasTool(request: Record<string, unknown>, name: string) {
  return Array.isArray(request.tools) && request.tools.some((tool: unknown) => !!tool && typeof tool === "object"
    && "function" in tool && !!tool.function && typeof tool.function === "object" && "name" in tool.function && tool.function.name === name);
}
function sourceManifest() {
  const root = resolve(CORE_DIR, "../..");
  const files = ["package.json", "pnpm-lock.yaml", "packages/core/package.json", "packages/shared/package.json", "e2e/package.json"];
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const fullPath = join(path, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(relative(root, fullPath).replaceAll("\\", "/"));
    }
  };
  for (const path of ["packages/core/src", "packages/shared/src", "e2e/src"]) visit(join(root, path));
  return Object.fromEntries(files.sort().map((path) => [path, createHash("sha256").update(readFileSync(join(root, path))).digest("hex")]));
}

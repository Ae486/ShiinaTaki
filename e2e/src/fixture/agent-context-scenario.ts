/**
 * INPUT: explicitly opted-in real provider, synthetic seeds and a finite scenario request budget
 * OUTPUT: isolated production Core/RPC, exact outgoing requests and durable per-phase evidence
 * POS: e2e/fixture — test-owned state only; lifecycle and permission decisions remain in production Core
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseEnv } from "node:util";
import { ConnectResultSchema, JsonRpcSuccessResponseSchema, SUBAGENT_METHODS,
  SubagentListResultSchema, SubagentHistoryResultSchema, TIMELINE_METHODS } from "@taki/shared";
import { CORE_DIR, realProviderEnv } from "./paths.ts";
import { startInitiativeProcess, type InitiativeProcess } from "./initiative-process.ts";
import { openRpcSocket, type RpcSocket } from "./rpc-socket.ts";
import { fetchTimelineEntries, sayToAgent, type AgentTurn } from "./operator-drivers.ts";
import { observeRealProvider, type SyntheticProviderRequest } from "./real-provider-observer.ts";
import { seedCanonicalLocal } from "./seed-canonical-memory.ts";

const ROOT = resolve(CORE_DIR, "../..");
const EFFECTS_SQL = `SELECT effect_id,run_id,attempt_id,kind,state,input_digest,source_ref_json,
  started_at,settled_at,outcome,error_code FROM run_effects ORDER BY created_at,effect_id`;
const TABLES = ["subagent_conversations", "subagent_inputs", "subagent_executions", "run_messages",
  "timeline_messages", "run_usage", "canonical_memory_sources", "canonical_memory_units",
  "canonical_memory_policy", "canonical_memory_operation_receipts", "canonical_memory_primary_commits"] as const;

export const realAgentContextEnabled = process.env.TAKI_E2E_REAL_AGENT_CONTEXT === "1" && realProviderEnv() !== null;

export interface AgentContextScenario {
  readonly dataDir: string;
  readonly evidenceDir: string;
  readonly wsUrl: string;
  readonly requests: readonly SyntheticProviderRequest[];
  readonly socket: RpcSocket;
  ask(prompt: string): Promise<AgentTurn>;
  rpc(method: string, params: unknown): Promise<unknown>;
  list(): Promise<ReturnType<typeof SubagentListResultSchema.parse>>;
  history(subagentId: string): Promise<ReturnType<typeof SubagentHistoryResultSchema.parse>>;
  rows(sql: string): Record<string, unknown>[];
  checkpoint(phase: string, detail?: unknown): void;
}

interface ScenarioInput {
  name: string;
  maxUpstreamRequests: number;
  blocks?: { globalUserCard?: string; characterIndex?: string };
  seed?(dataDir: string): void;
  /** Optional test-owned transport timing; production Core still sends its ordinary HTTP requests. */
  transport?(baseUrl: string, evidenceDir: string): Promise<{ baseUrl: string; close(): Promise<void> }>;
}

export async function withAgentContextScenario(input: ScenarioInput, exercise: (scenario: AgentContextScenario) => Promise<void>): Promise<void> {
  const provider = realProviderEnv();
  if (!realAgentContextEnabled || !provider) throw new Error("agent context real-model acceptance requires explicit opt-in and provider configuration");
  await runScenario({ ...input, provider, evidenceKind: "real-provider-with-isolated-synthetic-data" }, exercise);
}

export async function withScriptedAgentContextScenario(input: ScenarioInput & {
  providerBaseUrl: string; evidenceRoot: string;
}, exercise: (scenario: AgentContextScenario) => Promise<void>): Promise<void> {
  const endpoint = new URL(input.providerBaseUrl);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1") throw new Error("scripted provider must be a loopback fixture");
  await runScenario({ ...input, provider: { TAKI_PROVIDER_BASE_URL: input.providerBaseUrl,
    TAKI_PROVIDER_API_KEY: "scripted-context-fixture", TAKI_PROVIDER_MODEL: "scripted-context-fixture" },
  evidenceKind: "scripted-provider-with-production-core" }, exercise);
}

async function runScenario(input: ScenarioInput & { provider: Record<string, string>; evidenceKind: string; evidenceRoot?: string },
  exercise: (scenario: AgentContextScenario) => Promise<void>): Promise<void> {
  const provider = input.provider;
  if (!/^[a-z0-9-]+$/.test(input.name)) throw new Error("invalid agent context scenario name");
  const artifactRoot = input.evidenceRoot ?? process.env.TAKI_E2E_EVIDENCE_DIR;
  if (!artifactRoot) throw new Error("agent context acceptance requires TAKI_E2E_EVIDENCE_DIR");
  const directory = resolve(artifactRoot);
  mkdirSync(directory, { recursive: true });
  const evidenceDir = mkdtempSync(join(directory, `${input.name}-`));
  const dataDir = join(evidenceDir, "data");
  mkdirSync(dataDir);
  const requests: SyntheticProviderRequest[] = [];
  const turns: Array<{ prompt: string; status: AgentTurn["status"]; text: string }> = [];
  const phases: Array<{ phase: string; at: string }> = [];
  let core: InitiativeProcess | undefined;
  let socket: RpcSocket | undefined;
  let relay: Awaited<ReturnType<typeof observeRealProvider>> | undefined;
  let transport: Awaited<ReturnType<NonNullable<ScenarioInput["transport"]>>> | undefined;
  let failed = true;
  let deadlineExpired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const startedAt = new Date().toISOString();
  const baseline = sourceManifest();
  const settings: Record<string, string> = { ...provider, ...modelTuning(), TAKI_MAX_STEPS: "6", TAKI_PROVIDER_INCLUDE_USAGE: "true",
    TAKI_MONITOR_MODE: "FULL_LOCAL", TAKI_INITIATIVE_ENABLED: "false" };
  const write = (name: string, value: unknown) => writeFileSync(join(evidenceDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  const checkpoint = (phase: string, detail?: unknown) => {
    phases.push({ phase, at: new Date().toISOString() });
    write(`phase-${phases.length}.json`, { phase, detail, state: databaseEvidence(dataDir), requests: relay?.requests ?? [], turns });
  };
  try {
    write("baseline.json", { name: input.name, startedAt, source: baseline, node: process.version,
      requestedModel: provider.TAKI_PROVIDER_MODEL, maxUpstreamRequests: input.maxUpstreamRequests,
      maxSteps: 6, sessionDeadlineMs: 240_000, contextTokens: settings.TAKI_PROVIDER_CONTEXT_TOKENS ?? null,
      evidenceKind: input.evidenceKind });
    seedCanonicalLocal(dataDir, input.blocks);
    input.seed?.(dataDir);
    transport = await input.transport?.(provider.TAKI_PROVIDER_BASE_URL!, evidenceDir);
    relay = await observeRealProvider({ baseUrl: transport?.baseUrl ?? provider.TAKI_PROVIDER_BASE_URL!, apiKey: provider.TAKI_PROVIDER_API_KEY!,
      syntheticCapture: { maxUpstreamRequests: input.maxUpstreamRequests, onRequest(request) {
        requests.push(request);
        // These candidates are a concurrent observation, not an invented exact Effect/request correlation.
        write(`request-${request.requestNumber}.json`, { ...request,
          effectsAtRequest: readRows(dataDir, EFFECTS_SQL),
          executionsAtRequest: readRows(dataDir, "SELECT run_id,subagent_id,work_input_id,parent_run_id FROM subagent_executions") });
      } } });
    core = await startInitiativeProcess({ dataDir, providerBaseUrl: relay.baseUrl, productionEntry: true, settings });
    timer = setTimeout(() => {
      deadlineExpired = true;
      void Promise.allSettled([Promise.resolve().then(() => relay?.close()), Promise.resolve().then(() => transport?.close()),
        Promise.resolve().then(() => core?.close())]);
    }, 240_000);
    socket = await openRpcSocket(core.wsUrl);
    const connection = socket;
    const rpc = async (method: string, params: unknown) => {
      if (deadlineExpired) throw new Error("agent context scenario deadline exceeded");
      return JsonRpcSuccessResponseSchema.parse(await connection.request(method, params)).result;
    };
    ConnectResultSchema.parse(await rpc("connect", { deviceId: randomUUID(), deviceName: "Agent context acceptance", role: "operator" }));
    await rpc(TIMELINE_METHODS.subscribe, { characterId: "taki" });
    await rpc(SUBAGENT_METHODS.subscribe, {});
    checkpoint("ready");
    await exercise({ dataDir, evidenceDir, wsUrl: core.wsUrl, requests, socket: connection, rpc, checkpoint,
      rows: (sql) => readRows(dataDir, sql),
      list: async () => SubagentListResultSchema.parse(await rpc(SUBAGENT_METHODS.list, { characterId: "taki", limit: 100 })),
      history: async (subagentId) => SubagentHistoryResultSchema.parse(await rpc(SUBAGENT_METHODS.history,
        { characterId: "taki", subagentId, limit: 100 })),
      ask: async (prompt) => {
        const result = await sayToAgent(connection, prompt, 180_000);
        turns.push({ prompt, status: result.status, text: result.text });
        checkpoint("chat-ended", { status: result.status, timeline: await fetchTimelineEntries(connection, "taki") });
        if (result.status !== "complete") throw new Error("agent context chat failed; consult retained phase evidence");
        return result;
      },
    });
    checkpoint("exercise-passed");
    failed = false;
  } finally {
    clearTimeout(timer);
    // Preserve failed scenarios and their already-spent requests; each close runs even when another fails.
    await finishScenario({ failed, close: [() => socket?.close(), () => core?.close(), () => relay?.close(), () => transport?.close()],
      save(cleanupFailed) {
        const finalSource = sourceManifest();
        const sourceUnchanged = JSON.stringify(baseline) === JSON.stringify(finalSource);
        const requestEvidenceFailed = relay?.requests.some((request) =>
          request.error === "request-budget-exhausted" || request.error === "capture-failed") ?? false;
        write("result.json", { name: input.name, startedAt, finishedAt: new Date().toISOString(),
          evidenceKind: input.evidenceKind,
          status: failed || cleanupFailed || !sourceUnchanged || deadlineExpired || requestEvidenceFailed ? "failed" : "passed",
          cleanupFailed, sourceUnchanged, deadlineExpired, requestEvidenceFailed,
          phases, requestedModel: provider.TAKI_PROVIDER_MODEL, requests: relay?.requests ?? [], turns,
          state: databaseEvidence(dataDir), sourceAfter: finalSource });
        return sourceUnchanged && !deadlineExpired && !requestEvidenceFailed;
      } });
  }
}

async function finishScenario(input: {
  failed: boolean;
  close: Array<() => void | Promise<void> | undefined>;
  save(cleanupFailed: boolean): boolean;
}): Promise<void> {
  const closed = await Promise.allSettled(input.close.map((close) => Promise.resolve().then(close)));
  const cleanupFailed = closed.some((result) => result.status === "rejected");
  let evidenceValid: boolean;
  try { evidenceValid = input.save(cleanupFailed); }
  catch { evidenceValid = false; }
  if (!input.failed && (cleanupFailed || !evidenceValid)) {
    throw new Error("agent context scenario cleanup, evidence or source-stability check failed");
  }
}

function readRows(dataDir: string, sql: string): Record<string, unknown>[] {
  const database = new DatabaseSync(join(dataDir, "taki.db"), { readOnly: true });
  try { return database.prepare(sql).all(); }
  finally { database.close(); }
}

function databaseEvidence(dataDir: string): Record<string, unknown> {
  if (!existsSync(join(dataDir, "taki.db"))) return { available: false };
  return { available: true,
    runs: readRows(dataDir, "SELECT run_id,parent_run_id,initiator,state,outcome,active_attempt_id,queued_at,terminal_at FROM runs ORDER BY queued_at,run_id"),
    attempts: readRows(dataDir, "SELECT run_id,attempt_id,ordinal,state,outcome,provider,model_id,error_code FROM run_attempts ORDER BY run_id,ordinal"),
    effects: readRows(dataDir, EFFECTS_SQL),
    deliveries: readRows(dataDir, "SELECT run_id,delivery_class,state,decision_json,source_context_json FROM run_deliveries ORDER BY created_at"),
    ...Object.fromEntries(TABLES.map((table) => [table, readRows(dataDir, `SELECT * FROM ${table} ORDER BY rowid`)])),
  };
}

function modelTuning(): Record<string, string> {
  const path = process.env.TAKI_E2E_REAL_ENV_FILE;
  if (!path) return {};
  const values = parseEnv(readFileSync(resolve(path), "utf8"));
  const contextTokens = values.TAKI_PROVIDER_CONTEXT_TOKENS;
  return contextTokens ? { TAKI_PROVIDER_CONTEXT_TOKENS: contextTokens } : {};
}

function sourceManifest(): Record<string, string> {
  const files = ["package.json", "pnpm-lock.yaml", "packages/core/package.json", "packages/shared/package.json", "e2e/package.json"];
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = join(path, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(relative(ROOT, fullPath).replaceAll("\\", "/"));
    }
  };
  for (const directory of ["packages/core/src", "packages/shared/src", "e2e/src"]) visit(join(ROOT, directory));
  return Object.fromEntries(files.sort().map((path) => [path, createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex")]));
}

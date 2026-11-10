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
import { CONFIG_METHODS, ConfigListResultSchema, ConnectResultSchema, JsonRpcSuccessResponseSchema, SUBAGENT_METHODS,
  SubagentListResultSchema, SubagentHistoryResultSchema, TIMELINE_METHODS } from "@taki/shared";
import { CORE_DIR, realProviderEnv } from "./paths.ts";
import { startInitiativeProcess, type InitiativeProcess } from "./initiative-process.ts";
import { openRpcSocket, type RpcSocket } from "./rpc-socket.ts";
import { fetchTimelineEntries, sayToAgent, type AgentTurn } from "./operator-drivers.ts";
import { observeRealProvider, type ProviderObservation, type SyntheticProviderRequest } from "./real-provider-observer.ts";
import { seedCanonicalLocal } from "./seed-canonical-memory.ts";
import { startAgentContextNativeHost, type NativeAgentHost } from "./agent-context-native-host.ts";

const ROOT = resolve(CORE_DIR, "../..");
const EFFECTS_SQL = `SELECT effect_id,run_id,attempt_id,kind,state,input_digest,source_ref_json,
  started_at,settled_at,outcome,error_code FROM run_effects ORDER BY created_at,effect_id`;
const TABLES = ["subagent_conversations", "subagent_inputs", "subagent_executions", "run_messages",
  "subagent_events", "subagent_input_waits", "subagent_inbox_consumers", "subagent_inbox_members",
  "subagent_inbox_deliveries", "subagent_event_actions", "subagent_speech_publications",
  "subagent_context_summaries", "subagent_context_summary_intents", "subagent_context_summary_failures",
  "subagent_work_progress", "subagent_task_steps", "subagent_checkins", "subagent_user_attention",
  "timeline_messages", "run_usage", "canonical_memory_sources", "canonical_memory_units",
  "canonical_memory_policy", "canonical_memory_operation_receipts", "canonical_memory_primary_commits"] as const;

export const realAgentContextEnabled = process.env.TAKI_E2E_REAL_AGENT_CONTEXT === "1" && realProviderEnv() !== null;

export interface AgentContextScenario {
  readonly nativeHost?: NativeAgentHost;
  readonly dataDir: string;
  readonly evidenceDir: string;
  readonly wsUrl: string;
  readonly requestedModel: string;
  /** Loopback observation endpoint, never the upstream credential or Authorization header. */
  readonly providerBaseUrl: string;
  readonly requests: readonly SyntheticProviderRequest[];
  readonly observations: readonly ProviderObservation[];
  readonly socket: RpcSocket;
  /** Remaining time on the existing scenario deadline; reading it never extends the deadline. */
  remainingMs(): number;
  ask(prompt: string): Promise<AgentTurn>;
  rpc(method: string, params: unknown): Promise<unknown>;
  list(): Promise<ReturnType<typeof SubagentListResultSchema.parse>>;
  history(subagentId: string): Promise<ReturnType<typeof SubagentHistoryResultSchema.parse>>;
  rows(sql: string): Record<string, unknown>[];
  checkpoint(phase: string, detail?: unknown): void;
  effectiveSettings(): Promise<ReturnType<typeof ConfigListResultSchema.parse>>;
}

export interface ScenarioInput {
  /** Test-only exec Host with a hostname allowlist and a no-model native preflight. */
  nativeHost?: "exec";
  name: string;
  maxUpstreamRequests: number;
  blocks?: { globalUserCard?: string; characterIndex?: string };
  /** Historical schema for upgrade fixtures; the production Core still boots with its current migrations. */
  seedThroughMigration?: number;
  seed?(dataDir: string): void;
  sessionDeadlineMs?: number;
  turnDeadlineMs?: number;
  checkInSteps?: number;
  checkInParentApprovals?: number;
  contextTokens?: number;
  historyRatio?: number;
  compactKeepMessages?: number;
  /** null uses the production default; the older directed fixtures retain their explicit six-step main policy. */
  mainMaxSteps?: number | null;
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
  const sessionDeadlineMs = positiveInteger(input.sessionDeadlineMs ?? 240_000, "session deadline");
  const turnDeadlineMs = positiveInteger(input.turnDeadlineMs ?? 180_000, "turn deadline");
  positiveInteger(input.maxUpstreamRequests, "upstream request budget");
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
  let nativeHost: NativeAgentHost | undefined;
  let failed = true;
  let deadlineExpired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const startedAt = new Date().toISOString();
  const baseline = sourceManifest(input.nativeHost !== undefined);
  const settings: Record<string, string> = { ...provider, ...modelTuning(), TAKI_PROVIDER_INCLUDE_USAGE: "true",
    TAKI_MONITOR_MODE: "FULL_LOCAL", TAKI_INITIATIVE_ENABLED: "false" };
  if (input.nativeHost) settings.TAKI_DEV_TRIGGER = "1";
  if (input.mainMaxSteps !== null) settings.TAKI_MAX_STEPS = String(positiveInteger(input.mainMaxSteps ?? 6, "main step limit"));
  const scenarioSettings = explicitSettings(input);
  Object.assign(settings, scenarioSettings);
  const write = (name: string, value: unknown) => writeFileSync(join(evidenceDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  const checkpoint = (phase: string, detail?: unknown) => {
    nativeHost?.save();
    phases.push({ phase, at: new Date().toISOString() });
    write(`phase-${phases.length}.json`, { phase, detail, state: databaseEvidence(dataDir), requests: relay?.requests ?? [], turns });
  };
  try {
    write("baseline.json", { name: input.name, startedAt, source: baseline, node: process.version,
      requestedModel: provider.TAKI_PROVIDER_MODEL, maxUpstreamRequests: input.maxUpstreamRequests,
      requestedMainMaxSteps: input.mainMaxSteps === null ? "production-default" : input.mainMaxSteps ?? 6,
      sessionDeadlineMs, turnDeadlineMs, scenarioSettings,
      endpointHost: new URL(provider.TAKI_PROVIDER_BASE_URL!).hostname,
      contextTokens: settings.TAKI_PROVIDER_CONTEXT_TOKENS ?? null,
      evidenceKind: input.evidenceKind });
    seedCanonicalLocal(dataDir, input.blocks, input.seedThroughMigration);
    input.seed?.(dataDir);
    transport = await input.transport?.(provider.TAKI_PROVIDER_BASE_URL!, evidenceDir);
    relay = await observeRealProvider({ baseUrl: transport?.baseUrl ?? provider.TAKI_PROVIDER_BASE_URL!, apiKey: provider.TAKI_PROVIDER_API_KEY!,
      syntheticCapture: { maxUpstreamRequests: input.maxUpstreamRequests, onRequest(request) {
        requests.push(request);
        // These candidates are a concurrent observation, not an invented exact Effect/request correlation.
        write(`request-${request.requestNumber}.json`, { ...request, bodySha256: createHash("sha256").update(request.body).digest("hex"),
          effectsAtRequest: readRows(dataDir, EFFECTS_SQL),
          executionsAtRequest: readRows(dataDir, "SELECT run_id,subagent_id,work_input_id,parent_run_id FROM subagent_executions") });
      } } });
    core = await startInitiativeProcess({ dataDir, providerBaseUrl: relay.baseUrl, productionEntry: true, settings });
    const deadlineAt = performance.now() + sessionDeadlineMs;
    timer = setTimeout(() => {
      deadlineExpired = true;
      void Promise.allSettled([Promise.resolve().then(() => relay?.close()), Promise.resolve().then(() => transport?.close()),
        Promise.resolve().then(() => core?.close()), Promise.resolve().then(() => nativeHost?.close())]);
    }, sessionDeadlineMs);
    socket = await openRpcSocket(core.wsUrl);
    const connection = socket;
    const rpc = async (method: string, params: unknown) => {
      if (deadlineExpired) throw new Error("agent context scenario deadline exceeded");
      return JsonRpcSuccessResponseSchema.parse(await connection.request(method, params)).result;
    };
    ConnectResultSchema.parse(await rpc("connect", { deviceId: randomUUID(), deviceName: "Agent context acceptance", role: "operator" }));
    await rpc(TIMELINE_METHODS.subscribe, { characterId: "taki" });
    await rpc(SUBAGENT_METHODS.subscribe, {});
    if (input.nativeHost) nativeHost = await startAgentContextNativeHost({ core, socket: connection, evidenceDir });
    const effectiveSettings = async () => {
      const config = ConfigListResultSchema.parse(await rpc(CONFIG_METHODS.list, {}));
      return { entries: config.entries.filter((entry) => !entry.secret && (
        entry.key.startsWith("TAKI_SUBAGENT_CHECKIN_") || entry.key === "TAKI_MAX_STEPS"
        || entry.key === "TAKI_PROVIDER_CONTEXT_TOKENS" || entry.key === "TAKI_CONTEXT_HISTORY_RATIO"
        || entry.key === "TAKI_COMPACT_KEEP_MESSAGES" || entry.key === "TAKI_PROVIDER_INCLUDE_USAGE")) };
    };
    write("effective-settings.json", await effectiveSettings());
    checkpoint("ready", { corePid: core.core.child.pid });
    await exercise({ dataDir, evidenceDir, wsUrl: core.wsUrl, requestedModel: provider.TAKI_PROVIDER_MODEL!, providerBaseUrl: relay.baseUrl,
      requests, socket: connection, rpc, checkpoint, effectiveSettings,
      ...(nativeHost ? { nativeHost } : {}),
      remainingMs: () => Math.max(0, Math.ceil(deadlineAt - performance.now())),
      get observations() { return relay?.requests ?? []; },
      rows: (sql) => readRows(dataDir, sql),
      list: async () => SubagentListResultSchema.parse(await rpc(SUBAGENT_METHODS.list, { characterId: "taki", limit: 100 })),
      history: async (subagentId) => SubagentHistoryResultSchema.parse(await rpc(SUBAGENT_METHODS.history,
        { characterId: "taki", subagentId, limit: 100 })),
      ask: async (prompt) => {
        const result = await sayToAgent(connection, prompt, turnDeadlineMs);
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
    await finishScenario({ failed, close: [() => socket?.close(), () => nativeHost?.close(), () => core?.close(), () => relay?.close(), () => transport?.close()],
      save(cleanupFailed) {
        const finalSource = sourceManifest(input.nativeHost !== undefined);
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

function sourceManifest(nativeHost = false): Record<string, string> {
  const files = ["package.json", "pnpm-lock.yaml", "tsconfig.base.json", "packages/core/package.json",
    "packages/core/tsconfig.json", "packages/shared/package.json", "packages/shared/tsconfig.json", "e2e/package.json",
    "e2e/tsconfig.json", "e2e/vitest.config.ts"];
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = join(path, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) || (nativeHost && entry.name.endsWith(".rs"))) files.push(relative(ROOT, fullPath).replaceAll("\\", "/"));
    }
  };
  for (const directory of ["packages/core/src", "packages/shared/src", "e2e/src"]) visit(join(ROOT, directory));
  if (nativeHost) {
    visit(join(ROOT, "apps/desktop/src-tauri/src"));
    files.push("apps/desktop/src-tauri/Cargo.toml", "apps/desktop/src-tauri/Cargo.lock", "apps/desktop/src-tauri/build.rs", "apps/desktop/src-tauri/tauri.conf.json",
      `apps/desktop/src-tauri/target/debug/${process.platform === "win32" ? "taki-node.exe" : "taki-node"}`);
  }
  return Object.fromEntries(files.sort().map((path) => [path, createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex")]));
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid ${label}`);
  return value;
}

function explicitSettings(input: ScenarioInput): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const [key, value] of [["TAKI_SUBAGENT_CHECKIN_STEPS", input.checkInSteps],
    ["TAKI_PROVIDER_CONTEXT_TOKENS", input.contextTokens], ["TAKI_COMPACT_KEEP_MESSAGES", input.compactKeepMessages]] as const) {
    if (value !== undefined) settings[key] = String(positiveInteger(value, key));
  }
  if (input.checkInParentApprovals !== undefined) {
    if (!Number.isSafeInteger(input.checkInParentApprovals) || input.checkInParentApprovals < 0) throw new Error("invalid parent approval limit");
    settings.TAKI_SUBAGENT_CHECKIN_PARENT_APPROVALS = String(input.checkInParentApprovals);
  }
  if (input.historyRatio !== undefined) {
    if (!Number.isFinite(input.historyRatio) || input.historyRatio <= 0 || input.historyRatio > 1) throw new Error("invalid history ratio");
    settings.TAKI_CONTEXT_HISTORY_RATIO = String(input.historyRatio);
  }
  return settings;
}

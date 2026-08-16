/**
 * INPUT:  desired MCP server inputs (sanitized config + selected tools) + a logger + optional connect override
 *         (tests) + an optional catalog resolver for `secret-ref:` markers + governance deps + budgets
 * OUTPUT: createMcpManager(deps) -> McpManager — the runtime generation machine: reconcile/applyDesired
 *         (candidate -> atomic publish under lock, last-good retention), disable/remove/secretCleared (lease
 *         blocking + drain), test (diagnostics-only ephemeral candidate), statuses, tools(interactive), describe,
 *         close (stop publication -> cancel candidates -> bounded drain -> force close, idempotent)
 * POS:    core/mcp — plane 3 ONLY: generations/leases/outcomes live in memory and are never persisted; crash
 *         reconcile rebuilds exclusively from desired state; a failing server never disables its siblings
 */
import type {
  McpCandidateOutcome,
  McpServerConfig,
  McpServerStatus,
  McpTestResult,
  McpToolKeyCollision,
} from "@taki/shared";
import type { Logger } from "../logging/logger.ts";
import { MCP_SECRET_REF_MARKER } from "@taki/shared";
import { McpCandidateError, prepareCandidate, sanitizeCandidateFailure, type PreparedCandidate } from "./mcp-candidate.ts";
import { defaultConnect, type McpConnect } from "./mcp-connect.ts";
import {
  closeGeneration,
  makeGenerationRecord,
  retireGeneration,
  type GenerationRecord,
} from "./mcp-generations.ts";
import type { McpToolRef } from "./mcp-tool-identity.ts";
import { buildTurnTools, type TurnGovernance, type TurnInteractive } from "./mcp-turn-tools.ts";
import { deriveRuntimeStatuses } from "./mcp-runtime-status.ts";

/** One desired server as the runtime consumes it (from the repo, or an operator mutation in flight). */
export interface McpDesiredRuntime {
  serverId: string;
  config: McpServerConfig;
  selectedTools: string[];
  enabled: boolean;
}

export interface McpManager {
  /** Builds the aggregated ToolSet for one turn from the CURRENT generations; each execute holds a lease. */
  tools(interactive?: TurnInteractive): ReturnType<typeof buildTurnTools>;
  /** Maps a ToolSet key back to its raw identity plus stable subject binding. */
  describe(toolKey: string): McpToolRef | undefined;
  /** Boot/crash reconcile: desired state -> candidates -> publish; a disabled/withdrawn server drains. */
  reconcile(servers: McpDesiredRuntime[]): Promise<void>;
  /** Candidate + atomic publish (or truthful failure with last-good retention); never needs a restart. */
  applyDesired(input: McpDesiredRuntime): Promise<McpCandidateOutcome>;
  /** Blocks new leases on the owning generation, then drains/closes once (ordinary disable may drain). */
  disableServer(serverId: string): void;
  /** Disable semantics plus desired-tracking teardown (the repo row is already gone when this runs). */
  removeServer(serverId: string): void;
  /** A cleared catalog secret retires every generation whose config referenced it, truthfully. */
  secretCleared(ref: string): void;
  /** An ephemeral candidate with guaranteed close: diagnostics only, never publishes, never exposes tools. */
  test(input: { serverId: string; config: McpServerConfig; selectedTools: string[] }): Promise<McpTestResult>;
  /** Sanitized runtime status for every server the manager knows (the service merges desired truth). */
  statuses(): McpServerStatus[];
  /** Stop publication -> cancel candidates -> bounded drain -> force-close remaining; idempotent. */
  close(): Promise<void>;
}

export interface McpManagerDeps {
  logger: Logger;
  connect?: McpConnect;
  resolveSecret?: (ref: string) => string | null;
  governance?: TurnGovernance;
  /** Bounded drain deadline for a replaced/disabled generation before its remaining calls are force-closed. */
  drainBudgetMs?: number;
  /** Global shutdown drain budget before every remaining client is force-closed. */
  shutdownBudgetMs?: number;
  /** One bounded deadline covering connect + every listing page of one candidate. */
  candidateDeadlineMs?: number;
  now?: () => string;
}

const DEFAULT_DRAIN_BUDGET_MS = 5_000;
const DEFAULT_SHUTDOWN_BUDGET_MS = 5_000;
const DEFAULT_CANDIDATE_DEADLINE_MS = 8_000;

/** Per-server desired snapshot the manager tracks for status + secret-ref matching. */
export interface DesiredTracking {
  config: McpServerConfig;
  selectedTools: string[];
  enabled: boolean;
}

/** Plane-3 state every manager operation closes over (single-writer by construction; never persisted). */
interface ManagerState {
  log: Logger;
  connect: McpConnect;
  resolveSecret?: (ref: string) => string | null;
  governance?: TurnGovernance;
  drainBudgetMs: number;
  shutdownBudgetMs: number;
  candidateDeadlineMs: number;
  now: () => string;
  active: Map<string, GenerationRecord>;
  draining: Set<GenerationRecord>;
  outcomes: Map<string, McpCandidateOutcome>;
  connecting: Set<string>;
  desired: Map<string, DesiredTracking>;
  candidateControllers: Set<AbortController>;
  counter: { generation: number };
  closed: { value: boolean };
  chain: { promise: Promise<unknown> };
}

export function createMcpManager(deps: McpManagerDeps): McpManager {
  const state: ManagerState = {
    log: deps.logger.child({ mod: "mcp" }),
    connect: deps.connect ?? defaultConnect,
    resolveSecret: deps.resolveSecret,
    governance: deps.governance,
    drainBudgetMs: deps.drainBudgetMs ?? DEFAULT_DRAIN_BUDGET_MS,
    shutdownBudgetMs: deps.shutdownBudgetMs ?? DEFAULT_SHUTDOWN_BUDGET_MS,
    candidateDeadlineMs: deps.candidateDeadlineMs ?? DEFAULT_CANDIDATE_DEADLINE_MS,
    now: deps.now ?? (() => new Date().toISOString()),
    active: new Map(),
    draining: new Set(),
    outcomes: new Map(),
    connecting: new Set(),
    desired: new Map(),
    candidateControllers: new Set(),
    counter: { generation: 0 },
    closed: { value: false },
    chain: { promise: Promise.resolve() },
  };
  return {
    tools: (interactive) => buildTurnTools(state.active, state.governance, interactive),
    describe: (toolKey) => describeTool(state, toolKey),
    reconcile: (servers) => reconcileManager(state, servers),
    applyDesired: (input) => applyDesiredManager(state, input),
    disableServer: (serverId) => disableTracked(state, serverId),
    removeServer: (serverId) => removeTracked(state, serverId),
    secretCleared: (ref) => secretClearedManager(state, ref),
    test: (input) => testCandidate(state, input),
    statuses: () => deriveRuntimeStatuses(state),
    close: () => closeManager(state),
  };
}

function describeTool(state: ManagerState, toolKey: string): McpToolRef | undefined {
  for (const record of state.active.values()) {
    const ref = record.refs.get(toolKey);
    if (ref) return ref;
  }
  return undefined;
}

// One manager-wide publication lock: the candidate runs outside it; the swap is atomic inside it.
function underLock<T>(state: ManagerState, fn: () => Promise<T> | T): Promise<T> {
  const run = state.chain.promise.then(fn, fn);
  state.chain.promise = run.then(() => undefined, () => undefined);
  return run as Promise<T>;
}

function retire(state: ManagerState, record: GenerationRecord): void {
  state.draining.add(record);
  retireGeneration(record, state.drainBudgetMs);
}

function disconnectServer(state: ManagerState, serverId: string): void {
  const record = state.active.get(serverId);
  if (!record) return;
  state.active.delete(serverId);
  retire(state, record);
}

function disableTracked(state: ManagerState, serverId: string): void {
  const tracking = state.desired.get(serverId);
  if (tracking) state.desired.set(serverId, { ...tracking, enabled: false });
  disconnectServer(state, serverId);
}

function removeTracked(state: ManagerState, serverId: string): void {
  state.desired.delete(serverId);
  disconnectServer(state, serverId);
}

function runCandidate(state: ManagerState, input: { serverId: string; config: McpServerConfig; selectedTools: string[] }): Promise<PreparedCandidate> {
  const controller = new AbortController();
  state.candidateControllers.add(controller);
  return prepareCandidate({
    serverId: input.serverId,
    config: input.config,
    selectedTools: input.selectedTools,
    connect: state.connect,
    resolveSecret: state.resolveSecret,
    log: state.log,
    signal: controller.signal,
    deadlineMs: state.candidateDeadlineMs,
  }).finally(() => state.candidateControllers.delete(controller));
}

/** Keys this candidate would publish vs. every OTHER live server's published keys (serialized under the lock). */
function findCollisions(state: ManagerState, serverId: string, refs: ReadonlyMap<string, McpToolRef>): McpToolKeyCollision[] {
  const collisions: McpToolKeyCollision[] = [];
  for (const [key, ref] of refs) {
    for (const record of state.active.values()) {
      if (record.serverId === serverId) continue;
      const existing = record.refs.get(key);
      if (existing) collisions.push({ key, existingServerId: record.serverId, existingToolName: existing.toolName, candidateToolName: ref.toolName });
    }
  }
  return collisions;
}

function applyDesiredManager(state: ManagerState, input: McpDesiredRuntime): Promise<McpCandidateOutcome> {
  if (state.closed.value) {
    const failure = sanitizeCandidateFailure(new McpCandidateError("connect-failed", "manager is shutting down"));
    return Promise.resolve({ status: "failed", at: state.now(), reason: failure.reason, message: failure.boundedMessage });
  }
  return publishGeneration(state, input);
}

async function publishGeneration(state: ManagerState, input: McpDesiredRuntime): Promise<McpCandidateOutcome> {
  state.desired.set(input.serverId, { config: input.config, selectedTools: input.selectedTools, enabled: input.enabled });
  state.connecting.add(input.serverId);
  try {
    const prepared = await runCandidate(state, input);
    const record = await underLock(state, () => {
      const collisions = findCollisions(state, input.serverId, prepared.refs);
      if (collisions.length > 0) {
        void prepared.client.close().catch(() => undefined); // close the rejected candidate exactly once
        throw new McpCandidateError(
          "tool-key-collision",
          `candidate keys collide with published tools: ${collisions.map((collision) => collision.key).join(", ")}`,
          collisions,
        );
      }
      const previous = state.active.get(input.serverId);
      const next = makeGenerationRecord({
        serverId: input.serverId,
        generation: (state.counter.generation += 1),
        client: prepared.client,
        tools: prepared.tools,
        refs: prepared.refs,
      });
      state.active.set(input.serverId, next);
      if (previous) retire(state, previous); // last-good retention ends here: the replacement is live
      return next;
    });
    const outcome: McpCandidateOutcome = {
      status: "published",
      at: state.now(),
      runtimeGeneration: record.generation,
      toolNames: [...record.refs.values()].map((ref) => ref.toolName),
      skipped: prepared.skipped,
      pages: prepared.pages,
      durationMs: prepared.durationMs,
    };
    state.outcomes.set(input.serverId, outcome);
    state.log.info({ server: input.serverId, generation: record.generation, tools: record.refs.size, pages: prepared.pages }, "mcp generation published");
    return outcome;
  } catch (error) {
    const failure = sanitizeCandidateFailure(error);
    const outcome: McpCandidateOutcome = { status: "failed", at: state.now(), reason: failure.reason, message: failure.boundedMessage };
    if (error instanceof McpCandidateError && error.collisions) outcome.collisions = error.collisions;
    state.outcomes.set(input.serverId, outcome);
    // Sanitized diagnostics only: reason/message carry no config, markers, or secret material.
    state.log.warn({ server: input.serverId, reason: failure.reason, message: failure.boundedMessage }, "mcp candidate failed; last-good generation (if any) keeps serving");
    return outcome;
  } finally {
    state.connecting.delete(input.serverId);
  }
}

async function reconcileManager(state: ManagerState, servers: McpDesiredRuntime[]): Promise<void> {
  const keep = new Set(servers.map((server) => server.serverId));
  for (const server of servers) {
    state.desired.set(server.serverId, { config: server.config, selectedTools: server.selectedTools, enabled: server.enabled });
  }
  for (const [serverId, record] of [...state.active]) {
    if (keep.has(serverId)) continue;
    state.active.delete(serverId);
    state.desired.delete(serverId);
    retire(state, record); // crash/remove reconcile: desired truth withdrew this server
  }
  const results = await Promise.allSettled(servers.map(async (server) => {
    if (server.enabled) return publishGeneration(state, server);
    disconnectServer(state, server.serverId);
    return undefined;
  }));
  const published = results.filter((result) => result.status === "fulfilled" && result.value?.status === "published").length;
  const failed = results.filter((result) => result.status === "fulfilled" && result.value?.status === "failed").length;
  state.log.info({ servers: servers.length, published, failed }, "mcp reconcile from desired state complete");
}

function secretClearedManager(state: ManagerState, ref: string): void {
  const marker = `${MCP_SECRET_REF_MARKER}${ref}`;
  for (const [serverId, tracking] of [...state.desired]) {
    const map = "command" in tracking.config ? tracking.config.env : tracking.config.headers;
    if (!map || !Object.values(map).includes(marker)) continue;
    disconnectServer(state, serverId);
    state.outcomes.set(serverId, {
      status: "failed",
      at: state.now(),
      reason: "secret-unresolvable",
      message: `secret ${ref} was cleared; restore it and reconnect`,
    });
    state.log.warn({ server: serverId }, "mcp generation retired: a referenced secret was cleared");
  }
}

async function testCandidate(state: ManagerState, input: { serverId: string; config: McpServerConfig; selectedTools: string[] }): Promise<McpTestResult> {
  try {
    const prepared = await runCandidate(state, input);
    try {
      return {
        status: "ok" as const,
        toolNames: [...prepared.refs.values()].map((ref) => ref.toolName),
        skipped: prepared.skipped,
        pages: prepared.pages,
        durationMs: prepared.durationMs,
      };
    } finally {
      await prepared.client.close().catch(() => undefined); // a test candidate is ALWAYS closed
    }
  } catch (error) {
    const failure = sanitizeCandidateFailure(error);
    return { status: "failed" as const, reason: failure.reason, message: failure.boundedMessage, toolNames: [], skipped: [], pages: 0, durationMs: 0 };
  }
}

/** Shutdown order: stop publication (closed flag), cancel candidates, drain under one budget, force-close. */
async function closeManager(state: ManagerState): Promise<void> {
  if (state.closed.value) return;
  state.closed.value = true;
  for (const controller of state.candidateControllers) controller.abort();
  const records = [...state.active.values(), ...state.draining];
  for (const record of records) {
    state.active.delete(record.serverId);
    record.draining = true; // block new leases immediately
  }
  const deadline = Date.now() + state.shutdownBudgetMs;
  while (Date.now() < deadline && records.some((record) => !record.closed && record.leases > 0)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await Promise.allSettled(records.map((record) => closeGeneration(record)));
  state.log.info({ clients: records.length }, "mcp manager closed");
}

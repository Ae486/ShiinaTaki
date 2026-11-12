/**
 * INPUT:  durable desired MCP revisions plus catalog events, governance context, and runtime lifecycle budgets
 * OUTPUT: reconcile/CRUD-runtime/test/status/per-turn-tools/close with bounded lifecycle change observations
 * POS:    core/mcp — thin plane-3 orchestrator; publication tokens and generation records are process-local only
 */
import type { Tool, ToolSet } from "ai";
import type { McpCandidateOutcome, McpServerConfig, McpServerStatus, McpTestResult } from "@taki/shared";
import type { McpToolRef } from "./mcp-tool-identity.ts";
import { notifyExtensionChange } from "../extensions/notify-extension-change.ts";
import { buildTurnTools, type TurnInteractive } from "./mcp-turn-tools.ts";
import { closeGeneration, retireGeneration, type GenerationRecord } from "./mcp-generations.ts";
import { closeMcpClient } from "./mcp-client-close.ts";
import { McpCandidateError, prepareCandidate, sanitizeCandidateFailure } from "./mcp-candidate.ts";
import { deriveRuntimeStatuses } from "./mcp-runtime-status.ts";
import { findPublishedCollisions, publishDesiredGeneration } from "./mcp-publication.ts";
import {
  abortCandidate,
  createManagerState,
  disconnectActive,
  trackDesired,
  trackCandidateCleanup,
  underManagerLock,
  withdrawDesired,
  type ManagerState,
  type ManagerStateDeps,
  type McpDesiredRuntime,
} from "./mcp-manager-state.ts";

export type { McpDesiredRuntime } from "./mcp-manager-state.ts";

export interface McpToolSnapshot {
  readonly toolKey: string;
  readonly tool: Tool;
  readonly ref: Readonly<McpToolRef>;
  readonly serverId: string;
  readonly ownerHostId: string;
  readonly configRevision: number;
  readonly generation: number;
  readonly isCurrent: () => boolean;
}

export interface McpManager {
  tools(interactive?: TurnInteractive): ReturnType<typeof buildTurnTools>;
  snapshot(interactive?: TurnInteractive): readonly McpToolSnapshot[];
  describe(toolKey: string): McpToolRef | undefined;
  reconcile(servers: McpDesiredRuntime[]): Promise<void>;
  applyDesired(input: McpDesiredRuntime): Promise<McpCandidateOutcome>;
  disableServer(input: McpDesiredRuntime): void;
  removeServer(serverId: string): void;
  secretCleared(ref: string): void;
  secretUpdated(ref: string): void;
  test(input: { serverId: string; config: McpServerConfig; selectedTools: string[] }): Promise<McpTestResult>;
  statuses(): McpServerStatus[];
  close(): Promise<void>;
}

export type McpManagerDeps = ManagerStateDeps;

export function createMcpManager(deps: McpManagerDeps): McpManager {
  const state = createManagerState(deps);
  return {
    tools: (interactive) => buildTurnTools(state.active, { governance: state.governance, interactive, projectImageResult: state.projectImageResult }),
    snapshot: (interactive) => snapshotTools(state, interactive),
    describe: (toolKey) => describeTool(state, toolKey),
    reconcile: (servers) => reconcileManager(state, servers),
    applyDesired: (input) => applyDesiredManager(state, input),
    disableServer: (input) => disableTracked(state, input),
    removeServer: (serverId) => removeTracked(state, serverId),
    secretCleared: (ref) => secretClearedManager(state, ref),
    secretUpdated: (ref) => secretUpdatedManager(state, ref),
    test: (input) => testCandidate(state, input),
    statuses: () => deriveRuntimeStatuses(state),
    close: () => closeManager(state),
  };
}

function snapshotTools(state: ManagerState, interactive?: TurnInteractive): readonly McpToolSnapshot[] {
  const tools: ToolSet = buildTurnTools(state.active, { governance: state.governance, interactive, projectImageResult: state.projectImageResult });
  const entries: McpToolSnapshot[] = [];
  for (const record of state.active.values()) {
    for (const [toolKey, ref] of record.refs) {
      const tool = tools[toolKey];
      if (!tool) continue;
      entries.push(Object.freeze({
        toolKey,
        tool,
        ref: Object.freeze({ ...ref }),
        serverId: record.serverId,
        ownerHostId: record.ownerHostId,
        configRevision: record.configRevision,
        generation: record.generation,
        isCurrent: () => state.active.get(record.serverId) === record && !record.draining && !record.closed,
      }));
    }
  }
  return Object.freeze(entries);
}

function describeTool(state: ManagerState, toolKey: string): McpToolRef | undefined {
  for (const record of state.active.values()) {
    const ref = record.refs.get(toolKey);
    if (ref) return ref;
  }
  return undefined;
}

function applyDesiredManager(state: ManagerState, input: McpDesiredRuntime): Promise<McpCandidateOutcome> {
  if (state.closed) return Promise.resolve(failed(state, "MCP manager is shutting down"));
  if (!input.enabled) {
    disableTracked(state, input);
    return Promise.resolve(failed(state, "MCP server is disabled"));
  }
  return publishDesiredGeneration(state, input);
}

async function reconcileManager(state: ManagerState, servers: McpDesiredRuntime[]): Promise<void> {
  const keep = new Set(servers.map((server) => server.serverId));
  for (const serverId of [...state.desired.keys()]) {
    if (!keep.has(serverId)) removeTracked(state, serverId);
  }
  const results = await Promise.all(servers.map((server) => {
    if (server.enabled) return publishDesiredGeneration(state, server);
    disableTracked(state, server);
    return Promise.resolve(undefined);
  }));
  const published = results.filter((result) => result?.status === "published").length;
  const failures = results.filter((result) => result?.status === "failed").length;
  state.log.info({ servers: servers.length, published, failed: failures }, "mcp reconcile from desired state complete");
}

function disableTracked(state: ManagerState, input: McpDesiredRuntime): void {
  trackDesired(state, { ...input, enabled: false });
  if (!disconnectActive(state, input.serverId)) notifyExtensionChange(state.onChange, ["mcp"]);
}

function removeTracked(state: ManagerState, serverId: string): void {
  const removed = withdrawDesired(state, serverId, true);
  const disconnected = disconnectActive(state, serverId);
  if (removed && !disconnected) notifyExtensionChange(state.onChange, ["mcp"]);
}

function secretClearedManager(state: ManagerState, ref: string): void {
  const affected = affectedServers(state, ref);
  for (const serverId of affected) {
    const desired = state.desired.get(serverId);
    const desiredAffected = desired?.secretRefs.has(ref) === true;
    const candidateAffected = state.candidates.get(serverId)?.secretRefs.has(ref) === true;
    const activeAffected = state.active.get(serverId)?.secretRefs.has(ref) === true;
    if (desiredAffected && desired) trackDesired(state, runtimeOf(desired));
    else if (candidateAffected) abortCandidate(state, serverId);
    if (activeAffected) disconnectActive(state, serverId);
    if (!desiredAffected && !activeAffected) continue;
    state.outcomes.set(serverId, {
      status: "failed",
      at: state.now(),
      reason: "secret-unresolvable",
      message: "a referenced MCP secret was cleared; restore it and reconnect",
    });
    notifyExtensionChange(state.onChange, ["mcp"]);
    state.log.warn({ server: serverId }, "mcp generation retired: a referenced secret was cleared");
  }
}

function affectedServers(state: ManagerState, ref: string): Set<string> {
  const ids = new Set<string>();
  for (const tracking of state.desired.values()) if (tracking.secretRefs.has(ref)) ids.add(tracking.serverId);
  for (const candidate of state.candidates.values()) if (candidate.secretRefs.has(ref)) ids.add(candidate.serverId);
  for (const record of [...state.active.values(), ...state.draining]) {
    if (record.secretRefs.has(ref)) ids.add(record.serverId);
  }
  return ids;
}

function secretUpdatedManager(state: ManagerState, ref: string): void {
  for (const tracking of [...state.desired.values()]) {
    if (!tracking.enabled || !tracking.secretRefs.has(ref)) continue;
    void publishDesiredGeneration(state, runtimeOf(tracking));
  }
}

function runtimeOf(input: McpDesiredRuntime): McpDesiredRuntime {
  return {
    serverId: input.serverId,
    ownerHostId: input.ownerHostId,
    configRevision: input.configRevision,
    config: input.config,
    selectedTools: input.selectedTools,
    enabled: input.enabled,
  };
}

async function testCandidate(
  state: ManagerState,
  input: { serverId: string; config: McpServerConfig; selectedTools: string[] },
): Promise<McpTestResult> {
  try {
    const prepared = await prepareCandidate({
      ...input,
      connect: state.connect,
      resolveSecret: state.resolveSecret,
      log: state.log,
      deadlineMs: state.candidateDeadlineMs,
      onLateCleanup: (cleanup) => trackCandidateCleanup(state, cleanup),
    });
    try {
      const collisions = await underManagerLock(state, () => findPublishedCollisions(state, input.serverId, prepared.refs));
      if (collisions.length > 0) throw new McpCandidateError("tool-key-collision", "MCP test tool keys collide", collisions);
      return {
        status: "ok",
        toolNames: [...prepared.refs.values()].map((ref) => ref.toolName),
        skipped: prepared.skipped,
        pages: prepared.pages,
        durationMs: prepared.durationMs,
      };
    } finally {
      await closeMcpClient(prepared.client);
    }
  } catch (error) {
    const failure = sanitizeCandidateFailure(error);
    return {
      status: "failed",
      reason: failure.reason,
      message: failure.boundedMessage,
      toolNames: [],
      skipped: [],
      pages: 0,
      durationMs: 0,
    };
  }
}

function closeManager(state: ManagerState): Promise<void> {
  state.closePromise ??= closeManagerOnce(state);
  return state.closePromise;
}

async function closeManagerOnce(state: ManagerState): Promise<void> {
  state.closed = true;
  for (const candidate of state.candidates.values()) candidate.controller.abort();
  const records = uniqueRecords(state);
  const hadActive = state.active.size > 0;
  state.active.clear();
  for (const record of records) {
    state.draining.add(record);
    retireGeneration(record, state.shutdownBudgetMs);
  }
  if (hadActive) notifyExtensionChange(state.onChange, ["mcp", "extension-status"]);
  const deadline = Date.now() + state.shutdownBudgetMs;
  while (Date.now() < deadline && hasPendingWork(state, records)) await delay(10);
  const closes = records.map((record) => closeGeneration(record, record.leases > 0));
  await settleWithin(closes, Math.max(0, deadline - Date.now()));
  state.log.info({ clients: records.length }, "mcp manager closed");
}

function uniqueRecords(state: ManagerState): GenerationRecord[] {
  return [...new Set([...state.active.values(), ...state.draining])];
}

function hasPendingWork(state: ManagerState, records: GenerationRecord[]): boolean {
  return records.some((record) => !record.closed && record.leases > 0)
    || [...state.candidates.values()].some((candidate) => !candidate.done)
    || state.candidateCleanups.size > 0;
}

async function settleWithin(promises: Promise<void>[], budgetMs: number): Promise<void> {
  if (promises.length === 0 || budgetMs <= 0) return;
  await Promise.race([Promise.allSettled(promises), delay(budgetMs)]);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failed(state: ManagerState, message: string): McpCandidateOutcome {
  return { status: "failed", at: state.now(), reason: "connect-failed", message };
}

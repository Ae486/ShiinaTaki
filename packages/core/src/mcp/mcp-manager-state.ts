/**
 * INPUT:  manager dependencies plus desired-server operations and candidate ownership changes
 * OUTPUT: process-local ManagerState helpers for revision tokens, candidate cancellation, locking, and retirement
 * POS:    core/mcp — plane-3 coordination state; no state here is durable or restored after a process restart
 */
import type { McpCandidateOutcome, McpServerConfig } from "@taki/shared";
import type { Logger } from "../logging/logger.ts";
import { mcpConfigSecretRefs } from "../secrets/secret-ref.ts";
import type { McpConnect } from "./mcp-connect.ts";
import { defaultConnect } from "./mcp-connect.ts";
import { retireGeneration, type GenerationRecord } from "./mcp-generations.ts";
import type { TurnGovernance } from "./mcp-turn-tools.ts";

export interface McpDesiredRuntime {
  serverId: string;
  ownerHostId: string;
  configRevision: number;
  config: McpServerConfig;
  selectedTools: string[];
  enabled: boolean;
}

export interface DesiredTracking extends McpDesiredRuntime {
  operationToken: number;
  secretRefs: ReadonlySet<string>;
}

export interface CandidateTracking {
  serverId: string;
  operationToken: number;
  secretRefs: ReadonlySet<string>;
  controller: AbortController;
  done: boolean;
  settled: Promise<void>;
  settle(): void;
}

export interface ManagerState {
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
  desired: Map<string, DesiredTracking>;
  candidates: Map<string, CandidateTracking>;
  candidateCleanups: Set<Promise<void>>;
  nextGeneration: number;
  nextOperation: number;
  closed: boolean;
  closePromise: Promise<void> | null;
  lock: Promise<unknown>;
}

export interface ManagerStateDeps {
  logger: Logger;
  connect?: McpConnect;
  resolveSecret?: (ref: string) => string | null;
  governance?: TurnGovernance;
  drainBudgetMs?: number;
  shutdownBudgetMs?: number;
  candidateDeadlineMs?: number;
  now?: () => string;
}

export function createManagerState(deps: ManagerStateDeps): ManagerState {
  return {
    log: deps.logger.child({ mod: "mcp" }),
    connect: deps.connect ?? defaultConnect,
    resolveSecret: deps.resolveSecret,
    governance: deps.governance,
    drainBudgetMs: deps.drainBudgetMs ?? 5_000,
    shutdownBudgetMs: deps.shutdownBudgetMs ?? 5_000,
    candidateDeadlineMs: deps.candidateDeadlineMs ?? 8_000,
    now: deps.now ?? (() => new Date().toISOString()),
    active: new Map(),
    draining: new Set(),
    outcomes: new Map(),
    desired: new Map(),
    candidates: new Map(),
    candidateCleanups: new Set(),
    nextGeneration: 0,
    nextOperation: 0,
    closed: false,
    closePromise: null,
    lock: Promise.resolve(),
  };
}

export function underManagerLock<T>(state: ManagerState, run: () => Promise<T> | T): Promise<T> {
  const current = state.lock.then(run, run);
  state.lock = current.then(() => undefined, () => undefined);
  return current;
}

export function trackDesired(state: ManagerState, input: McpDesiredRuntime): DesiredTracking {
  abortCandidate(state, input.serverId);
  const tracking: DesiredTracking = {
    ...input,
    operationToken: (state.nextOperation += 1),
    secretRefs: mcpConfigSecretRefs(input.config),
  };
  state.desired.set(input.serverId, tracking);
  return tracking;
}

export function withdrawDesired(state: ManagerState, serverId: string, remove: boolean): DesiredTracking | null {
  abortCandidate(state, serverId);
  const current = state.desired.get(serverId);
  state.nextOperation += 1;
  if (remove) {
    state.desired.delete(serverId);
    return current ?? null;
  }
  if (!current) return null;
  const disabled = { ...current, enabled: false, operationToken: state.nextOperation };
  state.desired.set(serverId, disabled);
  return disabled;
}

export function beginCandidate(state: ManagerState, tracking: DesiredTracking): CandidateTracking {
  abortCandidate(state, tracking.serverId);
  const controller = new AbortController();
  let settle = (): void => undefined;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const candidate = {
    serverId: tracking.serverId,
    operationToken: tracking.operationToken,
    secretRefs: tracking.secretRefs,
    controller,
    done: false,
    settled,
    settle,
  };
  state.candidates.set(tracking.serverId, candidate);
  return candidate;
}

export function finishCandidate(state: ManagerState, candidate: CandidateTracking): void {
  candidate.done = true;
  candidate.settle();
  if (state.candidates.get(candidate.serverId) === candidate) state.candidates.delete(candidate.serverId);
}

export function candidateIsCurrent(
  state: ManagerState,
  tracking: DesiredTracking,
  candidate: CandidateTracking,
): boolean {
  return !state.closed
    && tracking.enabled
    && state.desired.get(tracking.serverId) === tracking
    && state.candidates.get(tracking.serverId) === candidate;
}

export function abortCandidate(state: ManagerState, serverId: string): void {
  state.candidates.get(serverId)?.controller.abort();
}

export function trackCandidateCleanup(state: ManagerState, cleanup: Promise<void>): void {
  state.candidateCleanups.add(cleanup);
  void cleanup.finally(() => state.candidateCleanups.delete(cleanup));
}

export function retireRecord(state: ManagerState, record: GenerationRecord): void {
  state.draining.add(record);
  retireGeneration(record, state.drainBudgetMs);
}

export function disconnectActive(state: ManagerState, serverId: string): void {
  const record = state.active.get(serverId);
  if (!record) return;
  state.active.delete(serverId);
  retireRecord(state, record);
}

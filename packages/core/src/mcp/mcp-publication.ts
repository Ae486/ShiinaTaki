/**
 * INPUT:  one durable desired revision plus the manager's active generations and candidate ownership token
 * OUTPUT: publishDesiredGeneration(state, input) — candidate validation and atomic last-good replacement
 * POS:    core/mcp — publication transaction boundary; stale candidates close and can never mutate runtime truth
 */
import type { McpCandidateOutcome, McpToolKeyCollision } from "@taki/shared";
import { closeMcpClient } from "./mcp-client-close.ts";
import { McpCandidateError, prepareCandidate, sanitizeCandidateFailure, type PreparedCandidate } from "./mcp-candidate.ts";
import { makeGenerationRecord, type GenerationRecord } from "./mcp-generations.ts";
import type { McpToolRef } from "./mcp-tool-identity.ts";
import {
  beginCandidate,
  candidateIsCurrent,
  finishCandidate,
  retireRecord,
  trackCandidateCleanup,
  trackDesired,
  underManagerLock,
  type CandidateTracking,
  type DesiredTracking,
  type ManagerState,
  type McpDesiredRuntime,
} from "./mcp-manager-state.ts";

export async function publishDesiredGeneration(
  state: ManagerState,
  input: McpDesiredRuntime,
): Promise<McpCandidateOutcome> {
  const tracking = trackDesired(state, input);
  const candidate = beginCandidate(state, tracking);
  try {
    const prepared = await prepareTrackedCandidate(state, tracking, candidate);
    const record = await underManagerLock(state, () => acceptCandidate(state, { tracking, candidate, prepared }));
    const outcome = publishedOutcome(state, record, prepared);
    if (state.desired.get(input.serverId) === tracking && state.active.get(input.serverId) === record) {
      state.outcomes.set(input.serverId, outcome);
    }
    state.log.info(
      { server: input.serverId, generation: record.generation, tools: record.refs.size, pages: prepared.pages },
      "mcp generation published",
    );
    return outcome;
  } catch (error) {
    return failedOutcome(state, tracking, error);
  } finally {
    finishCandidate(state, candidate);
  }
}

function prepareTrackedCandidate(
  state: ManagerState,
  tracking: DesiredTracking,
  candidate: CandidateTracking,
): Promise<PreparedCandidate> {
  return prepareCandidate({
    serverId: tracking.serverId,
    config: tracking.config,
    configRevision: tracking.configRevision,
    selectedTools: tracking.selectedTools,
    connect: state.connect,
    resolveSecret: state.resolveSecret,
    log: state.log,
    signal: candidate.controller.signal,
    deadlineMs: state.candidateDeadlineMs,
    onLateCleanup: (cleanup) => trackCandidateCleanup(state, cleanup),
  });
}

async function acceptCandidate(
  state: ManagerState,
  input: { tracking: DesiredTracking; candidate: CandidateTracking; prepared: PreparedCandidate },
): Promise<GenerationRecord> {
  const { tracking, candidate, prepared } = input;
  if (!candidateIsCurrent(state, tracking, candidate)) {
    await closeMcpClient(prepared.client);
    throw new McpCandidateError("connect-failed", "MCP candidate was superseded");
  }
  const collisions = findPublishedCollisions(state, tracking.serverId, prepared.refs);
  if (collisions.length > 0) {
    await closeMcpClient(prepared.client);
    throw new McpCandidateError("tool-key-collision", "MCP candidate tool keys collide", collisions);
  }
  const previous = state.active.get(tracking.serverId);
  const record = makeGenerationRecord({
    serverId: tracking.serverId,
    ownerHostId: tracking.ownerHostId,
    configRevision: tracking.configRevision,
    generation: (state.nextGeneration += 1),
    client: prepared.client,
    tools: prepared.tools,
    refs: prepared.refs,
    secretRefs: tracking.secretRefs,
    onClosed: (closed) => state.draining.delete(closed),
  });
  state.active.set(tracking.serverId, record);
  if (previous) retireRecord(state, previous);
  return record;
}

export function findPublishedCollisions(
  state: Pick<ManagerState, "active">,
  serverId: string,
  refs: ReadonlyMap<string, McpToolRef>,
): McpToolKeyCollision[] {
  const collisions: McpToolKeyCollision[] = [];
  for (const [key, ref] of refs) {
    for (const record of state.active.values()) {
      if (record.serverId === serverId) continue;
      const existing = record.refs.get(key);
      if (existing) collisions.push({
        key,
        existingServerId: record.serverId,
        existingToolName: existing.toolName,
        candidateToolName: ref.toolName,
      });
    }
  }
  return collisions;
}

function publishedOutcome(
  state: ManagerState,
  record: GenerationRecord,
  prepared: PreparedCandidate,
): McpCandidateOutcome {
  return {
    status: "published",
    at: state.now(),
    runtimeGeneration: record.generation,
    toolNames: [...record.refs.values()].map((ref) => ref.toolName),
    skipped: prepared.skipped,
    pages: prepared.pages,
    durationMs: prepared.durationMs,
  };
}

function failedOutcome(state: ManagerState, tracking: DesiredTracking, error: unknown): McpCandidateOutcome {
  const failure = sanitizeCandidateFailure(error);
  const outcome: McpCandidateOutcome = {
    status: "failed",
    at: state.now(),
    reason: failure.reason,
    message: failure.boundedMessage,
  };
  if (error instanceof McpCandidateError && error.collisions) outcome.collisions = error.collisions;
  if (state.desired.get(tracking.serverId) === tracking) {
    state.outcomes.set(tracking.serverId, outcome);
    state.log.warn(
      { server: tracking.serverId, reason: failure.reason, message: failure.boundedMessage },
      "mcp candidate failed; last-good generation (if any) keeps serving",
    );
  }
  return outcome;
}

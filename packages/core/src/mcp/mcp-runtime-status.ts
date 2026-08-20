/**
 * INPUT:  manager desired/candidate/active/draining records and latest current-revision outcomes
 * OUTPUT: deriveRuntimeStatuses(inputs) — the sanitized per-server plane-3 projection (phase, process-local
 *         generation, lease/tool counts, last candidate outcome) the operator mcp.* surface returns
 * POS:    core/mcp — truth only: current candidates and draining leases stay visible; nothing is persisted
 */
import type { McpCandidateOutcome, McpServerStatus } from "@taki/shared";
import type { GenerationRecord } from "./mcp-generations.ts";
import type { CandidateTracking, DesiredTracking } from "./mcp-manager-state.ts";

export interface RuntimeStatusInputs {
  active: ReadonlyMap<string, GenerationRecord>;
  desired: ReadonlyMap<string, DesiredTracking>;
  draining: ReadonlySet<GenerationRecord>;
  candidates: ReadonlyMap<string, CandidateTracking>;
  outcomes: ReadonlyMap<string, McpCandidateOutcome>;
}

export function deriveRuntimeStatuses(inputs: RuntimeStatusInputs): McpServerStatus[] {
  const ids = new Set<string>([
    ...inputs.desired.keys(),
    ...inputs.active.keys(),
    ...[...inputs.draining].map((record) => record.serverId),
    ...inputs.candidates.keys(),
  ]);
  return [...ids].map((serverId) => statusOf(inputs, serverId));
}

function statusOf(inputs: RuntimeStatusInputs, serverId: string): McpServerStatus {
  const record = inputs.active.get(serverId);
  const draining = [...inputs.draining].filter((candidate) => candidate.serverId === serverId && !candidate.closed);
  const tracking = inputs.desired.get(serverId);
  const lastOutcome = inputs.outcomes.get(serverId) ?? null;
  const candidate = inputs.candidates.get(serverId);
  const candidateCurrent = candidate !== undefined && candidate.operationToken === tracking?.operationToken;
  const phase = candidateCurrent && tracking?.enabled
    ? ("connecting" as const)
    : record
      ? ("connected" as const)
      : draining.length > 0
        ? ("draining" as const)
        : !tracking || tracking.enabled === false
          ? ("disabled" as const)
          : lastOutcome?.status === "failed"
            ? ("failed" as const)
            : ("disconnected" as const);
  const visible = record ?? draining.toSorted((left, right) => right.generation - left.generation)[0];
  return {
    serverId,
    phase,
    runtimeGeneration: visible?.generation ?? null,
    leaseCount: (record?.leases ?? 0) + draining.reduce((total, item) => total + item.leases, 0),
    toolCount: visible?.refs.size ?? 0,
    lastOutcome,
  };
}

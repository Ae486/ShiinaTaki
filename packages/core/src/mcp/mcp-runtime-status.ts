/**
 * INPUT:  the manager's live generation records, desired tracking, connecting set, and last outcomes
 * OUTPUT: deriveRuntimeStatuses(inputs) — the sanitized per-server plane-3 projection (phase, process-local
 *         generation, lease/tool counts, last candidate outcome) the operator mcp.* surface returns
 * POS:    core/mcp — truth only: an ACTIVE generation outranks any recorded failure (last-good keeps serving);
 *         a disabled desired row reports "disabled"; nothing here persists or infers presence
 */
import type { McpCandidateOutcome, McpServerStatus } from "@taki/shared";
import type { GenerationRecord } from "./mcp-generations.ts";
import type { DesiredTracking } from "./mcp-manager.ts";

export interface RuntimeStatusInputs {
  active: ReadonlyMap<string, GenerationRecord>;
  desired: ReadonlyMap<string, DesiredTracking>;
  connecting: ReadonlySet<string>;
  outcomes: ReadonlyMap<string, McpCandidateOutcome>;
}

export function deriveRuntimeStatuses(inputs: RuntimeStatusInputs): McpServerStatus[] {
  const ids = new Set<string>([...inputs.desired.keys(), ...inputs.active.keys()]);
  return [...ids].map((serverId) => statusOf(inputs, serverId));
}

function statusOf(inputs: RuntimeStatusInputs, serverId: string): McpServerStatus {
  const record = inputs.active.get(serverId);
  const tracking = inputs.desired.get(serverId);
  const lastOutcome = inputs.outcomes.get(serverId) ?? null;
  const phase = !tracking || tracking.enabled === false
    ? ("disabled" as const)
    : record
      ? ("connected" as const)
      : inputs.connecting.has(serverId)
        ? ("connecting" as const)
        : lastOutcome?.status === "failed"
          ? ("failed" as const)
          : ("disconnected" as const);
  return {
    serverId,
    phase,
    runtimeGeneration: record?.generation ?? null,
    leaseCount: record?.leases ?? 0,
    toolCount: record?.refs.size ?? 0,
    lastOutcome,
  };
}

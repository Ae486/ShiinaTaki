/**
 * INPUT:  Host terminal frames, authenticated provenance, and the broker's sealed control/authorization lineage
 * OUTPUT: bounded capability outcomes or exact fail-closed provenance/lineage rejections
 * POS:    core/capabilities — pure terminal verifier shared by live and bounded terminal-cache settlement
 */
import type {
  CapabilityAuthorizationLineage,
  CapabilityRespondParams,
  CapabilityRespondResult,
  HostOperationControl,
} from "@taki/shared";
import type { CapabilityOutcome } from "./capability-broker.ts";
import type { PendingAuthorization } from "./capability-broker-state.ts";

export function terminalFailure(args: {
  expected: HostOperationControl;
  expectedAuthorization: PendingAuthorization | undefined;
  params: CapabilityRespondParams;
  provenance: { hostId: string; connectionGeneration: number };
}): CapabilityRespondResult | undefined {
  const { expected, expectedAuthorization, params, provenance } = args;
  if (provenance.hostId !== expected.targetHostId) return { accepted: false, reason: "wrong_host" };
  if (provenance.connectionGeneration !== expected.connectionGeneration || !sameControl(params.control, expected)) {
    return { accepted: false, reason: "stale_generation" };
  }
  return authorizationFailure(expectedAuthorization, params.authorization);
}

function authorizationFailure(
  expected: PendingAuthorization | undefined,
  actual: CapabilityAuthorizationLineage | undefined,
): CapabilityRespondResult | undefined {
  if (!expected && !actual) return undefined;
  if (!expected || !actual) return { accepted: false, reason: "stale_generation" };
  const authorization = expected.value;
  return actual.authorizationId === authorization.authorizationId
    && actual.approvalGeneration === authorization.approvalGeneration
    && actual.challengeDigest === authorization.challengeDigest
    ? undefined
    : { accepted: false, reason: "stale_generation" };
}

export function responseOutcome(params: CapabilityRespondParams): CapabilityOutcome {
  if (params.state === "completed" || params.state === "failed") {
    const failure = governanceEvidenceFailure(params);
    if (failure) return { ok: false, code: "DENIED", message: failure };
  }
  switch (params.state) {
    case "completed": return { ok: true, output: params.output };
    case "failed": return { ok: false, code: params.error.code, message: params.error.message };
    case "cancelled": return { ok: false, code: "CANCELLED", message: "capability request cancelled", state: "cancelled" };
    case "outcome_unknown": return { ok: false, code: "OUTCOME_UNKNOWN", message: "capability outcome is unknown", state: "outcome_unknown" };
  }
}

function governanceEvidenceFailure(
  params: Extract<CapabilityRespondParams, { state: "completed" | "failed" }>,
): string | undefined {
  const projection = params.control.governanceProjection;
  const evidence = params.governance;
  if (evidence.descriptorRevision !== projection.descriptorRevision
    || evidence.classifierRevision !== projection.classifierRevision) return "Host governance evidence revision mismatch";
  const projected = projection.cells.find((cell) => cell.key === evidence.cellKey)?.posture;
  if (!projected || postureRank(evidence.effectivePosture) < postureRank(projected)) {
    return "Host governance evidence failed stricter-only verification";
  }
  if (evidence.constraint === "none" && evidence.effectivePosture !== projected) {
    return "Host governance evidence omitted its stricter constraint";
  }
  if (params.state === "completed" && evidence.effectivePosture !== "auto" && !params.authorization) {
    return "Host reported execution under a non-auto governance posture without authorization";
  }
  if (params.state === "completed" && params.authorization && evidence.effectivePosture !== "ask") {
    return "Host authorization lineage does not match an ask-classified execution";
  }
  return undefined;
}

function postureRank(posture: "auto" | "ask" | "deny"): number {
  return { auto: 0, ask: 1, deny: 2 }[posture];
}

export function sameControl(left: HostOperationControl, right: HostOperationControl): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

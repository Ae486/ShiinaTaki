/**
 * INPUT:  a validated registry plus one canonical governance evaluation candidate
 * OUTPUT: deterministic fail-closed effective posture; no Approval lookup or adapter-specific branching
 * POS:    shared/governance — pure common evaluator used by Core policy services and focused parity fixtures
 */
import type { GovernanceEvaluationInput, GovernanceEvaluationResult, GovernanceRegistry } from "./governance-schema.ts";
import { governanceCell, governanceDescriptor } from "./governance-registry.ts";

export function evaluateGovernance(registry: GovernanceRegistry, input: GovernanceEvaluationInput): GovernanceEvaluationResult {
  const closed = (reason: GovernanceEvaluationResult["reason"]): GovernanceEvaluationResult => ({
    identity: input.identity,
    cellKey: input.cellKey,
    descriptorRevision: input.descriptorRevision,
    policyGeneration: input.policyGeneration,
    posture: "deny",
    reason,
  });
  if (input.registryRevision !== registry.registryRevision) return closed("registry-revision-mismatch");
  const descriptor = governanceDescriptor(registry, input.identity.capabilityId);
  if (!descriptor) return closed("unknown-capability");
  if (descriptor.subjectRequired !== (input.identity.subject !== undefined)) return closed("subject-binding-mismatch");
  if (input.descriptorRevision !== descriptor.descriptorRevision) return closed("descriptor-revision-mismatch");
  if (input.classifierId !== descriptor.classifier.classifierId || input.classifierRevision !== descriptor.classifier.classifierRevision) {
    return closed("classifier-mismatch");
  }
  const cell = governanceCell(descriptor, input.cellKey);
  if (!cell) return closed("unknown-cell");
  if (input.override && (input.override.key !== cell.key || input.override.level !== input.level || input.override.descriptorRevision !== descriptor.descriptorRevision)) {
    return closed("override-mismatch");
  }
  if (input.denyConstraints.length > 0) return closed("deny-constraint");
  return {
    identity: input.identity,
    cellKey: cell.key,
    descriptorRevision: descriptor.descriptorRevision,
    policyGeneration: input.policyGeneration,
    posture: input.override?.posture ?? cell.levels[input.level],
    reason: input.override ? "operator-override" : "factory",
  };
}

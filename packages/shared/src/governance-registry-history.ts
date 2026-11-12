/**
 * INPUT: requested stored governance revision
 * OUTPUT: evidenced current/historical registry or explicit unavailable history
 * POS: shared/governance — durable Approval compatibility; never aliases unknown revisions
 */
import { CANONICAL_GOVERNANCE_REGISTRY } from "./governance-registry.ts";
import { HISTORICAL_GOVERNANCE_REGISTRY_1 } from "./governance-historical-v1.ts";
import { HISTORICAL_GOVERNANCE_REGISTRY_3 } from "./governance-historical-v3.ts";
import type { GovernanceRegistry } from "./governance-schema.ts";

export function resolveHistoricalGovernanceRegistry(revision: number): GovernanceRegistry | undefined {
  if (revision === CANONICAL_GOVERNANCE_REGISTRY.registryRevision) return CANONICAL_GOVERNANCE_REGISTRY;
  if (revision === 1) return HISTORICAL_GOVERNANCE_REGISTRY_1;
  if (revision === 3) return HISTORICAL_GOVERNANCE_REGISTRY_3;
  return undefined;
}

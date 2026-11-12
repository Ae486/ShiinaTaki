/**
 * INPUT:  Approval repository, canonical governance registry, durable grant/list/revoke candidates
 * OUTPUT: process-scoped Approval authority service with digest validation and optimistic durable mutations
 * POS:    core/approval — serialized Batch-A authority; not composed into prompts, methods, or execution yet
 */
import { randomUUID } from "node:crypto";
import {
  APPROVAL_DISCLOSURE_REVISION,
  ApprovalDecisionListItemSchema,
  ApprovalSafeLabelsSchema,
  ApprovalDurableDecisionSchema,
  CANONICAL_GOVERNANCE_REGISTRY,
  resolveHistoricalGovernanceRegistry,
  type ApprovalDecisionListItem,
  type ApprovalDurableDecision,
  type ApprovalDurableDecisionBinding,
  type ApprovalDecisionProvenance,
  type ApprovalSafeLabels,
  type GovernanceRegistry,
} from "@taki/shared";
import {
  approvalBindingDigest,
  approvalBindingInertReason,
  type ApprovalInertReason,
  storedApprovalBindingDigest,
  validateCurrentApprovalBinding,
} from "./approval-binding.ts";
import type { ApprovalStateRepo, ApprovalStateSnapshot } from "./approval-state-repo.ts";

export interface ApprovalGrantInput {
  binding: ApprovalDurableDecisionBinding;
  expectedApprovalGeneration: number;
  provenance?: ApprovalDecisionProvenance;
  decisionId?: string;
  now?: string;
}

export interface ApprovalDecisionService {
  readonly processEpoch: string;
  snapshot(): ApprovalStateSnapshot;
  list(labels?: ReadonlyMap<string, ApprovalSafeLabels>): ApprovalDecisionListItem[];
  grantAlways(input: ApprovalGrantInput): ApprovalStateSnapshot;
  revoke(decisionId: string, expectedApprovalGeneration: number): { revoked: boolean; snapshot: ApprovalStateSnapshot };
  advanceGeneration(expectedApprovalGeneration: number): ApprovalStateSnapshot;
}

export type ApprovalRegistryResolver = (registryRevision: number) => GovernanceRegistry | undefined;

export function createApprovalDecisionService(
  repo: ApprovalStateRepo,
  registry: GovernanceRegistry = CANONICAL_GOVERNANCE_REGISTRY,
  resolveRegistry: ApprovalRegistryResolver = (revision) => revision === registry.registryRevision ? registry
    : registry === CANONICAL_GOVERNANCE_REGISTRY ? resolveHistoricalGovernanceRegistry(revision) : undefined,
): ApprovalDecisionService {
  reconcile(repo, registry, resolveRegistry);
  return {
    processEpoch: randomUUID(),
    snapshot: () => repo.read(),
    list: (labels) => listDecisions(repo.read(), registry, labels),
    grantAlways(input) {
      const binding = validateCurrentApprovalBinding(registry, input.binding);
      const bindingDigest = approvalBindingDigest(binding);
      const now = input.now ?? new Date().toISOString();
      const decision = ApprovalDurableDecisionSchema.parse({
        decisionId: input.decisionId ?? randomUUID(),
        binding,
        bindingDigest,
        provenance: input.provenance ?? "operator",
        createdAt: now,
        updatedAt: now,
      });
      return repo.grant(decision, input.expectedApprovalGeneration);
    },
    revoke: (decisionId, expected) => repo.revoke(decisionId, expected),
    advanceGeneration: (expected) => repo.advanceGeneration(expected),
  };
}

function listDecisions(
  snapshot: ApprovalStateSnapshot,
  registry: GovernanceRegistry,
  labels?: ReadonlyMap<string, ApprovalSafeLabels>,
): ApprovalDecisionListItem[] {
  return snapshot.decisions.map((decision) => {
    const reason = decisionInertReason(decision, registry, APPROVAL_DISCLOSURE_REVISION);
    const safeLabels = labels?.get(decision.decisionId);
    return ApprovalDecisionListItemSchema.parse({
      ...decision,
      verdict: "allow",
      ...(safeLabels === undefined ? {} : { labels: ApprovalSafeLabelsSchema.parse(safeLabels) }),
      usability: reason === undefined ? { usable: true } : { usable: false, reason },
    });
  });
}

function reconcile(
  repo: ApprovalStateRepo,
  registry: GovernanceRegistry,
  resolveRegistry: ApprovalRegistryResolver,
): void {
  const snapshot = repo.read();
  assertStoredDigests(snapshot);
  const storedRegistry = resolveStoredRegistry(snapshot, registry, resolveRegistry);
  const materiallyChanged = snapshot.decisions.some((decision) => {
    const wasUsable = decisionInertReason(decision, storedRegistry, snapshot.disclosureRevision) === undefined;
    const isUsable = decisionInertReason(decision, registry, APPROVAL_DISCLOSURE_REVISION) === undefined;
    return wasUsable !== isUsable;
  });
  repo.reconcile({
    governanceRegistryRevision: registry.registryRevision,
    disclosureRevision: APPROVAL_DISCLOSURE_REVISION,
    materiallyChanged,
  });
}

function assertStoredDigests(snapshot: ApprovalStateSnapshot): void {
  for (const decision of snapshot.decisions) {
    if (storedApprovalBindingDigest(decision.binding) !== decision.bindingDigest) {
      throw new Error(`approval decision ${decision.decisionId} has binding digest corruption`);
    }
  }
}

function resolveStoredRegistry(
  snapshot: ApprovalStateSnapshot,
  currentRegistry: GovernanceRegistry,
  resolveRegistry: ApprovalRegistryResolver,
): GovernanceRegistry {
  if (snapshot.governanceRegistryRevision === currentRegistry.registryRevision) return currentRegistry;
  if (snapshot.decisions.length === 0) return currentRegistry;
  const storedRegistry = resolveRegistry(snapshot.governanceRegistryRevision);
  if (storedRegistry?.registryRevision !== snapshot.governanceRegistryRevision) {
    throw new Error(`historical governance registry ${snapshot.governanceRegistryRevision} is unavailable`);
  }
  return storedRegistry;
}

function decisionInertReason(
  decision: ApprovalDurableDecision,
  registry: GovernanceRegistry,
  disclosureRevision: number,
): ApprovalInertReason | undefined {
  if (storedApprovalBindingDigest(decision.binding) !== decision.bindingDigest) return "binding_digest_mismatch";
  return approvalBindingInertReason(registry, decision.binding, disclosureRevision);
}

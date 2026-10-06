/**
 * INPUT:  previous and proposed canonical Taki policies in one existing Local writer transaction
 * OUTPUT: a monotonic version only for actual policy semantics, preserving no-op bookkeeping
 * POS:    core/db — shared Local policy revision rule required by native transition predecessor CAS
 */
import type { TakiMemoryPolicyProjection } from "@taki/shared";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";

export function advanceCanonicalPolicyVersion(previous: TakiMemoryPolicyProjection, proposed: TakiMemoryPolicyProjection): TakiMemoryPolicyProjection {
  const semantics = (policy: TakiMemoryPolicyProjection) => Object.fromEntries(Object.entries(policy)
    .filter(([key]) => !["authorityEpochId", "bankId", "memoryId", "updatedAt", "policyVersion"].includes(key)));
  return canonicalPayloadHash(semantics(previous)) === canonicalPayloadHash(semantics(proposed))
    ? { ...proposed, policyVersion: previous.policyVersion, updatedAt: previous.updatedAt }
    : { ...proposed, policyVersion: previous.policyVersion + 1 };
}

import { describe, expect, it } from "vitest";
import { CANONICAL_GOVERNANCE_REGISTRY, governanceDescriptor } from "./governance-registry.ts";
import { resolveHistoricalGovernanceRegistry } from "./governance-registry-history.ts";

describe("evidenced governance history", () => {
  it("resolves the exact frozen revisions while unknown history stays unavailable", () => {
    expect(resolveHistoricalGovernanceRegistry(1)?.registryRevision).toBe(1);
    expect(resolveHistoricalGovernanceRegistry(3)?.registryRevision).toBe(3);
    expect(resolveHistoricalGovernanceRegistry(4)).toBe(CANONICAL_GOVERNANCE_REGISTRY);
    for (const revision of [0, 2, 5, 100]) expect(resolveHistoricalGovernanceRegistry(revision)).toBeUndefined();
    expect(governanceDescriptor(resolveHistoricalGovernanceRegistry(1)!, "hindsight-custody")).toBeUndefined();
    expect(governanceDescriptor(resolveHistoricalGovernanceRegistry(3)!, "core.subagent.manage")).toBeUndefined();
    expect(governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, "hindsight-custody")).toBeDefined();
    expect(governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, "core.subagent.manage")).toBeDefined();
  });

  it("preserves historical rememberable descriptor and classifier semantics in the union", () => {
    for (const revision of [1, 3]) {
      const registry = resolveHistoricalGovernanceRegistry(revision)!;
      for (const descriptor of registry.descriptors) {
        if (!descriptor.cells.some((cell) => cell.approvalMemory === "rememberable")) continue;
        expect(governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, descriptor.capabilityId)).toEqual(descriptor);
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  CANONICAL_GOVERNANCE_REGISTRY,
  createGovernanceRegistry,
  governanceCell,
  governanceDescriptor,
} from "./governance-registry.ts";

describe("canonical governance registry", () => {
  it("contains the complete factory inventory plus explicit extension adapters", () => {
    const cells = CANONICAL_GOVERNANCE_REGISTRY.descriptors.flatMap((descriptor) => descriptor.cells);
    expect(cells).toHaveLength(43);
    const custody = governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, "hindsight-custody")!;
    expect(custody.cells[0]?.levels).toEqual({ strict: "ask", standard: "ask", relaxed: "auto" });
    expect(custody.cells[0]?.approvalMemory).toBe("once-only");
    expect(governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, "core.co-watching.manage")?.cells).toMatchObject([
      { key: "co-watching-manage", overrideMode: "immutable", levels: { strict: "auto", standard: "auto", relaxed: "auto" } },
    ]);
    expect(governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, "skill.load")?.cells[0]?.levels).toEqual({ strict: "auto", standard: "auto", relaxed: "auto" });
    expect(governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, "mcp.tool.call")?.subjectRequired).toBe(true);
    expect(governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, "core.schedule.manage")?.cells[0]?.key).toBe("schedule-manage");
    expect(governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, "core.initiative.pattern.manage")).toMatchObject({
      subjectRequired: false,
      cells: [{ key: "interaction-pattern-manage", levels: { strict: "auto", standard: "auto", relaxed: "auto" },
        approvalMemory: "once-only", overrideMode: "immutable" }],
    });
    expect(governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, "core.initiative.intention.plan")).toMatchObject({
      subjectRequired: false,
      cells: [{ key: "intention-plan", levels: { strict: "auto", standard: "auto", relaxed: "auto" },
        approvalMemory: "once-only", overrideMode: "immutable" }],
    });
    expect(governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, "core.initiative.decide")).toMatchObject({
      subjectRequired: false,
      cells: [{ key: "initiative-decide", levels: { strict: "auto", standard: "auto", relaxed: "auto" },
        approvalMemory: "once-only", overrideMode: "immutable" }],
    });
  });

  it("keeps delegation management, inspection and result collection in their fixed Core policy cells", () => {
    const expected = [
      ["core.subagent.manage", "subagent-manage"],
      ["core.subagent.read", "subagent-read"],
      ["core.subagent.result", "subagent-result"],
    ] as const;
    const delegation = CANONICAL_GOVERNANCE_REGISTRY.descriptors.filter((descriptor) => descriptor.capabilityId.startsWith("core.subagent."));
    expect(delegation.map((descriptor) => descriptor.capabilityId).sort()).toEqual(expected.map(([capabilityId]) => capabilityId).sort());
    for (const [capabilityId, key] of expected) {
      expect(governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, capabilityId)).toEqual({
        capabilityId,
        descriptorRevision: 1,
        subjectRequired: false,
        classifier: { authority: "core", classifierId: "fixed-risk", classifierRevision: 1 },
        cells: [{ key, levels: { strict: "auto", standard: "auto", relaxed: "auto" },
          approvalMemory: "once-only", overrideMode: "immutable" }],
      });
    }
  });

  it("requires exact canonical policy cells and never truncates target-qualified decision scope", () => {
    const descriptor = governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, "fs-write");
    expect(descriptor && governanceCell(descriptor, "fs-write:dir-root")?.key).toBe("fs-write:dir-root");
    expect(descriptor && governanceCell(descriptor, "fs-write:dir-root:C:\\A")).toBeUndefined();
    expect(descriptor && governanceCell(descriptor, "fs-write:not-registered")).toBeUndefined();
  });

  it("rejects duplicate capability and cell identities", () => {
    const descriptor = CANONICAL_GOVERNANCE_REGISTRY.descriptors[0];
    expect(descriptor).toBeDefined();
    expect(() => createGovernanceRegistry({ registryRevision: 1, descriptors: [descriptor!, descriptor!] })).toThrow(/duplicate governance capability/);
    expect(() => createGovernanceRegistry({
      registryRevision: 1,
      descriptors: [{ ...descriptor!, cells: [descriptor!.cells[0]!, descriptor!.cells[0]!] }],
    })).toThrow(/duplicate governance cell/);
  });
});

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
    expect(cells).toHaveLength(31);
    expect(governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, "skill.load")?.cells[0]?.levels).toEqual({ strict: "auto", standard: "auto", relaxed: "auto" });
    expect(governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, "mcp.tool.call")?.subjectRequired).toBe(true);
    expect(governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, "core.schedule.manage")?.cells[0]?.key).toBe("schedule-manage");
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

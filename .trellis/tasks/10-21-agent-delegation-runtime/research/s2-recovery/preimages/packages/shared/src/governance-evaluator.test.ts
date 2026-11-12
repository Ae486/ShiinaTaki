import { describe, expect, it } from "vitest";
import { evaluateGovernance } from "./governance-evaluator.ts";
import { CANONICAL_GOVERNANCE_REGISTRY } from "./governance-registry.ts";

const hostId = "11111111-1111-4111-8111-111111111111";
const base = {
  identity: { capabilityId: "mcp.tool.call", ownerHostId: hostId, subject: { subjectId: "srv.tool", revision: "cfg-1" } },
  registryRevision: 1,
  descriptorRevision: 1,
  classifierId: "mcp-tool-call",
  classifierRevision: 1,
  cellKey: "mcp-tool-call",
  level: "standard" as const,
  policyGeneration: 7,
  denyConstraints: [] as string[],
};

describe("evaluateGovernance", () => {
  it("applies factory and validated operator override postures", () => {
    expect(evaluateGovernance(CANONICAL_GOVERNANCE_REGISTRY, base)).toMatchObject({ posture: "ask", reason: "factory" });
    expect(evaluateGovernance(CANONICAL_GOVERNANCE_REGISTRY, {
      ...base,
      override: { key: "mcp-tool-call", level: "standard", posture: "auto", descriptorRevision: 1 },
    })).toMatchObject({ posture: "auto", reason: "operator-override" });
  });

  it.each([
    [{ registryRevision: 2 }, "registry-revision-mismatch"],
    [{ descriptorRevision: 2 }, "descriptor-revision-mismatch"],
    [{ classifierRevision: 2 }, "classifier-mismatch"],
    [{ cellKey: "mcp-missing" }, "unknown-cell"],
    [{ identity: { capabilityId: "unknown", ownerHostId: hostId } }, "unknown-capability"],
  ] as const)("fails closed for mismatches", (patch, reason) => {
    expect(evaluateGovernance(CANONICAL_GOVERNANCE_REGISTRY, { ...base, ...patch })).toMatchObject({ posture: "deny", reason });
  });

  it("lets deny-only compatibility constraints tighten but never grant", () => {
    expect(evaluateGovernance(CANONICAL_GOVERNANCE_REGISTRY, { ...base, denyConstraints: ["legacy-deny"] })).toMatchObject({ posture: "deny", reason: "deny-constraint" });
  });
});

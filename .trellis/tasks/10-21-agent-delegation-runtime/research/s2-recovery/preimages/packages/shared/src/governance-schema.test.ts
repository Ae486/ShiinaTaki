import { describe, expect, it } from "vitest";
import {
  CanonicalCapabilityIdentitySchema,
  GovernanceEvaluationInputSchema,
  GovernanceRegistrySchema,
} from "./governance-schema.ts";

const hostId = "11111111-1111-4111-8111-111111111111";

describe("governance schemas", () => {
  it("accepts structured stable identities and rejects display/path fields", () => {
    expect(CanonicalCapabilityIdentitySchema.parse({
      capabilityId: "mcp.tool.call",
      ownerHostId: hostId,
      subject: { subjectId: "server-1.tool-2", revision: "config-7" },
    })).toBeDefined();
    expect(CanonicalCapabilityIdentitySchema.safeParse({
      capabilityId: "mcp.tool.call",
      ownerHostId: hostId,
      displayName: "Files read",
    }).success).toBe(false);
  });

  it("keeps registries and evaluation inputs strict", () => {
    expect(GovernanceRegistrySchema.safeParse({ registryRevision: 1, descriptors: [], extra: true }).success).toBe(false);
    expect(GovernanceEvaluationInputSchema.safeParse({
      identity: { capabilityId: "skill.load", ownerHostId: hostId, subject: { subjectId: "skill-1", revision: "sha256-a" } },
      registryRevision: 1,
      descriptorRevision: 1,
      classifierId: "skill-load",
      classifierRevision: 1,
      cellKey: "skill-load",
      level: "standard",
      policyGeneration: 1,
      denyConstraints: [],
    }).success).toBe(true);
  });
});

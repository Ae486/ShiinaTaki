import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  APPROVAL_BINDING_REVISION,
  APPROVAL_DISCLOSURE_REVISION,
  ApprovalDecisionBindingSchema,
  ApprovalDecisionListItemSchema,
  ApprovalDecisionScopeSchema,
  ApprovalDurableDecisionBindingSchema,
  ApprovalStoredDurableDecisionBindingSchema,
  canonicalApprovalDecisionScope,
  canonicalApprovalDurableDecisionBinding,
} from "./approval-decision-schema.ts";

const hostId = "11111111-1111-4111-8111-111111111111";
const scope = {
  bindingRevision: APPROVAL_BINDING_REVISION,
  identity: {
    capabilityId: "mcp.tool.call",
    ownerHostId: hostId,
    subject: { subjectId: "server.tool", revision: "config-7" },
  },
  descriptorRevision: 1,
  classifierId: "mcp-tool-call",
  classifierRevision: 1,
  cellKey: "mcp-tool-call",
} as const;
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

describe("canonical Approval decision binding", () => {
  it("serializes deterministically independent of object insertion order", () => {
    const first = canonicalApprovalDecisionScope(scope);
    const reversed = canonicalApprovalDecisionScope({
      cellKey: "mcp-tool-call",
      classifierRevision: 1,
      classifierId: "mcp-tool-call",
      descriptorRevision: 1,
      identity: {
        subject: { revision: "config-7", subjectId: "server.tool" },
        ownerHostId: hostId,
        capabilityId: "mcp.tool.call",
      },
      bindingRevision: APPROVAL_BINDING_REVISION,
    });
    expect(reversed).toBe(first);
  });

  it("distinguishes every authority field", () => {
    const baseline = canonicalApprovalDecisionScope(scope);
    const variants = [
      { ...scope, identity: { ...scope.identity, capabilityId: "other.capability" } },
      { ...scope, identity: { ...scope.identity, ownerHostId: "22222222-2222-4222-8222-222222222222" } },
      { ...scope, identity: { ...scope.identity, subject: { ...scope.identity.subject, subjectId: "other.tool" } } },
      { ...scope, identity: { ...scope.identity, subject: { ...scope.identity.subject, revision: "config-8" } } },
      { ...scope, descriptorRevision: 2 },
      { ...scope, classifierId: "other-classifier" },
      { ...scope, classifierRevision: 2 },
      { ...scope, cellKey: "skill-load" },
    ];
    for (const variant of variants) expect(canonicalApprovalDecisionScope(variant)).not.toBe(baseline);
    expect(ApprovalDecisionScopeSchema.safeParse({ ...scope, bindingRevision: 2 }).success).toBe(false);
  });

  it("omits optional fields and binds the trusted scope digest", () => {
    const decisionScopeDigest = digest(canonicalApprovalDecisionScope(scope));
    const binding = { ...scope, decisionScopeDigest };
    expect(ApprovalDecisionBindingSchema.parse(binding).decisionScopeDigest).toBe(decisionScopeDigest);
    const durable = { ...binding, disclosureRevision: APPROVAL_DISCLOSURE_REVISION } as const;
    expect(canonicalApprovalDurableDecisionBinding(durable)).not.toContain("undefined");
    expect(canonicalApprovalDurableDecisionBinding({ ...durable, decisionScopeDigest: "b".repeat(64) }))
      .not.toBe(canonicalApprovalDurableDecisionBinding(durable));
    expect(ApprovalDurableDecisionBindingSchema.safeParse({ ...durable, disclosureRevision: 2 }).success).toBe(false);
    expect(ApprovalStoredDurableDecisionBindingSchema.safeParse({ ...durable, disclosureRevision: 2 }).success).toBe(true);
  });

  it("keeps stored historical revisions listable while current candidate schemas fail closed", () => {
    const historical = {
      ...scope,
      bindingRevision: 2,
      decisionScopeDigest: "a".repeat(64),
      disclosureRevision: 2,
    };
    expect(ApprovalDecisionBindingSchema.safeParse(historical).success).toBe(false);
    expect(ApprovalDecisionListItemSchema.safeParse({
      decisionId: "22222222-2222-4222-8222-222222222222",
      verdict: "allow",
      binding: historical,
      bindingDigest: "b".repeat(64),
      provenance: "operator",
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
      usability: { usable: false, reason: "binding_revision_mismatch" },
    }).success).toBe(true);
  });

  it("keeps historical identity syntax readable without accepting it as a current candidate", () => {
    const historical = {
      ...scope,
      identity: {
        capabilityId: "MCP Tool Call v0",
        ownerHostId: "legacy-host-key",
        subject: { subjectId: "Server/Tool", revision: "Config Revision 1" },
      },
      classifierId: "MCP Classifier v0",
      cellKey: "MCP Tool Cell v0",
      decisionScopeDigest: "a".repeat(64),
      disclosureRevision: APPROVAL_DISCLOSURE_REVISION,
    };
    expect(ApprovalDurableDecisionBindingSchema.safeParse(historical).success).toBe(false);
    expect(ApprovalStoredDurableDecisionBindingSchema.safeParse(historical).success).toBe(true);
  });
});

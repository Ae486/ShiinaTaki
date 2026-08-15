import { describe, expect, it } from "vitest";
import {
  APPROVAL_DISCLOSURE_REVISION,
  APPROVAL_METHODS,
  APPROVAL_PRESENTATION_REVISION,
  ApprovalClosedSchema,
  ApprovalListParamsSchema,
  ApprovalListResultSchema,
  ApprovalRevokeParamsSchema,
  ApprovalRevokeResultSchema,
  CanonicalApprovalRequestSchema,
  CanonicalApprovalRespondParamsSchema,
  CanonicalApprovalRespondResultSchema,
} from "./approval-api.ts";

const binding = {
  bindingRevision: 1 as const,
  identity: {
    capabilityId: "mcp.tool.call",
    ownerHostId: "11111111-1111-4111-8111-111111111111",
    subject: { subjectId: "server.tool", revision: "config-7" },
  },
  descriptorRevision: 1,
  classifierId: "mcp-tool-call",
  classifierRevision: 1,
  cellKey: "mcp-tool-call",
  decisionScopeDigest: "a".repeat(64),
};

const request = {
  approvalId: "22222222-2222-4222-8222-222222222222",
  expiresAt: "2026-08-13T12:00:00.000Z",
  policyGeneration: 4,
  approvalGeneration: 7,
  binding,
  disclosureRevision: APPROVAL_DISCLOSURE_REVISION,
  allowedChoices: ["allow_once", "allow_session", "allow_always", "deny"] as const,
  presentation: {
    revision: APPROVAL_PRESENTATION_REVISION,
    title: "Allow MCP tool call?",
    capabilityLabel: "MCP tool",
    subjectLabel: "Configured server tool",
    riskSummary: "This tool may access its configured external service.",
    sections: [{ title: "Purpose", fields: [{ label: "Action", value: "Read repository metadata" }] }],
  },
};

describe("canonical Approval operator schemas", () => {
  it("freezes every common method and strict request round-trip", () => {
    expect(APPROVAL_METHODS).toEqual({
      request: "approval.request", respond: "approval.respond", closed: "approval.closed",
      list: "approval.list", revoke: "approval.revoke",
    });
    expect(CanonicalApprovalRequestSchema.parse(request)).toEqual(request);
    expect(CanonicalApprovalRequestSchema.safeParse({ ...request, input: { secret: "raw" } }).success).toBe(false);
    expect(CanonicalApprovalRequestSchema.safeParse({ ...request, serverName: "legacy" }).success).toBe(false);
  });

  it("enforces bounded presentation and server-computed allowed choices", () => {
    expect(CanonicalApprovalRequestSchema.safeParse({
      ...request,
      presentation: { ...request.presentation, title: "x".repeat(121) },
    }).success).toBe(false);
    expect(CanonicalApprovalRequestSchema.safeParse({
      ...request,
      presentation: { ...request.presentation, sections: [] },
    }).success).toBe(false);
    expect(CanonicalApprovalRequestSchema.safeParse({
      ...request,
      allowedChoices: ["allow_once", "deny", "deny"],
    }).success).toBe(false);
    expect(CanonicalApprovalRequestSchema.safeParse({
      ...request,
      disclosureRevision: undefined,
    }).success).toBe(false);
  });

  it("accepts only explicit response choices and exact durable disclosure", () => {
    const base = { approvalId: request.approvalId, expectedApprovalGeneration: 7 };
    for (const choice of ["allow_once", "allow_session", "deny"] as const) {
      expect(CanonicalApprovalRespondParamsSchema.parse({ ...base, choice })).toEqual({ ...base, choice });
    }
    expect(CanonicalApprovalRespondParamsSchema.parse({
      ...base,
      choice: "allow_always",
      disclosure: { revision: APPROVAL_DISCLOSURE_REVISION, futureBackgroundUseAccepted: true },
    })).toBeDefined();
    expect(CanonicalApprovalRespondParamsSchema.safeParse({ ...base, choice: "allow_always" }).success).toBe(false);
    expect(CanonicalApprovalRespondParamsSchema.safeParse({
      ...base, choice: "allow_always", disclosure: { revision: 2, futureBackgroundUseAccepted: true },
    }).success).toBe(false);
    expect(CanonicalApprovalRespondParamsSchema.safeParse({ ...base, approved: true, scope: "always" }).success).toBe(false);
  });

  it("keeps response, closed, list, and revoke envelopes closed and bounded", () => {
    expect(CanonicalApprovalRespondResultSchema.parse({ status: "wrong_session", approvalGeneration: 7 })).toBeDefined();
    for (const reason of [
      "answered", "denied", "expired", "cancelled", "operator_disconnected",
      "host_disconnected", "policy_changed", "approval_generation_changed", "route_replaced",
    ] as const) {
      expect(ApprovalClosedSchema.parse({ approvalId: request.approvalId, reason, approvalGeneration: 7 })).toBeDefined();
    }
    expect(ApprovalClosedSchema.safeParse({ approvalId: request.approvalId, reason: "settled", approvalGeneration: 7 }).success).toBe(false);
    expect(ApprovalListParamsSchema.parse({})).toEqual({});
    expect(ApprovalListResultSchema.parse({
      approvalGeneration: 7,
      governanceRegistryRevision: 1,
      disclosureRevision: APPROVAL_DISCLOSURE_REVISION,
      decisions: [],
    }).decisions).toEqual([]);
    expect(ApprovalRevokeParamsSchema.parse({ decisionId: request.approvalId, expectedApprovalGeneration: 7 })).toBeDefined();
    expect(ApprovalRevokeResultSchema.parse({ status: "not_found", approvalGeneration: 7 })).toBeDefined();
    expect(ApprovalRevokeResultSchema.parse({ status: "stale_generation", approvalGeneration: 7 })).toBeDefined();
    expect(ApprovalRevokeResultSchema.safeParse({ status: "not_found", approvalGeneration: 7, input: "leak" }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { canonicalApprovalDecisionScope, type CanonicalApprovalRequest } from "@taki/shared";
import { createHash } from "node:crypto";
import {
  approvalStatusMessage,
  parseApprovalAnswer,
  parseApprovalDisclosure,
  renderApprovalAsk,
  renderApprovalDisclosure,
} from "./approval-prompt.ts";

function request(): CanonicalApprovalRequest {
  const scope = {
    bindingRevision: 1 as const,
    identity: {
      capabilityId: "mcp.tool.call",
      ownerHostId: "11111111-1111-4111-8111-111111111111",
      subject: { subjectId: "mcp.subject", revision: "cfg.1" },
    },
    descriptorRevision: 1,
    classifierId: "mcp-tool-call",
    classifierRevision: 1,
    cellKey: "mcp-tool-call",
  };
  return {
    approvalId: "11111111-1111-4111-8111-111111111111",
    expiresAt: "2026-08-14T00:00:00.000Z",
    policyGeneration: 1,
    approvalGeneration: 1,
    binding: { ...scope, decisionScopeDigest: createHash("sha256").update(canonicalApprovalDecisionScope(scope)).digest("hex") },
    disclosureRevision: 1,
    allowedChoices: ["allow_once", "allow_session", "allow_always", "deny"],
    presentation: {
      revision: 1,
      title: "Allow MCP tool",
      capabilityLabel: "read",
      riskSummary: "Reads from the configured server.",
      sections: [{ title: "Target", fields: [{ label: "Server", value: "files" }] }],
    },
  };
}

describe("canonical Approval prompt", () => {
  it("parses only displayed explicit choices and has no implicit never shortcut", () => {
    const allowed = request().allowedChoices;
    expect(parseApprovalAnswer("y", allowed)).toBe("allow_once");
    expect(parseApprovalAnswer("s", allowed)).toBe("allow_session");
    expect(parseApprovalAnswer("a", allowed)).toBe("allow_always");
    expect(parseApprovalAnswer("d", allowed)).toBe("deny");
    expect(parseApprovalAnswer("n", allowed)).toBeNull();
    expect(parseApprovalAnswer("s", ["allow_once", "deny"])).toBeNull();
  });

  it("renders only bounded safe presentation and disclosure wording", () => {
    const prompt = renderApprovalAsk(request());
    expect(prompt).toContain("Allow MCP tool");
    expect(prompt).toContain("Server: files");
    expect(prompt).toContain("future background use");
    expect(prompt).not.toContain("SENTINEL_RAW_INPUT");
    expect(prompt).not.toContain("JSON.stringify");
  });

  it("requires an explicit disclosure confirmation and maps bounded statuses", () => {
    expect(renderApprovalDisclosure(request())).toContain("future background runs");
    expect(parseApprovalDisclosure("yes")).toBe(true);
    expect(parseApprovalDisclosure("a")).toBe(false);
    expect(approvalStatusMessage("wrong_session")).toContain("another connection");
    expect(approvalStatusMessage("unknown")).toContain("rejected");
  });
});

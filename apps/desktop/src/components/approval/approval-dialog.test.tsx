import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CanonicalApprovalRequest } from "@taki/shared";
import { ApprovalDialog } from "./approval-dialog.tsx";

const request: CanonicalApprovalRequest = {
  approvalId: "11111111-1111-4111-8111-111111111111",
  expiresAt: "2026-08-14T00:01:00.000Z",
  policyGeneration: 3,
  approvalGeneration: 4,
  binding: {
    bindingRevision: 1,
    identity: { capabilityId: "mcp.tool.call", ownerHostId: "33333333-3333-4333-8333-333333333333" },
    descriptorRevision: 1,
    classifierId: "mcp.tool.call.v1",
    classifierRevision: 1,
    cellKey: "mcp-tool-call",
    decisionScopeDigest: "a".repeat(64),
  },
  disclosureRevision: 1,
  allowedChoices: ["allow_once", "allow_session", "allow_always", "deny"],
  presentation: {
    revision: 1,
    title: "Run MCP tool",
    capabilityLabel: "MCP tool",
    riskSummary: "This tool can change external state.",
    sections: [{ title: "Target", fields: [{ label: "Tool", value: "redacted-tool" }] }],
  },
};

describe("ApprovalDialog", () => {
  it("renders safe presentation, queue count, error feedback, and the Pet hit-test marker", () => {
    const html = renderToStaticMarkup(
      <ApprovalDialog
        request={request}
        queued={2}
        status={{ kind: "error", message: "审批状态已变化", dismissible: false }}
        disclosureAcknowledged={false}
        onDisclosureAcknowledged={() => undefined}
        onChoose={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(html).toContain("redacted-tool");
    expect(html).toContain("另有 2 个请求等待处理");
    expect(html).toContain('role="alert"');
    expect(html).toContain("data-keep-interactive");
    expect(html).toContain("我明确同意此长期允许也适用于未来后台运行");
    expect(html).not.toContain("披露版本");
    expect(html).not.toContain(request.approvalId);
    expect(html).not.toContain(request.binding.decisionScopeDigest);
    expect(html).toContain(request.presentation.title);
    expect(html).toContain(request.presentation.riskSummary);
    expect(html).toContain("disabled=\"\"");
  });

  it("keeps future-background-use consent as a separate requirement for the unchanged always choice", () => {
    for (const accepted of [false, true]) {
      const html = renderToStaticMarkup(
        <ApprovalDialog
          request={request}
          queued={0}
          status={{ kind: "ready" }}
          disclosureAcknowledged={accepted}
          onDisclosureAcknowledged={() => undefined}
          onChoose={() => undefined}
          onDismiss={() => undefined}
        />,
      );
      const always = html.match(/<button[^>]*>始终允许（含未来后台运行）<\/button>/)?.[0];
      expect(always).toBeDefined();
      expect(always?.includes('disabled=""')).toBe(!accepted);
      expect(html).toContain('type="checkbox"');
      expect(html).toContain("我明确同意此长期允许也适用于未来后台运行。");
      expect(html).not.toContain("披露版本");
      expect(html.match(/<button\b/g)).toHaveLength(request.allowedChoices.length);
    }
  });

  it("disables every choice while a response is in flight", () => {
    const html = renderToStaticMarkup(
      <ApprovalDialog
        request={request}
        queued={0}
        status={{ kind: "responding" }}
        disclosureAcknowledged={true}
        onDisclosureAcknowledged={() => undefined}
        onChoose={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(html.match(/disabled=""/g)).toHaveLength(request.allowedChoices.length + 1);
    expect(html).toContain("正在提交审批");
  });
});

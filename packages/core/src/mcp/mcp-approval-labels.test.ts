import { tool } from "ai";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalDurableDecision } from "@taki/shared";
import { approvalBindingDigest, approvalDecisionScopeDigest } from "../approval/approval-binding.ts";
import { approvalDecisionLabels } from "../approval/approval-labels.ts";
import { createMcpApprovalLabelResolver } from "./mcp-approval-labels.ts";
import type { McpToolSnapshot } from "./mcp-manager.ts";
import { stableSubjectId } from "./mcp-tool-identity.ts";

const HOST = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const SECOND_ID = "33333333-3333-4333-8333-333333333333";
const REF = { serverName: "github", toolName: "issues.search", subjectId: stableSubjectId("github", "issues.search"), subjectRevision: "cfg.1" };

function entry(overrides: Partial<McpToolSnapshot> = {}): McpToolSnapshot {
  return {
    toolKey: "opaque-routing-key", tool: tool({ description: "fixture", inputSchema: z.object({}) }),
    ref: REF, serverId: "github", ownerHostId: HOST, configRevision: 1, generation: 1, isCurrent: () => true,
    ...overrides,
  };
}

function decision(input: {
  ownerHostId?: string; subjectId?: string; subjectRevision?: string; capabilityId?: string; decisionId?: string;
} = {}): ApprovalDurableDecision {
  const scope = {
    bindingRevision: 1 as const,
    identity: {
      capabilityId: input.capabilityId ?? "mcp.tool.call", ownerHostId: input.ownerHostId ?? HOST,
      subject: { subjectId: input.subjectId ?? REF.subjectId, revision: input.subjectRevision ?? REF.subjectRevision },
    },
    descriptorRevision: 1, classifierId: "mcp-tool-call", classifierRevision: 1, cellKey: "mcp-tool-call",
  };
  const binding = { ...scope, decisionScopeDigest: approvalDecisionScopeDigest(scope), disclosureRevision: 1 as const };
  return {
    decisionId: input.decisionId ?? ID, binding, bindingDigest: approvalBindingDigest(binding), provenance: "operator",
    createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z",
  };
}

describe("MCP approval name projection", () => {
  it("reads a current snapshot lazily once for a whole batch and rebuilds it for the next list", () => {
    let entries: readonly McpToolSnapshot[] = [entry()];
    const read = vi.fn(() => entries);
    const resolver = createMcpApprovalLabelResolver(read);
    expect(read).not.toHaveBeenCalled();
    const rows = [decision(), decision({ decisionId: SECOND_ID })];
    const before = structuredClone(rows);
    const labels = approvalDecisionLabels(rows, resolver);
    expect(read).toHaveBeenCalledTimes(1);
    expect(labels.get(ID)?.subject).toBe("github · issues.search");
    expect(labels.get(SECOND_ID)?.subject).toBe("github · issues.search");
    expect(rows).toEqual(before);

    entries = [entry({ ref: { ...REF, subjectRevision: "cfg.2" } })];
    expect(approvalDecisionLabels(rows, resolver).get(ID)?.subject).toBe("当前无法确认服务器与工具名称");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ownerHostId: "44444444-4444-4444-8444-444444444444" },
    { subjectId: "mcp.other" },
    { subjectRevision: "cfg.2" },
  ])("does not borrow a name from a different exact binding: %j", (binding) => {
    const row = decision(binding);
    const labels = approvalDecisionLabels([row], createMcpApprovalLabelResolver(() => [entry()]));
    expect(labels.get(ID)).toEqual({ capability: "调用 MCP 工具", subject: "当前无法确认服务器与工具名称" });
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])("requires a valid current generation: %s", (generation) => {
    const labels = approvalDecisionLabels([decision()], createMcpApprovalLabelResolver(() => [entry({ generation })]));
    expect(labels.get(ID)?.subject).toBe("当前无法确认服务器与工具名称");
  });

  it("does not resolve retired or unavailable targets, or reinterpret another capability's subject", () => {
    const retired = createMcpApprovalLabelResolver(() => [entry({ isCurrent: () => false })]);
    expect(retired([decision()]).size).toBe(0);
    expect(createMcpApprovalLabelResolver(() => [])([decision()]).size).toBe(0);
    expect(createMcpApprovalLabelResolver(() => [entry()])([decision({ capabilityId: "skill.load" })]).size).toBe(0);
  });

  it("isolates a failed liveness probe and refuses ambiguous exact identities", () => {
    const broken = entry({
      ref: { ...REF, subjectId: "mcp.broken" },
      isCurrent: () => { throw new Error("retired source"); },
    });
    const resolver = createMcpApprovalLabelResolver(() => [broken, entry()]);
    expect(resolver([decision()]).get(ID)?.subject).toBe("github · issues.search");
    const ambiguous = createMcpApprovalLabelResolver(() => [entry(), entry({ ref: { ...REF, serverName: "other" } })]);
    expect(ambiguous([decision()]).size).toBe(0);
  });

  it("preserves maximum valid names within safe-list bounds and contains a source failure", () => {
    const ref = { serverName: "s".repeat(64), toolName: "工具".repeat(64), subjectId: "mcp.long", subjectRevision: "cfg.1" };
    const row = decision({ subjectId: ref.subjectId });
    const labels = approvalDecisionLabels([row], createMcpApprovalLabelResolver(() => [entry({ ref })]));
    expect(labels.get(ID)?.subject).toBe(`${ref.serverName} · ${ref.toolName}`);
    expect(labels.get(ID)?.subject).toHaveLength(195);
    const failed = createMcpApprovalLabelResolver(() => { throw new Error("snapshot unavailable"); });
    expect(approvalDecisionLabels([row], failed).get(ID)?.subject).toBe("当前无法确认服务器与工具名称");
  });
});

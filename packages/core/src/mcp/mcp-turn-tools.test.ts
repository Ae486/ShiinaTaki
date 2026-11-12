import { afterEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_METHODS, CanonicalApprovalRequestSchema, type CanonicalApprovalRequest } from "@taki/shared";
import { createApprovalDecisionService } from "../approval/approval-decision-service.ts";
import { createApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import { createApprovalStateRepo } from "../approval/approval-state-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createGovernancePolicyRepo } from "../governance/governance-policy-repo.ts";
import { createGovernancePolicyService } from "../governance/governance-policy-service.ts";
import type { Connection } from "../server/connection-registry.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { InMemoryTransport, memConnect, type CallHandler } from "../testing/mcp-test-transport.ts";
import { createMcpManager, type McpManager } from "./mcp-manager.ts";

const HOST = "11111111-1111-4111-8111-111111111111";
const dbs: Database[] = [];
const managers: McpManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
  for (const db of dbs.splice(0)) db.close();
});

describe("MCP live approval presentation", () => {
  it.each([
    { serverName: "github", toolName: "issues.search" },
    { serverName: "s".repeat(64), toolName: "工具".repeat(64) },
  ])("retains full names and exact execution binding for $serverName", async ({ serverName, toolName }) => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    dbs.push(db);
    const approval = createApprovalInteractionService(createApprovalDecisionService(createApprovalStateRepo(db)));
    const service = createGovernancePolicyService(createGovernancePolicyRepo(db));
    const requests: CanonicalApprovalRequest[] = [];
    const connection: Connection = {
      state: { status: "authenticated", deviceId: "operator", role: "operator", capabilities: [] },
      notify: (method, params) => {
        if (method === APPROVAL_METHODS.request) requests.push(CanonicalApprovalRequestSchema.parse(params));
      },
    };
    const call = vi.fn<CallHandler>((message) => ({
      jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "done" }] },
    }));
    const transport = new InMemoryTransport([
      { name: toolName, inputSchema: { type: "object", properties: { text: { type: "string" } } } },
    ], call);
    const manager = createMcpManager({
      logger: createCaptureLogger().logger, connect: memConnect(new Map([[serverName, transport]])),
      governance: { service, ownerHostId: HOST, approval },
    });
    managers.push(manager);
    await manager.applyDesired({
      serverId: serverName, ownerHostId: HOST, configRevision: 1, config: { command: "fixture" }, selectedTools: [], enabled: true,
    });
    const captured = manager.snapshot({ connection })[0]!;
    const running = captured.tool.execute!({ text: "PRIVATE_INPUT" }, { toolCallId: "name-test", messages: [], context: {} });
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.presentation).toEqual({
      revision: 1,
      title: "确认调用 MCP 工具",
      capabilityLabel: "调用 MCP 工具",
      subjectLabel: serverName,
      riskSummary: "此调用将交给所配置的 MCP 服务器处理，实际影响取决于该工具的功能。",
      sections: [{ title: "调用目标", fields: [{ label: "服务器", value: serverName }, { label: "工具", value: toolName }] }],
    });
    expect(JSON.stringify(request.presentation)).not.toContain("PRIVATE_INPUT");
    expect(JSON.stringify(request.presentation)).not.toContain(captured.ref.subjectId);
    expect(request.binding.identity).toEqual({
      capabilityId: "mcp.tool.call", ownerHostId: HOST,
      subject: { subjectId: captured.ref.subjectId, revision: captured.ref.subjectRevision },
    });
    expect(request.allowedChoices).toEqual(["allow_once", "allow_session", "allow_always", "deny"]);
    expect(call).not.toHaveBeenCalled();
    expect(approval.respond(connection, {
      approvalId: request.approvalId, choice: "allow_once", expectedApprovalGeneration: request.approvalGeneration,
    })).toEqual({ status: "accepted", approvalGeneration: 1 });
    await expect(running).resolves.toMatchObject({ content: [{ type: "text", text: "done" }] });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]?.[0].params).toEqual({ name: toolName, arguments: { text: "PRIVATE_INPUT" } });
    expect(manager.statuses()[0]?.leaseCount).toBe(0);
  });
});

import { tool } from "ai";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_METHODS, APPROVAL_PRESENTATION_REVISION, type CanonicalApprovalRequest } from "@taki/shared";
import { createApprovalDecisionService } from "../approval/approval-decision-service.ts";
import { createApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import { createApprovalStateRepo } from "../approval/approval-state-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import type { Connection } from "../server/connection-registry.ts";
import { createGovernancePolicyRepo } from "./governance-policy-repo.ts";
import { createGovernancePolicyService } from "./governance-policy-service.ts";
import { wrapGovernedTool } from "./governed-tool.ts";

const OWNER_HOST_ID = "11111111-1111-4111-8111-111111111111";
const dbs: Database[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function fixture(options: { interactive?: boolean } = {}) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  const governance = createGovernancePolicyService(createGovernancePolicyRepo(db));
  const approval = createApprovalInteractionService(createApprovalDecisionService(createApprovalStateRepo(db)));
  const notifications: Array<{ method: string; params: unknown }> = [];
  const connection: Connection = {
    state: { status: "authenticated", deviceId: "operator", role: "operator", capabilities: [] },
    notify: (method, params) => notifications.push({ method, params }),
  };
  const execute = vi.fn(() => ({ ok: true }));
  const wrapped = wrapGovernedTool(tool({ description: "echo", inputSchema: z.object({}), execute }), {
    service: governance,
    binding: {
      identity: {
        capabilityId: "mcp.tool.call",
        ownerHostId: OWNER_HOST_ID,
        subject: { subjectId: "mcp.server:tool", revision: "cfg.1" },
      },
      cellKey: "mcp-tool-call",
    },
    // An unattended turn constructs the same binding with NO interactive context: its ask must
    // fail closed with a bounded reason and never raise an ambient prompt on any socket.
    interactive: options.interactive === false ? undefined : {
      approval,
      connection,
      presentation: {
        revision: APPROVAL_PRESENTATION_REVISION,
        title: "Run configured MCP tool",
        capabilityLabel: "MCP tool",
        riskSummary: "This tool can access its configured server.",
        sections: [{ title: "Target", fields: [{ label: "Tool", value: "echo" }] }],
      },
    },
  });
  return { approval, connection, execute, governance, notifications, wrapped };
}

function requestOf(notifications: Array<{ method: string; params: unknown }>): CanonicalApprovalRequest {
  const notification = notifications.find((item) => item.method === APPROVAL_METHODS.request);
  if (!notification) throw new Error("approval request was not emitted");
  return notification.params as CanonicalApprovalRequest;
}

describe("wrapGovernedTool interactive authority", () => {
  it("executes the original closure exactly once after an ask is approved", async () => {
    const f = fixture();
    const pending = f.wrapped.execute?.({}, { toolCallId: "call-1", messages: [] } as never);
    const request = requestOf(f.notifications);

    expect(f.approval.respond(f.connection, {
      approvalId: request.approvalId,
      choice: "allow_once",
      expectedApprovalGeneration: request.approvalGeneration,
    })).toMatchObject({ status: "accepted" });

    await expect(pending).resolves.toEqual({ ok: true });
    expect(f.execute).toHaveBeenCalledTimes(1);
  });

  it("does not execute when Governance changes after Approval is accepted", async () => {
    const f = fixture();
    const pending = f.wrapped.execute?.({}, { toolCallId: "call-2", messages: [] } as never);
    const request = requestOf(f.notifications);
    f.approval.respond(f.connection, {
      approvalId: request.approvalId,
      choice: "allow_once",
      expectedApprovalGeneration: request.approvalGeneration,
    });
    const changed = f.governance.setCell({
      key: "mcp-tool-call", level: "standard", posture: "deny", expectedPolicyGeneration: request.policyGeneration,
    });
    f.approval.invalidatePolicy(changed.policyGeneration);

    await expect(pending).resolves.toMatchObject({ ok: false, code: "GOVERNANCE_DENIED" });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("fails a turn without an interactive context closed with no ambient prompt", async () => {
    const f = fixture({ interactive: false });
    await expect(f.wrapped.execute?.({}, { toolCallId: "call-3", messages: [] } as never)).resolves.toEqual({
      ok: false,
      code: "APPROVAL_REQUIRED",
      message: "approval requires an active operator connection",
    });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.notifications).toEqual([]);
  });
});

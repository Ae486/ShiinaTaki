import { tool } from "ai";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_DISCLOSURE_REVISION, APPROVAL_METHODS, type ApprovalChoice, type CanonicalApprovalRequest } from "@taki/shared";
import { createApprovalDecisionService } from "../approval/approval-decision-service.ts";
import { createApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import { createApprovalStateRepo } from "../approval/approval-state-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { fakeOperator } from "../testing/capability-tool-harness.ts";
import { createGovernancePolicyRepo } from "./governance-policy-repo.ts";
import { createGovernancePolicyService } from "./governance-policy-service.ts";
import { wrapGovernedTool, type GovernedToolBinding } from "./governed-tool.ts";

const HOST = "11111111-1111-4111-8111-111111111111";
const binding: GovernedToolBinding = { identity: { capabilityId: "mcp.tool.call", ownerHostId: HOST,
  subject: { subjectId: "mcp.server:probe", revision: "cfg.1" } }, cellKey: "mcp-tool-call" };
const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  const authority = createApprovalDecisionService(createApprovalStateRepo(db));
  const approval = createApprovalInteractionService(authority);
  const service = createGovernancePolicyService(createGovernancePolicyRepo(db));
  const notifications: CanonicalApprovalRequest[] = [];
  const connection = fakeOperator();
  connection.notify = (method, params) => { if (method === APPROVAL_METHODS.request) notifications.push(params as CanonicalApprovalRequest); };
  const execute = vi.fn(async () => ({ ok: true }));
  const base = tool({ inputSchema: z.object({}), execute });
  const unattended = (subjectBinding = binding) => wrapGovernedTool(base, { service, binding: subjectBinding, approval });
  const grant = async (choice: ApprovalChoice) => {
    const interactive = wrapGovernedTool(base, { service, binding, interactive: { approval, connection,
      presentation: { revision: 1, title: "Allow", capabilityLabel: "Probe", riskSummary: "Read configured server",
        sections: [{ title: "Target", fields: [{ label: "Tool", value: "probe" }] }] } } });
    const result = interactive.execute!({}, { toolCallId: "grant", messages: [] } as never);
    const request = notifications.at(-1)!;
    const response = approval.respond(connection, { approvalId: request.approvalId, choice,
      expectedApprovalGeneration: request.approvalGeneration,
      ...(choice === "allow_always" ? { disclosure: { revision: APPROVAL_DISCLOSURE_REVISION, futureBackgroundUseAccepted: true } } : {}) });
    expect(response.status).toBe("accepted");
    await result; execute.mockClear(); notifications.splice(0);
  };
  return { authority, approval, service, execute, notifications, unattended, grant };
}

describe("unattended canonical tool authority", () => {
  it("uses an exact usable durable grant with no socket and rechecks revocation for every invocation", async () => {
    const f = fixture();
    const captured = f.unattended();
    await f.grant("allow_always");
    await expect(captured.execute!({}, { toolCallId: "background", messages: [] } as never)).resolves.toEqual({ ok: true });
    expect(f.execute).toHaveBeenCalledOnce();
    const decision = f.authority.list()[0]!;
    f.approval.revoke(decision.decisionId, f.approval.approvalGeneration());
    await expect(captured.execute!({}, { toolCallId: "revoked", messages: [] } as never))
      .resolves.toMatchObject({ ok: false, code: "APPROVAL_REQUIRED" });
    expect(f.execute).toHaveBeenCalledOnce(); expect(f.notifications).toEqual([]);
  });

  it.each([undefined, "allow_once", "allow_session"] as const)("never promotes %s authority into an unrelated background Run", async (choice) => {
    const f = fixture(); if (choice) await f.grant(choice);
    await expect(f.unattended().execute!({}, { toolCallId: "background", messages: [] } as never))
      .resolves.toMatchObject({ ok: false, code: "APPROVAL_REQUIRED" });
    expect(f.execute).not.toHaveBeenCalled(); expect(f.notifications).toEqual([]);
  });

  it.each([
    { identity: { ...binding.identity, ownerHostId: "22222222-2222-4222-8222-222222222222" } },
    { identity: { ...binding.identity, subject: { subjectId: "mcp.server:other", revision: "cfg.1" } } },
    { identity: { ...binding.identity, subject: { subjectId: "mcp.server:probe", revision: "cfg.2" } } },
  ])("does not transfer a durable grant across exact Host/subject/revision bindings", async (change) => {
    const f = fixture(); await f.grant("allow_always");
    await expect(f.unattended({ ...binding, ...change }).execute!({}, { toolCallId: "background", messages: [] } as never))
      .resolves.toMatchObject({ ok: false, code: "APPROVAL_REQUIRED" });
    expect(f.execute).not.toHaveBeenCalled(); expect(f.notifications).toEqual([]);
  });

  it("keeps an explicit deny authoritative over an existing durable grant", async () => {
    const f = fixture(); await f.grant("allow_always");
    f.service.setCell({ key: "mcp-tool-call", level: "standard", posture: "deny", expectedPolicyGeneration: f.service.level().policyGeneration });
    await expect(f.unattended().execute!({}, { toolCallId: "denied", messages: [] } as never))
      .resolves.toMatchObject({ ok: false, code: "GOVERNANCE_DENIED" });
    expect(f.execute).not.toHaveBeenCalled();
  });
});

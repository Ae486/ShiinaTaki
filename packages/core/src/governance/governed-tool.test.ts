import { tool, type Tool } from "ai";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_METHODS, APPROVAL_PRESENTATION_REVISION, type CanonicalApprovalRequest, type RunEvent } from "@taki/shared";
import { createApprovalDecisionService } from "../approval/approval-decision-service.ts";
import { createApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import { createApprovalStateRepo } from "../approval/approval-state-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import type { Connection } from "../server/connection-registry.ts";
import { createGovernancePolicyRepo } from "./governance-policy-repo.ts";
import { createGovernancePolicyService } from "./governance-policy-service.ts";
import { wrapGovernedTool, type GovernedDispatchLease } from "./governed-tool.ts";
import { createEffectRepo } from "../db/effect-repo.ts";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { createEffectLifecycleService } from "../harness/effect-lifecycle-service.ts";

const OWNER_HOST_ID = "11111111-1111-4111-8111-111111111111";
const dbs: Database[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function fixture(options: { interactive?: boolean; phase?: () => void; lease?: GovernedDispatchLease } = {}) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  const governance = createGovernancePolicyService(createGovernancePolicyRepo(db));
  const observed: Array<Omit<RunEvent, "eventId" | "seq">> = [];
  const approval = createApprovalInteractionService(
    createApprovalDecisionService(createApprovalStateRepo(db)), (event) => observed.push(event),
  );
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
    dispatchLease: options.lease,
    // An unattended turn constructs the same binding with NO interactive context: its ask must
    // fail closed with a bounded reason and never raise an ambient prompt on any socket.
    interactive: options.interactive === false ? undefined : {
      approval,
      connection,
      toolObserver: { bindEffect: () => undefined, phase: options.phase },
      presentation: {
        revision: APPROVAL_PRESENTATION_REVISION,
        title: "Run configured MCP tool",
        capabilityLabel: "MCP tool",
        riskSummary: "This tool can access its configured server.",
        sections: [{ title: "Target", fields: [{ label: "Tool", value: "echo" }] }],
      },
    },
  });
  return { approval, connection, execute, governance, notifications, observed, wrapped, db };
}

function requestOf(notifications: Array<{ method: string; params: unknown }>): CanonicalApprovalRequest {
  const notification = notifications.find((item) => item.method === APPROVAL_METHODS.request);
  if (!notification) throw new Error("approval request was not emitted");
  return notification.params as CanonicalApprovalRequest;
}

describe("wrapGovernedTool interactive authority", () => {
  it.each([
    { asynchronous: false, cancelled: false }, { asynchronous: true, cancelled: false },
    { asynchronous: false, cancelled: true }, { asynchronous: true, cancelled: true },
  ])("settles a thrown execute exactly once (async=$asynchronous, cancelled=$cancelled)", async ({ asynchronous, cancelled }) => {
    const f = failureFixture();
    const controller = new AbortController();
    const failure = new Error("private_payload_marker");
    const fail = () => { if (cancelled) controller.abort(); throw failure; };
    const execute = vi.fn(asynchronous ? async () => fail() : fail);
    const wrapped = f.wrap(execute, { signal: controller.signal });
    await expect(wrapped.execute!({}, { toolCallId: "failed", messages: [], context: {} })).rejects.toBe(failure);
    expect(execute).toHaveBeenCalledOnce();
    expect(f.effects.unfinished("r")).toEqual([]);
    expect(f.db.prepare("SELECT state,outcome,error_code FROM run_effects").get()).toMatchObject({
      state: "terminal", outcome: cancelled ? "cancelled" : "failed", error_code: cancelled ? "cancelled" : "tool_error",
    });
    const settlements = f.eventRepo.list("r").filter((event) => event.kind === "effect.settled");
    expect(settlements).toHaveLength(1);
    expect(JSON.stringify(settlements)).not.toContain("private_payload_marker");
  });

  it.each(["intent", "observer", "settlement"] as const)("does not disguise a %s authority failure as an execute failure", async (stage) => {
    const f = failureFixture();
    const failure = new Error(`authority_${stage}`);
    const fail = () => { throw failure; };
    const execute = vi.fn(() => ({ ok: true }));
    const settle = vi.spyOn(f.effects, "settle");
    if (stage === "settlement") settle.mockImplementation(fail);
    const wrapped = f.wrap(execute, {
      onIntent: stage === "intent" ? fail : undefined,
      bindEffect: stage === "observer" ? fail : undefined,
    });
    await expect(wrapped.execute!({}, { toolCallId: "authority", messages: [], context: {} })).rejects.toBe(failure);
    expect(execute).toHaveBeenCalledTimes(stage === "settlement" ? 1 : 0);
    expect(settle).toHaveBeenCalledTimes(stage === "settlement" ? 1 : 0);
    expect(f.effects.unfinished("r")).toHaveLength(1);
  });

  it.each([
    { output: { ok: true }, outcome: "completed", errorCode: undefined },
    { output: { isError: true, content: [{ type: "text", text: "private_payload_marker" }] }, outcome: "failed", errorCode: "mcp_tool_error" },
    { output: { ok: false, error: { code: "MEMORY_OUTCOME_UNKNOWN", message: "private_payload_marker" } }, outcome: "outcome_unknown", errorCode: "memory_outcome_unknown" },
    { output: { ok: false, error: { code: "MEMORY_OPERATION_CANCELLED", message: "private_payload_marker" } }, outcome: "cancelled", errorCode: "memory_operation_cancelled" },
    { output: { ok: false, code: "private_payload_marker" }, outcome: "failed", errorCode: "tool_failed" },
  ])("settles the accepted raw tool outcome as $outcome/$errorCode without copying payload diagnostics", async ({ output, outcome, errorCode }) => {
    const f = fixture();
    const eventRepo = createRunEventRepo(f.db);
    const effects = createEffectLifecycleService(createEffectRepo(f.db, eventRepo), undefined, { eventRepo });
    f.db.exec(`
      INSERT INTO run_snapshots (snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at)
      VALUES ('s','r','harness.v1','{}','${"a".repeat(64)}','2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z');
      INSERT INTO runs (run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,
        delivery_class,state,state_version,snapshot_id,active_attempt_id,queued_at,operation_phase,created_at,updated_at)
      VALUES ('r','c','t','i','h','primary','{}','class_a','running',0,'s','a','2026-08-25T00:00:00.000Z',
        'executing','2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z');
      INSERT INTO run_attempts (attempt_id,run_id,ordinal,state,state_version,provider,model_id,snapshot_id)
      VALUES ('a','r',1,'effect_running',0,'p','m','s');
    `);
    const execute = vi.fn(async () => output);
    const wrapped = wrapGovernedTool(tool({ inputSchema: z.object({}), execute }), {
      service: f.governance,
      binding: {
        identity: { capabilityId: "mcp.tool.call", ownerHostId: OWNER_HOST_ID, subject: { subjectId: "mcp.server:tool", revision: "cfg.1" } },
        cellKey: "mcp-tool-call",
      },
      interactive: {
        approval: f.approval, connection: f.connection, effects, runId: "r", attemptId: "a",
        presentation: { revision: APPROVAL_PRESENTATION_REVISION, title: "Allow", capabilityLabel: "echo", riskSummary: "risk",
          sections: [{ title: "Target", fields: [{ label: "Tool", value: "echo" }] }] },
      },
    });
    const pending = wrapped.execute?.({}, { toolCallId: "call", messages: [] } as never);
    const request = requestOf(f.notifications);
    expect(execute).not.toHaveBeenCalled();
    f.approval.respond(f.connection, { approvalId: request.approvalId, choice: "allow_once", expectedApprovalGeneration: request.approvalGeneration });
    await expect(pending).resolves.toBe(output);
    expect(execute).toHaveBeenCalledOnce();
    const settlement = eventRepo.list("r").filter((event) => event.kind === "effect.settled");
    expect(settlement).toHaveLength(1);
    expect(settlement[0]?.payload).toMatchObject({ outcome, ...(errorCode ? { errorCode } : {}) });
    expect(JSON.stringify(settlement)).not.toContain("private_payload_marker");
  });

  it("records one waiting tool effect then commits intent only after approval", async () => {
    const f = fixture();
    const eventRepo = createRunEventRepo(f.db);
    const effects = createEffectLifecycleService(createEffectRepo(f.db, eventRepo), undefined, { eventRepo });
    const bindEffect = vi.fn();
    const phaseFacts: Array<{ phase: string; executions: number; state: unknown }> = [];
    const phase = vi.fn((event: { phase: string }) => phaseFacts.push({ phase: event.phase,
      executions: f.execute.mock.calls.length, state: f.db.prepare("SELECT state FROM run_effects").get()?.state }));
    f.db.exec("INSERT INTO run_snapshots (snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at) VALUES ('s','r','harness.v1','{}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z'); INSERT INTO runs (run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,delivery_class,state,state_version,snapshot_id,active_attempt_id,queued_at,operation_phase,created_at,updated_at) VALUES ('r','c','t','i','h','primary','{}','class_a','running',0,'s','a','2026-08-25T00:00:00.000Z','executing','2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z'); INSERT INTO run_attempts (attempt_id,run_id,ordinal,state,state_version,provider,model_id,snapshot_id) VALUES ('a','r',1,'effect_running',0,'p','m','s');");
    const wrapped = wrapGovernedTool(tool({ description: "echo", inputSchema: z.object({}), execute: f.execute }), { service: f.governance, binding: { identity: { capabilityId: "mcp.tool.call", ownerHostId: OWNER_HOST_ID, subject: { subjectId: "mcp.server:tool", revision: "cfg.1" } }, cellKey: "mcp-tool-call" }, interactive: { approval: f.approval, connection: f.connection, effects, runId: "r", attemptId: "a", toolObserver: { bindEffect, phase }, presentation: { revision: APPROVAL_PRESENTATION_REVISION, title: "Allow", capabilityLabel: "echo", riskSummary: "risk", sections: [{ title: "Target", fields: [{ label: "Tool", value: "echo" }] }] } } });
    const pending = wrapped.execute?.({}, { toolCallId: "call-effect", messages: [] } as never);
    const request = requestOf(f.notifications);
    expect(f.db.prepare("SELECT state FROM run_effects").get()?.state).toBe("waiting");
    expect(phaseFacts).toEqual([{ phase: "approval", executions: 0, state: "waiting" }]);
    f.approval.respond(f.connection, { approvalId: request.approvalId, choice: "allow_once", expectedApprovalGeneration: request.approvalGeneration });
    await expect(pending).resolves.toEqual({ ok: true });
    expect(f.db.prepare("SELECT state FROM run_effects").get()?.state).toBe("terminal");
    expect(bindEffect).toHaveBeenCalledWith({ toolCallId: "call-effect", effectId: expect.any(String) });
    expect(phaseFacts.at(-1)).toEqual({ phase: "executing", executions: 0, state: "intent_committed" });
    expect(eventRepo.list("r").filter((event) => event.kind === "governance.evaluated")).toHaveLength(2);
    expect(f.observed.map((event) => event.kind)).toEqual(["approval.requested", "approval.decided"]);
    expect(JSON.stringify(f.observed)).not.toContain("risk");
    expect(JSON.stringify(f.observed)).not.toContain("Run configured MCP tool");
  });

  it("does not let a display observer failure suppress an approved underlying dispatch", async () => {
    const phase = vi.fn(() => { throw new Error("display observer failed"); });
    const f = fixture({ phase });
    const pending = f.wrapped.execute?.({}, { toolCallId: "call", messages: [] } as never);
    const request = requestOf(f.notifications);
    f.approval.respond(f.connection, { approvalId: request.approvalId, choice: "allow_once", expectedApprovalGeneration: request.approvalGeneration });
    await expect(pending).resolves.toEqual({ ok: true });
    expect(f.execute).toHaveBeenCalledOnce();
    expect(phase).toHaveBeenCalledOnce();
  });

  it("never reports dispatch when the captured lease refuses after approval", async () => {
    const phase = vi.fn();
    const unavailable = { ok: false, code: "MCP_STALE_GENERATION" };
    const f = fixture({ phase, lease: { acquire: () => false, release: () => undefined, unavailable } });
    const pending = f.wrapped.execute?.({}, { toolCallId: "call", messages: [] } as never);
    const request = requestOf(f.notifications);
    f.approval.respond(f.connection, { approvalId: request.approvalId, choice: "allow_once", expectedApprovalGeneration: request.approvalGeneration });
    await expect(pending).resolves.toBe(unavailable);
    expect(phase).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });

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

function failureFixture() {
  const f = fixture();
  const eventRepo = createRunEventRepo(f.db);
  const effects = createEffectLifecycleService(createEffectRepo(f.db, eventRepo), undefined, { eventRepo });
  f.db.exec(`
    INSERT INTO run_snapshots (snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at)
    VALUES ('s','r','harness.v1','{}','${"a".repeat(64)}','2026-10-30T00:00:00.000Z','2026-10-30T00:00:00.000Z');
    INSERT INTO runs (run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,
      delivery_class,state,state_version,snapshot_id,active_attempt_id,queued_at,operation_phase,created_at,updated_at)
    VALUES ('r','c','t','i','h','primary','{}','class_a','running',0,'s','a','2026-10-30T00:00:00.000Z',
      'executing','2026-10-30T00:00:00.000Z','2026-10-30T00:00:00.000Z');
    INSERT INTO run_attempts (attempt_id,run_id,ordinal,state,state_version,provider,model_id,snapshot_id)
    VALUES ('a','r',1,'effect_running',0,'p','m','s');
  `);
  return { ...f, eventRepo, effects, wrap(execute: NonNullable<Tool["execute"]>, options: {
    signal?: AbortSignal; onIntent?(): void; bindEffect?(): void;
  }) {
    return wrapGovernedTool(tool({ inputSchema: z.object({}), execute }), { service: f.governance,
      binding: { identity: { capabilityId: "core.subagent.result", ownerHostId: OWNER_HOST_ID }, cellKey: "subagent-result",
        effect: { sourceRef: { type: "tool", toolName: "core.subagent.result" }, onIntent: options.onIntent } },
      effect: { runId: "r", attemptId: "a", effects, signal: options.signal,
        toolObserver: options.bindEffect ? { bindEffect: options.bindEffect } : undefined } });
  } };
}

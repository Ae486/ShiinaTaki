import { tool } from "ai";
import { z } from "zod";
import { afterAll, describe, expect, it } from "vitest";
import { lifecycleProjection, replayRunEvents } from "../db/run-event-projection.ts";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { createEffectRepo } from "../db/effect-repo.ts";
import { createEffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createConversationStore } from "./conversation-store.ts";
import { createChatAgent } from "./chat-agent.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createCanonicalLocalRuntime } from "../memory/canonical-local-runtime.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createGovernancePolicyRepo } from "../governance/governance-policy-repo.ts";
import { createGovernancePolicyService } from "../governance/governance-policy-service.ts";
import { createCoreToolGovernanceAdapter } from "../governance/core-tool-governance-adapter.ts";
import { createApprovalDecisionService } from "../approval/approval-decision-service.ts";
import { createApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import { createApprovalStateRepo } from "../approval/approval-state-repo.ts";
import { wrapGovernedTool } from "../governance/governed-tool.ts";
import { prepareHostIntent, settleHostEffect } from "../capabilities/capability-effect-lifecycle.ts";
import type { CapabilityBrokerState, PendingCapability } from "../capabilities/capability-broker-state.ts";
import type { Connection } from "../server/connection-registry.ts";
import type { ApprovalPresentation, HostOperationControl } from "@taki/shared";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_HOST_ID = "33333333-3333-4333-8333-333333333333";
const RAW_MEMORY_SENTINEL = "whole-slice-raw-memory-sentinel";
const dbs: Database[] = [];

const OPERATOR: Connection = {
  state: { status: "authenticated", deviceId: "whole-slice-operator", role: "operator", capabilities: [] },
};

describe("Slice 3 whole-slice Core integration", () => {
  it("runs Model -> canonical Memory -> Governance/Approval/MCP and Host settlement once", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    dbs.push(db);
    seedCanonicalMemory(db);
    seedRun(db);

    const authority = createCanonicalMemoryAuthorityRepo(db);
    const epoch = authority.activeEpoch("44444444-4444-4444-8444-444444444444");
    const memory = createCanonicalLocalRuntime({ db, epochId: epoch.epochId });
    const governance = createGovernancePolicyService(createGovernancePolicyRepo(db));
    const approval = createApprovalInteractionService(createApprovalDecisionService(createApprovalStateRepo(db)));
    const effects = createEffectLifecycleService(createEffectRepo(db, createRunEventRepo(db)));
    const coreGovernance = createCoreToolGovernanceAdapter(governance, OWNER_HOST_ID, approval);
    const timeline = createTimelineRepo(db);
    const conversation = createConversationStore({ repo: timeline });
    const agent = createChatAgent({
      model: scriptedModel([
        { kind: "tool", toolCallId: "memory-call", toolName: "retain", input: { content: RAW_MEMORY_SENTINEL, layer: "profile", context: null } },
        { kind: "text", deltas: ["记住了"] },
      ]),
      store: conversation,
      memory,
      coreToolGovernance: coreGovernance,
      effectLifecycle: effects,
    });

    await drain(agent.stream({ characterId: "taki", message: "请记住这个事实" }, { connection: OPERATOR, runId: RUN_ID, attemptId: ATTEMPT_ID }));

    const notifications: Array<{ method: string; params: unknown }> = [];
    const mcpExecute = async () => ({ ok: true });
    const mcpConnection: Connection = { ...OPERATOR, notify: (method, params) => notifications.push({ method, params }) };
    const mcpTool = wrapGovernedTool(tool({ description: "MCP echo", inputSchema: z.object({}), execute: mcpExecute }), {
      service: governance,
      binding: { identity: { capabilityId: "mcp.tool.call", ownerHostId: OWNER_HOST_ID, subject: { subjectId: "mcp.server:echo", revision: "cfg.1" } }, cellKey: "mcp-tool-call" },
      interactive: {
        approval,
        connection: mcpConnection,
        effects,
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        presentation: mcpPresentation,
      },
    });
    const pendingMcp = mcpTool.execute?.({}, { toolCallId: "mcp-call", messages: [] } as never);
    const request = notifications.find((item) => item.method === "approval.request")?.params as { approvalId: string; approvalGeneration: number } | undefined;
    expect(request).toBeDefined();
    approval.respond(mcpConnection, { approvalId: request!.approvalId, choice: "allow_once", expectedApprovalGeneration: request!.approvalGeneration });
    await expect(pendingMcp).resolves.toEqual({ ok: true });

    const hostControl = hostControlFor(RUN_ID, ATTEMPT_ID);
    const pendingHost = {
      control: hostControl,
      input: { raw: "host-input-never-persisted" },
      target: {},
      execution: "read",
      cancellation: "cooperative",
      finish: () => undefined,
      timer: setTimeout(() => undefined, 60_000),
    } as unknown as PendingCapability;
    const hostState = {
      effects,
      approval,
      log: { info: () => undefined } as never,
      now: () => Date.now(),
      pending: new Map(),
      terminal: new Map(),
    } satisfies CapabilityBrokerState;
    expect(prepareHostIntent(hostState, pendingHost)).toBe(true);
    expect(settleHostEffect(hostState, pendingHost, { ok: false, code: "OUTCOME_UNKNOWN", message: "transport ended", state: "outcome_unknown" })).toBe(true);
    clearTimeout(pendingHost.timer);
    const stale = effects.settle({ effectId: hostControl.effectId!, runId: RUN_ID, attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedVersion: 0, outcome: "completed" });
    expect(stale.stale).toBe(true);

    const effectsRows = db.prepare("SELECT effect_id,kind,state,outcome,source_ref_json,executor_ref_json FROM run_effects WHERE run_id=:run ORDER BY created_at,effect_id").all({ run: RUN_ID }) as Array<Record<string, unknown>>;
    expect(effectsRows.filter((row) => row.kind === "memory")).toHaveLength(1);
    expect(effectsRows.filter((row) => row.kind === "memory" && row.state === "terminal" && row.outcome === "completed")).toHaveLength(1);
    expect(effectsRows.filter((row) => row.kind === "model")).toHaveLength(2);
    expect(effectsRows.filter((row) => String(row.source_ref_json).includes('"type":"host"'))).toHaveLength(1);
    expect(effectsRows.filter((row) => String(row.source_ref_json).includes('"toolName":"mcp.tool.call"'))).toHaveLength(1);
    expect(effectsRows.filter((row) => row.outcome === "outcome_unknown")).toHaveLength(1);
    expect(effectsRows.map((row) => JSON.stringify(row)).join("\n")).not.toContain(RAW_MEMORY_SENTINEL);

    const events = createRunEventRepo(db).list(RUN_ID);
    const projection = replayRunEvents(events, lifecycleProjection);
    expect(projection.milestones.filter((item) => item.label === "effect intent committed")).toHaveLength(5);
    expect(projection.milestones.filter((item) => item.label === "effect settled")).toHaveLength(5);
    expect(JSON.stringify(events)).not.toContain(RAW_MEMORY_SENTINEL);
    expect(conversation.history("taki").map((message) => message.role)).toEqual(["user", "assistant", "tool", "assistant"]);
  }, 60_000);
});

afterAll(() => {
  for (const db of dbs.splice(0)) db.close();
});

async function drain(stream: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const delta of stream) text += delta;
  return text;
}

function seedCanonicalMemory(db: Database): void {
  const epoch = "44444444-4444-4444-8444-444444444444";
  const now = "2026-08-25T00:00:00.000Z";
  const authority = createCanonicalMemoryAuthorityRepo(db);
  db.prepare("INSERT INTO canonical_memory_authority_epochs (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason) VALUES (:epoch,'local','e2e-lineage','active',NULL,:now,NULL,'initial-local')").run({ epoch, now });
  db.prepare("INSERT INTO canonical_memory_authority_state (singleton,active_epoch_id,updated_at) VALUES (1,:epoch,:now)").run({ epoch, now });
  authority.createBank({ authorityEpochId: epoch, bankId: "global", scope: { kind: "global", characterId: null }, name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "e2e", config: {}, createdAt: now, updatedAt: now });
  authority.createBank({ authorityEpochId: epoch, bankId: "character", scope: { kind: "character", characterId: "taki" }, name: "Taki", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "e2e", config: {}, createdAt: now, updatedAt: now });
  db.prepare("UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,verified_snapshot_id='snapshot',activation_transaction_id='activation',updated_at=:now WHERE singleton=1").run({ epoch, now });
}

function seedRun(db: Database): void {
  const now = "2026-08-25T00:00:00.000Z";
  db.exec(`INSERT INTO run_snapshots (snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at) VALUES ('snapshot','${RUN_ID}','harness.v1','{}','${"a".repeat(64)}','${now}','${now}');
    INSERT INTO runs (run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,delivery_class,state,state_version,snapshot_id,active_attempt_id,queued_at,operation_phase,created_at,updated_at) VALUES ('${RUN_ID}','taki','trigger','idempotency','${"b".repeat(64)}','primary','{}','class_a','running',0,'snapshot','${ATTEMPT_ID}','${now}','executing','${now}','${now}');
    INSERT INTO run_attempts (attempt_id,run_id,ordinal,state,state_version,provider,model_id,snapshot_id) VALUES ('${ATTEMPT_ID}','${RUN_ID}',1,'effect_running',0,'test','test-model','snapshot');`);
}

function hostControlFor(runId: string, attemptId: string): HostOperationControl {
  const operationId = "55555555-5555-4555-8555-555555555555";
  return {
    runId,
    coreAttemptId: attemptId,
    effectId: "66666666-6666-4666-8666-666666666666",
    operationId,
    attemptId: "77777777-7777-4777-8777-777777777777",
    targetHostId: OWNER_HOST_ID,
    connectionGeneration: 1,
    catalogGeneration: 1,
    policyGeneration: 1,
    governanceProjection: { registryRevision: 1, descriptorRevision: 1, classifierRevision: 1, cells: [{ key: "process-list", posture: "auto" }], digest: "c".repeat(64) },
    approvalGeneration: 1,
    capabilityId: "process-list",
    inputDigest: "d".repeat(64),
    idempotencyKey: "88888888-8888-4888-8888-888888888888",
    dispatchedAt: "2026-08-25T00:00:00.000Z",
    deadlineAt: "2026-08-25T00:10:00.000Z",
  };
}

const mcpPresentation: ApprovalPresentation = {
  revision: 1,
  title: "Allow MCP tool",
  capabilityLabel: "MCP echo",
  riskSummary: "Configured MCP tool call",
  sections: [{ title: "Target", fields: [{ label: "Tool", value: "echo" }] }],
};

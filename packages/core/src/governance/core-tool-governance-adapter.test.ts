import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  CANONICAL_GOVERNANCE_REGISTRY,
  createGovernanceRegistry,
  type GovernanceRegistry,
} from "@taki/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createCoreToolGovernanceAdapter } from "./core-tool-governance-adapter.ts";
import { createGovernancePolicyRepo } from "./governance-policy-repo.ts";
import { createGovernancePolicyService } from "./governance-policy-service.ts";
import { attachMemoryEffectMetadata } from "../memory/canonical-tools/memory-effect-tool.ts";
import { createEffectRepo } from "../db/effect-repo.ts";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { createEffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { createApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import { createApprovalDecisionService } from "../approval/approval-decision-service.ts";
import { createApprovalStateRepo } from "../approval/approval-state-repo.ts";

const OWNER_HOST_ID = "11111111-1111-4111-8111-111111111111";
const BUILTIN_KEYS = [
  "get_current_time",
  "memory_search",
  "memory_write",
  "memory_archive",
  "recall",
  "reflect",
  "retain",
  "update_memory",
  "invalidate_memory",
  "restore_memory",
  "avatar_set_expression",
  "avatar_play_motion",
  "read_file",
  "write_file",
] as const;

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function service(registry: GovernanceRegistry = CANONICAL_GOVERNANCE_REGISTRY) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  return createGovernancePolicyService(createGovernancePolicyRepo(db), registry);
}

function executableTools(keys: readonly string[], called: string[]): ToolSet {
  return Object.fromEntries(keys.map((key) => [key, tool({
    description: key,
    inputSchema: z.object({}),
    execute: () => {
      called.push(key);
      return { ok: true, key };
    },
  })]));
}

describe("createCoreToolGovernanceAdapter", () => {
  it("has an explicit executable binding for every current Core built-in", async () => {
    const called: string[] = [];
    const wrapped = createCoreToolGovernanceAdapter(service(), OWNER_HOST_ID)
      .wrap(executableTools(BUILTIN_KEYS, called));

    for (const key of BUILTIN_KEYS) {
      await wrapped[key]?.execute?.({}, { toolCallId: key, messages: [] } as never);
    }

    expect(called).toEqual(BUILTIN_KEYS);
  });

  it("maps canonical memory tools onto the existing default-auto memory cells", async () => {
    const governance = service();
    const authorize = vi.spyOn(governance, "authorize");
    const keys = ["recall", "reflect", "retain", "update_memory", "invalidate_memory", "restore_memory"] as const;
    const wrapped = createCoreToolGovernanceAdapter(governance, OWNER_HOST_ID)
      .wrap(executableTools(keys, []));

    for (const key of keys) {
      await wrapped[key]?.execute?.({}, { toolCallId: key, messages: [] } as never);
    }

    expect(authorize.mock.calls.map(([binding]) => binding)).toEqual([
      { identity: { capabilityId: "core.memory.search", ownerHostId: OWNER_HOST_ID }, cellKey: "memory-search" },
      { identity: { capabilityId: "core.memory.search", ownerHostId: OWNER_HOST_ID }, cellKey: "memory-search" },
      { identity: { capabilityId: "core.memory.write", ownerHostId: OWNER_HOST_ID }, cellKey: "memory-write" },
      { identity: { capabilityId: "core.memory.write", ownerHostId: OWNER_HOST_ID }, cellKey: "memory-write" },
      { identity: { capabilityId: "core.memory.archive", ownerHostId: OWNER_HOST_ID }, cellKey: "memory-archive" },
      { identity: { capabilityId: "core.memory.write", ownerHostId: OWNER_HOST_ID }, cellKey: "memory-write" },
    ]);
  });

  it("fails an unknown Core tool key closed without calling its closure", async () => {
    const called: string[] = [];
    const wrapped = createCoreToolGovernanceAdapter(service(), OWNER_HOST_ID)
      .wrap(executableTools(["unknown_core_tool"], called));

    expect(await wrapped.unknown_core_tool?.execute?.(
      {}, { toolCallId: "unknown", messages: [] } as never,
    )).toMatchObject({ ok: false, code: "GOVERNANCE_DENIED" });
    expect(called).toEqual([]);
  });

  it("does not execute a known closure when its descriptor cell no longer matches", async () => {
    const registry = createGovernanceRegistry({
      ...CANONICAL_GOVERNANCE_REGISTRY,
      descriptors: CANONICAL_GOVERNANCE_REGISTRY.descriptors.map((descriptor) =>
        descriptor.capabilityId === "core.time.read"
          ? { ...descriptor, cells: [{ ...descriptor.cells[0]!, key: "time-read-revised" }] }
          : descriptor),
    });
    const called: string[] = [];
    const wrapped = createCoreToolGovernanceAdapter(service(registry), OWNER_HOST_ID)
      .wrap(executableTools(["get_current_time"], called));

    expect(await wrapped.get_current_time?.execute?.(
      {}, { toolCallId: "time", messages: [] } as never,
    )).toMatchObject({ ok: false, code: "GOVERNANCE_DENIED" });
    expect(called).toEqual([]);
  });

  it("records an explicit canonical Memory tool as one memory Effect with bounded authority metadata", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    dbs.push(db);
    db.exec("INSERT INTO run_snapshots (snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at) VALUES ('s','r','harness.v1','{}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z'); INSERT INTO runs (run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,delivery_class,state,state_version,snapshot_id,active_attempt_id,queued_at,operation_phase,created_at,updated_at) VALUES ('r','c','t','i','h','primary','{}','class_a','running',0,'s','a','2026-08-25T00:00:00.000Z','executing','2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z'); INSERT INTO run_attempts (attempt_id,run_id,ordinal,state,state_version,provider,model_id,snapshot_id) VALUES ('a','r',1,'effect_running',0,'p','m','s');");
    const caps = { providerId: "local", contractVersion: 1 as const, retain: true, recall: true, reflect: false, edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };
    const original = attachMemoryEffectMetadata(tool({ description: "memory", inputSchema: z.object({}), execute: async (_input, options) => ({ ok: true, effect: typeof options.abortSignal === "undefined" }) }), { operation: "recall", authorityEpochId: "epoch", providerId: "local", providerLineageId: "lineage", capabilities: caps, replayPosture: "safe" });
    const effects = createEffectLifecycleService(createEffectRepo(db, createRunEventRepo(db)));
    const approval = createApprovalInteractionService(createApprovalDecisionService(createApprovalStateRepo(db)));
    const connection = { state: { status: "authenticated" as const, deviceId: "operator", role: "operator" as const, capabilities: [] as string[] } };
    const wrapped = createCoreToolGovernanceAdapter(service(), OWNER_HOST_ID, approval).wrap({ recall: original }, { connection, runId: "r", attemptId: "a", effects });
    await wrapped.recall?.execute?.({ query: "private content" }, { toolCallId: "memory", messages: [] } as never);
    const row = db.prepare("SELECT kind,state,replay_posture,source_ref_json,executor_ref_json FROM run_effects").get() as Record<string, unknown>;
    expect(row.kind).toBe("memory");
    expect(row.state).toBe("terminal");
    expect(row.replay_posture).toBe("safe");
    expect(JSON.parse(String(row.source_ref_json))).toMatchObject({ type: "memory", requestId: expect.any(String), authorityEpoch: "epoch", providerId: "local", providerLineageId: "lineage", operation: "recall" });
    expect(JSON.stringify(row)).not.toContain("private content");
  });

  it("settles Memory provider outcome unknown without relabeling it as success", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    dbs.push(db);
    db.exec("INSERT INTO run_snapshots (snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at) VALUES ('s','r','harness.v1','{}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z'); INSERT INTO runs (run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,delivery_class,state,state_version,snapshot_id,active_attempt_id,queued_at,operation_phase,created_at,updated_at) VALUES ('r','c','t','i','h','primary','{}','class_a','running',0,'s','a','2026-08-25T00:00:00.000Z','executing','2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z'); INSERT INTO run_attempts (attempt_id,run_id,ordinal,state,state_version,provider,model_id,snapshot_id) VALUES ('a','r',1,'effect_running',0,'p','m','s');");
    const caps = { providerId: "local", contractVersion: 1 as const, retain: false, recall: true, reflect: false, edit: false, invalidate: false, restore: false, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };
    const original = attachMemoryEffectMetadata(tool({ description: "memory", inputSchema: z.object({}), execute: async () => ({ ok: false, code: "MEMORY_OUTCOME_UNKNOWN" }) }), { operation: "recall", authorityEpochId: "epoch", providerId: "local", providerLineageId: "lineage", capabilities: caps, replayPosture: "safe" });
    const effects = createEffectLifecycleService(createEffectRepo(db, createRunEventRepo(db)));
    const approval = createApprovalInteractionService(createApprovalDecisionService(createApprovalStateRepo(db)));
    const connection = { state: { status: "authenticated" as const, deviceId: "operator", role: "operator" as const, capabilities: [] as string[] } };
    const wrapped = createCoreToolGovernanceAdapter(service(), OWNER_HOST_ID, approval).wrap({ recall: original }, { connection, runId: "r", attemptId: "a", effects });
    await wrapped.recall?.execute?.({}, { toolCallId: "memory", messages: [] } as never);
    expect(db.prepare("SELECT state,outcome FROM run_effects").get()).toEqual({ state: "terminal", outcome: "outcome_unknown" });
  });

  it("keeps lifecycle-only non-primary Memory calls inside the Core Effect bracket", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    dbs.push(db);
    db.exec("INSERT INTO run_snapshots (snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at) VALUES ('s','r','harness.v1','{}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z'); INSERT INTO runs (run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,delivery_class,state,state_version,snapshot_id,active_attempt_id,queued_at,operation_phase,created_at,updated_at) VALUES ('r','c','t','i','h','background','{}','class_a','running',0,'s','a','2026-08-25T00:00:00.000Z','executing','2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z'); INSERT INTO run_attempts (attempt_id,run_id,ordinal,state,state_version,provider,model_id,snapshot_id) VALUES ('a','r',1,'effect_running',0,'p','m','s');");
    const caps = { providerId: "local", contractVersion: 1 as const, retain: true, recall: true, reflect: false, edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };
    const original = attachMemoryEffectMetadata(tool({ description: "memory", inputSchema: z.object({}), execute: async () => ({ ok: true }) }), { operation: "retain", authorityEpochId: "epoch", providerId: "local", providerLineageId: "lineage", capabilities: caps, replayPosture: "never" });
    const effects = createEffectLifecycleService(createEffectRepo(db, createRunEventRepo(db)));
    const wrapped = createCoreToolGovernanceAdapter(service(), OWNER_HOST_ID).wrap({ retain: original }, { runId: "r", attemptId: "a", effects });
    await wrapped.retain?.execute?.({}, { toolCallId: "memory", messages: [] } as never);
    expect(db.prepare("SELECT kind,state,outcome FROM run_effects").get()).toEqual({ kind: "memory", state: "terminal", outcome: "completed" });
  });
});

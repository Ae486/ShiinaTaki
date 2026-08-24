/**
 * INPUT:  real McpManager generation snapshots, Extension Registry composition, Core Effect repository, and Approval
 * OUTPUT: proves direct MCP and extension_call each create one durable Tool Effect and one underlying dispatch
 * POS:    core/extensions — integration regression for the shared captured MCP governed closure
 */
import type { ToolExecutionOptions } from "ai";
import { describe, expect, it } from "vitest";
import { InMemoryTransport, memConnect } from "../testing/mcp-test-transport.ts";
import { createMcpManager } from "../mcp/mcp-manager.ts";
import { createExtensionRunContext } from "./extension-run-context.ts";
import { createHostCatalogStore } from "../hosts/host-catalog.ts";
import { createEffectRepo } from "../db/effect-repo.ts";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { createEffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createApprovalDecisionService } from "../approval/approval-decision-service.ts";
import { createApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import { createApprovalStateRepo } from "../approval/approval-state-repo.ts";
import { createGovernancePolicyRepo } from "../governance/governance-policy-repo.ts";
import { createGovernancePolicyService } from "../governance/governance-policy-service.ts";
import { fakeOperator } from "../testing/capability-tool-harness.ts";
import type { McpManager } from "../mcp/mcp-manager.ts";
import type { SkillCatalogManager } from "../skills/skill-catalog-manager.ts";
import type { SkillsLoader } from "../skills/skills-loader.ts";

const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATTEMPT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER = "00000000-0000-4000-8000-000000000001";
const TOOL = { name: "echo", description: "Echo", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } };

describe("MCP and extension Tool Effect exactly-once boundary", () => {
  it("direct key and extension_call share one captured closure without double recording", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    seedRun(db);
    const effects = createEffectLifecycleService(createEffectRepo(db, createRunEventRepo(db)));
    const approval = createApprovalInteractionService(createApprovalDecisionService(createApprovalStateRepo(db)));
    const governance = createGovernancePolicyService(createGovernancePolicyRepo(db));
    const autoGovernance = { authorize: () => ({ allowed: true as const, evaluation: { policyGeneration: 1 } }) } as unknown as typeof governance;
    const operator = fakeOperator();
    let calls = 0;
    const transport = new InMemoryTransport([TOOL], (msg) => {
      calls += 1;
      return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `echo:${String(msg.params.arguments?.text)}` }] } };
    });
    const manager = makeManager(transport, autoGovernance, approval);
    await manager.applyDesired({ serverId: "srv", ownerHostId: OWNER, configRevision: 1, config: { command: "memory" }, selectedTools: [], enabled: true });
    const interactive = {
      connection: operator,
      runId: RUN,
      attemptId: ATTEMPT,
      effects,
      approval,
    };
    const context = createExtensionRunContext({
      runId: RUN,
      coreHostId: OWNER,
      catalogs: createHostCatalogStore(),
      skills: { catalog: emptySkillCatalog(), loader: emptySkillsLoader(), governance },
      mcp: manager,
      interactive,
      route: async () => ({ ok: false, code: "NO_NODE" }),
    });
    expect(Object.keys(context.tools)).toContain("srv_echo");
    const direct = context.tools.srv_echo;
    expect(direct).toBeDefined();
    const first = execute(direct, { text: "direct" });
    await expect(first).resolves.toMatchObject({ content: [{ text: "echo:direct" }] });
    expect(db.prepare("SELECT count(*) AS n FROM run_effects").get()?.n).toBe(1);
    expect(calls).toBe(1);

    const entry = context.snapshot.entries.find((item) => item.identity.kind === "mcp-tool");
    expect(entry).toBeDefined();
    const second = execute(context.tools.extension_call, { extensionId: entry!.identity.extensionId, input: { text: "extension" } });
    await expect(second).resolves.toMatchObject({ ok: true, output: { content: [{ text: "echo:extension" }] } });
    expect(db.prepare("SELECT count(*) AS n FROM run_effects").get()?.n).toBe(2);
    expect(calls).toBe(2);

    const stale = manager.snapshot(interactive)[0]!;
    manager.disableServer({ serverId: "srv", ownerHostId: OWNER, configRevision: 2, config: { command: "memory" }, selectedTools: [], enabled: false });
    const staleResult = execute(stale.tool, { text: "stale" });
    await expect(staleResult).resolves.toMatchObject({ ok: false, code: "MCP_STALE_GENERATION" });
    expect(db.prepare("SELECT count(*) AS n FROM run_effects").get()?.n).toBe(2);
    expect(calls).toBe(2);
    await manager.close();
    db.close();
  });
});

function execute(value: unknown, input: unknown): Promise<unknown> {
  const execute = (value as { execute?: (input: unknown, options: ToolExecutionOptions<unknown>) => unknown | PromiseLike<unknown> } | undefined)?.execute;
  if (!execute) throw new Error("tool execute missing");
  return Promise.resolve(execute(input, { toolCallId: "call", messages: [] } as never));
}

function makeManager(transport: InMemoryTransport, governance: ReturnType<typeof createGovernancePolicyService>, approval: ReturnType<typeof createApprovalInteractionService>): McpManager {
  const { logger } = createCaptureLogger();
  return createMcpManager({ logger, connect: memConnect(new Map([["srv", transport]])), governance: { service: governance, ownerHostId: OWNER, approval }, drainBudgetMs: 30, shutdownBudgetMs: 30 });
}

function seedRun(db: Database): void {
  db.exec("INSERT INTO run_snapshots (snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at) VALUES ('s','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','harness.v1','{}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z'); INSERT INTO runs (run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,delivery_class,state,state_version,snapshot_id,active_attempt_id,queued_at,operation_phase,created_at,updated_at) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c','t','i','h','primary','{}','class_a','running',0,'s','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2026-08-25T00:00:00.000Z','executing','2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z'); INSERT INTO run_attempts (attempt_id,run_id,ordinal,state,state_version,provider,model_id,snapshot_id) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'effect_running',0,'p','m','s');");
}

function emptySkillCatalog(): SkillCatalogManager { return { currentGeneration: () => 1, list: () => [], describe: () => undefined } as unknown as SkillCatalogManager; }
function emptySkillsLoader(): SkillsLoader { return { renderList: () => "", describe: () => undefined, load: () => ({ ok: false, code: "SKILL_NOT_FOUND" }) } as unknown as SkillsLoader; }

import { afterEach, describe, expect, it, vi } from "vitest";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { scriptedModel, streamingMockModel } from "../testing/mock-language-model.ts";
import { createChatAgent } from "./chat-agent.ts";
import { tool } from "ai";
import { z } from "zod";
import { attachMemoryEffectMetadata } from "../memory/canonical-tools/memory-effect-tool.ts";
import { createGovernancePolicyService } from "../governance/governance-policy-service.ts";
import { createGovernancePolicyRepo } from "../governance/governance-policy-repo.ts";
import { createCoreToolGovernanceAdapter } from "../governance/core-tool-governance-adapter.ts";
import { createEffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { createEffectRepo } from "../db/effect-repo.ts";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { wrapGovernedTool } from "../governance/governed-tool.ts";

const fixtures: CompanionFixture[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.cleanup(); });

describe("ChatAgent non-primary input seam", () => {
  it("attributes captured unattended tools to the executing Attempt without replacing the captured context", async () => {
    const fixture = createCompanionFixture(); fixtures.push(fixture); seedRun(fixture);
    const effects = createEffectLifecycleService(createEffectRepo(fixture.db, createRunEventRepo(fixture.db)));
    const service = createGovernancePolicyService(createGovernancePolicyRepo(fixture.db));
    const execute = vi.fn(async () => ({ ok: true }));
    const capturedTool = wrapGovernedTool(tool({ inputSchema: z.strictObject({}), execute }), {
      service, binding: { identity: { capabilityId: "workspace.file.read", ownerHostId: "11111111-1111-4111-8111-111111111111" }, cellKey: "workspace-read" },
    });
    const captured = Object.freeze({ tools: Object.freeze({ captured_read: capturedTool }) });
    const agent = createChatAgent({ model: scriptedModel([
      { kind: "tool", toolCallId: "captured", toolName: "captured_read", input: {} }, { kind: "text", deltas: ["done"] },
    ]), store: fixture.conversation, memory: fixture.memory, effectLifecycle: effects });
    for await (const delta of agent.stream({ characterId: "taki", message: "Read the captured material" }, {
      turnKind: "non-primary", runId: "run", attemptId: "attempt", runContext: captured,
    })) { void delta; }
    expect(execute).toHaveBeenCalledOnce();
    expect(fixture.db.prepare("SELECT run_id,attempt_id,state,outcome FROM run_effects WHERE kind='tool'").all())
      .toEqual([{ run_id: "run", attempt_id: "attempt", state: "terminal", outcome: "completed" }]);
    expect(captured.tools.captured_read).toBe(capturedTool);
    expect(fixture.conversation.history("taki")).toEqual([]);
  });

  it("keeps control input ephemeral and suppresses Timeline, costume, and conversational memory writes", async () => {
    const fixture = createCompanionFixture(); fixtures.push(fixture);
    fixture.conversation.appendUser("taki", "existing"); fixture.conversation.appendAssistant("taki", "history");
    const before = fixture.conversation.history("taki");
    const model = streamingMockModel(["autonomous result"]);
    const costumeChanged = vi.fn(() => true);
    const autoMemory = { onTurnCompleted: vi.fn(async () => undefined) };
    const agent = createChatAgent({ model, store: fixture.conversation, memory: fixture.memory, costumeChanged, autoMemory });
    for await (const delta of agent.stream({ characterId: "taki", message: "wire placeholder" }, {
      turnKind: "non-primary", runId: "run-1", controlInput: "bounded autonomous control",
    })) { void delta; }
    expect(fixture.conversation.history("taki")).toEqual(before);
    expect(costumeChanged).not.toHaveBeenCalled();
    expect(autoMemory.onTurnCompleted).not.toHaveBeenCalled();
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain("bounded autonomous control");
    expect(JSON.stringify(fixture.conversation.history("taki"))).not.toContain("bounded autonomous control");
  });

  it("keeps non-primary image bytes in-flight without saving attachment media", async () => {
    const fixture = createCompanionFixture(); fixtures.push(fixture);
    const save = vi.fn(() => ({ ref: `attachments/${"a".repeat(64)}.png`, bytes: 3 }));
    const primaryModel = streamingMockModel(["seen"]);
    const agent = createChatAgent({
      model: primaryModel,
      attachments: { save },
      store: fixture.conversation,
      memory: fixture.memory,
    });
    for await (const delta of agent.stream({ characterId: "taki", message: "inspect", attachments: [{ mediaType: "image/png", dataBase64: "AAAA" }] }, {
      turnKind: "non-primary", controlInput: "inspect image",
    })) { void delta; }
    expect(save).not.toHaveBeenCalled();
    expect(JSON.stringify(primaryModel.doStreamCalls[0]?.prompt)).toContain('"type":"file"');
    expect(fixture.conversation.history("taki")).toEqual([]);
  });

  it("records an explicit non-primary Memory call without creating relationship Timeline rows", async () => {
    const fixture = createCompanionFixture(); fixtures.push(fixture);
    seedRun(fixture);
    const caps = { providerId: "local", contractVersion: 1 as const, retain: true, recall: true, reflect: false, edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };
    const retain = attachMemoryEffectMetadata(tool({ description: "retain", inputSchema: z.strictObject({ content: z.string() }), execute: async () => ({ ok: true }) }), { operation: "retain", authorityEpochId: "epoch", providerId: "local", providerLineageId: "lineage", capabilities: caps, replayPosture: "never" });
    const effects = createEffectLifecycleService(createEffectRepo(fixture.db, createRunEventRepo(fixture.db)));
    const governance = createCoreToolGovernanceAdapter(createGovernancePolicyService(createGovernancePolicyRepo(fixture.db)), "core-host");
    const agent = createChatAgent({
      model: scriptedModel([{ kind: "tool", toolCallId: "memory", toolName: "retain", input: { content: "ephemeral control" } }, { kind: "text", deltas: ["done"] }]),
      store: fixture.conversation,
      memory: { ...fixture.memory, createTools: () => ({ retain }) },
      coreToolGovernance: governance,
      effectLifecycle: effects,
    });
    for await (const delta of agent.stream({ characterId: "taki", message: "wire placeholder" }, {
      turnKind: "non-primary", runId: "run", attemptId: "attempt", controlInput: "ephemeral control",
    })) { void delta; }
    expect(fixture.conversation.history("taki")).toEqual([]);
    expect(fixture.db.prepare("SELECT kind,state,outcome FROM run_effects WHERE kind='memory'").all()).toEqual([{ kind: "memory", state: "terminal", outcome: "completed" }]);
  });
});

function seedRun(fixture: CompanionFixture): void {
  const at = "2026-08-25T00:00:00.000Z";
  fixture.db.exec(`INSERT INTO run_snapshots (snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at) VALUES ('snapshot','run','harness.v1','{}','${"a".repeat(64)}','${at}','${at}');
    INSERT INTO runs (run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,delivery_class,state,state_version,snapshot_id,active_attempt_id,queued_at,operation_phase,created_at,updated_at) VALUES ('run','taki','trigger','idempotency','${"b".repeat(64)}','scheduled','{}','class_a','running',0,'snapshot','attempt','${at}','executing','${at}','${at}');
    INSERT INTO run_attempts (attempt_id,run_id,ordinal,state,state_version,provider,model_id,snapshot_id) VALUES ('attempt','run',1,'effect_running',0,'provider','model','snapshot');`);
}

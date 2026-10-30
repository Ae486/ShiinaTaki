/**
 * INPUT:  installed AI SDK ToolLoopAgent path, scripted concurrent tool calls, and the Core Effect repository
 * OUTPUT: proves parallel Tool Effects have distinct identities, independent settlement, and ordered tool results
 * POS:    core/agents — Slice 3B regression at the real ToolLoopAgent/tool-result boundary
 */
import { tool } from "ai";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { createChatAgent } from "./chat-agent.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { createEffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { createEffectRepo } from "../db/effect-repo.ts";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { wrapGovernedTool } from "../governance/governed-tool.ts";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import { fakeOperator } from "../testing/capability-tool-harness.ts";

const fixtures: CompanionFixture[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.cleanup(); });

describe("parallel Tool Effect lifecycle", () => {
  it("assigns distinct effects and preserves the model call order in persisted tool results", async () => {
    const fixture = createCompanionFixture();
    fixtures.push(fixture);
    seedRun(fixture);
    const lifecycle = createEffectLifecycleService(createEffectRepo(fixture.db, createRunEventRepo(fixture.db)));
    const order: string[] = [];
    const governed = (name: string, execute: (input: { value: string }) => Promise<{ value: string }>) => wrapGovernedTool(
      tool({ description: name, inputSchema: z.object({ value: z.string() }), execute }),
      {
        service: { authorize: () => ({ allowed: true, evaluation: {} }) } as unknown as GovernancePolicyService,
        binding: { identity: { capabilityId: `test.${name}`, ownerHostId: "core" }, cellKey: name },
        interactive: { approval: {} as never, connection: fakeOperator(), runId: "run-parallel", attemptId: "attempt-parallel", effects: lifecycle, presentation: { revision: 1, title: name, capabilityLabel: name, riskSummary: name, sections: [] } },
      },
    );
    const agent = createChatAgent({
      model: scriptedModel([
        { kind: "tools", calls: [
          { toolCallId: "call-a", toolName: "parallel_a", input: { value: "a" } },
          { toolCallId: "call-b", toolName: "parallel_b", input: { value: "b" } },
        ] },
        { kind: "text", deltas: ["done"] },
      ]),
      store: fixture.conversation,
      memory: fixture.memory,
      extraTools: {
        parallel_a: governed("parallel-a", async ({ value }) => { await new Promise((resolve) => setTimeout(resolve, 15)); order.push(`a:${value}`); return { value: `result-${value}` }; }),
        parallel_b: governed("parallel-b", async ({ value }) => { await new Promise((resolve) => setTimeout(resolve, 1)); order.push(`b:${value}`); return { value: `result-${value}` }; }),
      },
      effectLifecycle: lifecycle,
    });
    let output = "";
    for await (const delta of agent.stream({ characterId: "taki", message: "run both" }, { runId: "run-parallel", attemptId: "attempt-parallel" })) output += delta;
    expect(output).toBe("done");
    expect(order).toEqual(["b:b", "a:a"]);
    const effects = fixture.db.prepare("SELECT effect_id, state, outcome FROM run_effects WHERE kind='tool' ORDER BY rowid").all();
    expect(effects).toHaveLength(2);
    expect(new Set(effects.map((row) => row.effect_id)).size).toBe(2);
    expect(effects.every((row) => row.state === "terminal" && row.outcome === "completed")).toBe(true);
    const history = fixture.conversation.history("taki");
    const toolResults = history.filter((row) => row.role === "tool").flatMap((row) => Array.isArray(row.content) ? row.content : []).filter((part) => part.type === "tool-result");
    expect(toolResults.map((part) => part.toolCallId)).toEqual(["call-a", "call-b"]);
  });
});

function seedRun(fixture: CompanionFixture): void {
  fixture.db.exec("INSERT INTO run_snapshots (snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at) VALUES ('s','run-parallel','harness.v1','{}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z'); INSERT INTO runs (run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,delivery_class,state,state_version,snapshot_id,active_attempt_id,queued_at,operation_phase,created_at,updated_at) VALUES ('run-parallel','c','t','i','h','primary','{}','class_a','running',0,'s','attempt-parallel','2026-08-25T00:00:00.000Z','executing','2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z'); INSERT INTO run_attempts (attempt_id,run_id,ordinal,state,state_version,provider,model_id,snapshot_id) VALUES ('attempt-parallel','run-parallel',1,'effect_running',0,'p','m','s');");
}

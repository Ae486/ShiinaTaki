import { afterEach, describe, expect, it } from "vitest";
import { asSchema, type ToolSet } from "ai";
import type { TurnContext } from "../agents/chat-agent.ts";
import type { Database } from "../db/sqlite.ts";
import { runMigrations } from "../db/migration-runner.ts";
import { initiativeIntentionsMigration054 } from "../db/migrations/054-initiative-intentions.ts";
import { initiativeFixture } from "../testing/initiative-fixture.ts";
import { createIntentionService } from "./intentions/intention-service.ts";
import { createPlanFollowUpTool } from "./plan-follow-up-tool.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
async function fixture() {
  const f = initiativeFixture(); databases.push(f.db); runMigrations(f.db, [initiativeIntentionsMigration054]);
  const admitted = await f.runs.admit({ characterId: "taki", triggerRequestId: "primary", idempotencyKey: "primary",
    initiator: "primary", provenance: { provider: "chat" }, contextMode: "primary", deliveryClass: "class_a" });
  f.runs.start(admitted.run.runId, admitted.attempt.attemptId);
  const userEntry = f.timeline.append({ characterId: "taki", role: "user", content: "I have an interview tomorrow." });
  const turn: TurnContext = { runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, turnKind: "primary" };
  const service = createIntentionService({ db: f.db });
  const dependencies = { service, characterId: "taki", turn, userEntry };
  const plan = { purpose: "Consider asking how the interview went.", notBefore: new Date(Date.now() + 60000).toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(), reportedEventTime: null };
  return { ...f, turn, userEntry, service, dependencies, plan, tools: createPlanFollowUpTool(dependencies) };
}
async function execute(tools: ToolSet, params: unknown, call = "call") {
  return tools.plan_follow_up?.execute?.(params, { toolCallId: call, messages: [], context: undefined });
}

describe("primary automatic follow-up tool", () => {
  it("advertises strict object parameters without model-controlled source or execution identities", async () => {
    const f = await fixture(); const schema = asSchema(f.tools.plan_follow_up!.inputSchema);
    expect(await schema.jsonSchema).toMatchObject({ type: "object", additionalProperties: false,
      required: ["purpose", "notBefore", "expiresAt", "reportedEventTime"] });
    expect(await schema.validate?.({ ...f.plan, characterId: "other" })).toMatchObject({ success: false });
    expect(await schema.validate?.({ ...f.plan, reportedEventTime: undefined })).toMatchObject({ success: false });
    expect(createPlanFollowUpTool({ ...f.dependencies, turn: { ...f.turn, turnKind: "non-primary" } })).toEqual({});
    expect(createPlanFollowUpTool({ ...f.dependencies, turn: undefined })).toEqual({});
  });

  it("records the actual primary row and tool call, returns readable semantics and deduplicates rewording", async () => {
    const f = await fixture();
    expect(await execute(f.tools, f.plan)).toMatchObject({ ok: true, status: "created", state: "active", purpose: f.plan.purpose });
    expect(await execute(f.tools, { ...f.plan, purpose: "Another wording." }, "different-call"))
      .toMatchObject({ ok: true, status: "duplicate", purpose: f.plan.purpose });
    const row = f.db.prepare("SELECT source_json FROM initiative_intentions").get();
    expect(JSON.parse(String(row?.source_json))).toMatchObject({ timelineId: f.userEntry.id,
      timelineSeq: f.userEntry.seq, runId: f.turn.runId, attemptId: f.turn.attemptId, toolCallId: "call" });
    const response = await execute(f.tools, f.plan);
    expect(JSON.stringify(response)).not.toContain(f.userEntry.id);
    expect(JSON.stringify(response)).not.toContain(f.turn.runId);
  });

  it("refuses aborted, withdrawn and invalid timing inputs without emitting an unhandled error", async () => {
    const f = await fixture();
    expect(await execute(f.tools, { ...f.plan, reportedEventTime: "tomorrow" })).toMatchObject({ ok: false, reason: "invalid_request" });
    f.timeline.deleteEntry("taki", f.userEntry.seq);
    expect(await execute(f.tools, f.plan)).toMatchObject({ ok: false, reason: "source_stale" });
    f.turn.signal = AbortSignal.abort();
    expect(await execute(f.tools, f.plan)).toMatchObject({ ok: false, reason: "source_stale" });
    expect(f.db.prepare("SELECT * FROM initiative_intentions").all()).toEqual([]);
  });

  it("preserves unavailable source truth and contains persistence failures without exposing exception text", async () => {
    const f = await fixture();
    const unavailable = createPlanFollowUpTool({ ...f.dependencies,
      service: createIntentionService({ db: f.db, sourceState: () => "unavailable" }) });
    expect(await execute(unavailable, f.plan)).toMatchObject({ ok: false, reason: "source_unavailable" });
    f.db.exec("CREATE TRIGGER reject_intention BEFORE INSERT ON initiative_intentions BEGIN SELECT RAISE(ABORT,'private-database-detail'); END");
    const result = await execute(f.tools, f.plan);
    expect(result).toMatchObject({ ok: false, code: "INTERNAL_ERROR" });
    expect(JSON.stringify(result)).not.toContain("private-database-detail");
    expect(f.db.prepare("SELECT * FROM initiative_intentions").all()).toEqual([]);
  });
});

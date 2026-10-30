import { afterEach, describe, expect, it, vi } from "vitest";
import { asSchema, type ToolSet } from "ai";
import { InteractionPatternHistoryResultSchema, InteractionPatternListResultSchema,
  type InteractionPatternDefinition, type InteractionPatternView } from "@taki/shared";
import type { TurnContext } from "../agents/chat-agent.ts";
import type { Database } from "../db/sqlite.ts";
import { initiativeFixture } from "../testing/initiative-fixture.ts";
import { createInteractionPatternService } from "./patterns/pattern-service.ts";
import { createManagePatternTool } from "./manage-pattern-tool.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
const definition: InteractionPatternDefinition = {
  title: "Reflection", purpose: "Consider reflecting together.", conditions: { all: [{ kind: "presence_present" }] },
  contextSelectors: ["memory_character"], allowedOutcomes: ["silent", "speak"],
  timing: { minimumGapMinutes: 60, chance: 0.5 }, lifetime: { startsAt: null, expiresAt: null },
};
const empty = { patternId: null, expectedVersion: null, definition: null, revisionId: null, listAfter: null, historyBefore: null };
const proposal = { ...empty, action: "propose", expectedVersion: 0, definition };
async function fixture() {
  const f = initiativeFixture(); dbs.push(f.db);
  const admission = await f.runs.admit({ triggerRequestId: "trigger", idempotencyKey: "primary", characterId: "taki",
    initiator: "primary", provenance: { provider: "chat" }, deliveryClass: "class_a", contextMode: "primary" });
  f.runs.start(admission.run.runId, admission.attempt.attemptId);
  const userEntry = f.timeline.append({ characterId: "taki", role: "user", content: "Please create a reflection habit." });
  const controller = new AbortController();
  const turn: TurnContext = { turnKind: "primary", runId: admission.run.runId, attemptId: admission.attempt.attemptId, signal: controller.signal };
  const service = createInteractionPatternService({ db: f.db });
  const deps = { service, characterId: "taki", userEntry, turn };
  return { ...f, service, turn, userEntry, controller, deps, tools: createManagePatternTool(deps) };
}
async function execute(tools: ToolSet, input: unknown, toolCallId = "call"): Promise<unknown> {
  return tools.manage_interaction_pattern?.execute?.(input, { toolCallId, messages: [], context: undefined });
}
function candidate(value: unknown): InteractionPatternView {
  expect(value).toMatchObject({ ok: true, status: "applied", pattern: { state: "proposed" } });
  return (value as { pattern: InteractionPatternView }).pattern;
}

describe("source-bound interaction Pattern tool", () => {
  it("advertises a strict all-required schema with no Agent confirmation or reviewer fields", async () => {
    const f = await fixture();
    const schema = asSchema(f.tools.manage_interaction_pattern!.inputSchema);
    const json = await schema.jsonSchema;
    expect(json).toMatchObject({ type: "object", additionalProperties: false,
      required: ["action", "patternId", "expectedVersion", "definition", "revisionId", "listAfter", "historyBefore"] });
    expect(await schema.validate?.(proposal)).toMatchObject({ success: true });
    for (const invalid of [
      { ...empty, action: "confirm" }, { ...proposal, reviewer: "user" },
      { ...empty, action: "list", definition }, { ...empty, action: "read" },
      { ...empty, action: "pause", patternId: "missing" }, { ...proposal, revisionId: "unseen" },
      { ...empty, action: "list", historyBefore: 1 }, { ...empty, action: "history", patternId: "known", listAfter: "cursor" },
      { ...proposal, listAfter: "cursor" }, { ...proposal, historyBefore: 1 },
      { ...empty, action: "list", listAfter: undefined }, { ...empty, action: "list", historyBefore: undefined },
    ]) expect(await schema.validate?.(invalid)).toMatchObject({ success: false });
  });

  it("uses real primary source authority and leaves candidates inactive until operator review", async () => {
    const f = await fixture();
    const permissions = f.db.prepare("SELECT * FROM governance_policy").all();
    const proposed = candidate(await execute(f.tools, proposal));
    expect(proposed.candidateRevision?.origin.kind).toBe("agent");
    expect(f.service.listActive("taki")).toEqual([]);
    expect(await execute(f.tools, proposal)).toMatchObject({ ok: true, status: "duplicate", pattern: { patternId: proposed.patternId } });
    expect(await execute(f.tools, { ...empty, action: "list" }, "list")).toMatchObject({ ok: true, patterns: [{ patternId: proposed.patternId }] });
    expect(await execute(f.tools, { ...empty, action: "read", patternId: proposed.patternId }, "read"))
      .toMatchObject({ ok: true, pattern: { patternId: proposed.patternId } });
    expect(f.db.prepare("SELECT * FROM governance_policy").all()).toEqual(permissions);
    expect(f.db.prepare("SELECT * FROM approval_decisions").all()).toEqual([]);
    expect(f.db.prepare("SELECT count(*) AS count FROM interaction_pattern_primary_sources").get()?.count).toBe(1);
  });

  it("routes pause/resume/retire/history/rollback through the same CAS service", async () => {
    const f = await fixture();
    const draft = candidate(await execute(f.tools, proposal));
    const confirmed = f.service.confirm({ characterId: "taki", patternId: draft.patternId, commandId: "operator-review",
      expectedVersion: draft.version, candidateRevisionId: draft.candidateRevision!.revisionId }, { kind: "operator", operatorId: "owner" });
    if (confirmed.status === "refused") throw new Error(confirmed.reason);
    const active = confirmed.pattern;
    const binding = { ...empty, patternId: active.patternId, expectedVersion: active.version };
    expect(await execute(f.tools, { ...binding, action: "pause" }, "pause")).toMatchObject({ ok: true, pattern: { state: "paused" } });
    expect(await execute(f.tools, { ...binding, action: "resume" }, "stale-resume")).toMatchObject({ ok: false, reason: "conflict" });
    expect(await execute(f.tools, { ...binding, expectedVersion: active.version + 1, action: "resume" }, "resume"))
      .toMatchObject({ ok: true, pattern: { state: "active" } });
    expect(await execute(f.tools, { ...empty, action: "history", patternId: active.patternId }, "history"))
      .toMatchObject({ ok: true, revisions: [{ revisionId: active.effectiveRevision!.revisionId }] });
    expect(await execute(f.tools, { ...binding, expectedVersion: active.version + 2, action: "rollback", revisionId: active.effectiveRevision!.revisionId }, "rollback"))
      .toMatchObject({ ok: true, pattern: { state: "active", candidateRevision: { origin: { kind: "rollback" } } } });
    expect(await execute(f.tools, { ...binding, expectedVersion: active.version + 3, action: "retire" }, "retire"))
      .toMatchObject({ ok: true, pattern: { state: "retired" } });
  });

  it("pages beyond 25 scoped Patterns without duplicates or lost bindings", async () => {
    const f = await fixture();
    const actor = { kind: "operator", operatorId: "owner" } as const;
    const ids: string[] = [];
    for (let index = 0; index < 26; index++) {
      const result = f.service.propose({ characterId: "taki", commandId: `seed-${index}`, patternId: null,
        expectedVersion: 0, definition: { ...definition, title: `Habit ${index}` } }, actor);
      if (result.status === "refused") throw new Error(result.reason);
      ids.push(result.pattern.patternId);
    }
    const first = InteractionPatternListResultSchema.strip().parse(await execute(f.tools, { ...empty, action: "list" }));
    expect(first.patterns).toHaveLength(25);
    expect(first.nextAfter).not.toBeNull();
    const second = InteractionPatternListResultSchema.strip().parse(await execute(f.tools,
      { ...empty, action: "list", listAfter: first.nextAfter }));
    expect(second.patterns).toHaveLength(1);
    expect(second.nextAfter).toBeNull();
    expect([...first.patterns, ...second.patterns].map((row) => row.patternId)).toEqual(ids.sort());
    expect(await execute(f.tools, { ...empty, action: "read", patternId: second.patterns[0]!.patternId }))
      .toMatchObject({ ok: true, pattern: { patternId: second.patterns[0]!.patternId } });
  });

  it("finds an older accepted revision through history continuation and rolls it back for review", async () => {
    const f = await fixture();
    const actor = { kind: "operator", operatorId: "owner" } as const;
    let current: InteractionPatternView | null = null;
    let firstRevision = "";
    for (let index = 0; index < 26; index++) {
      const proposed = f.service.propose({ characterId: "taki", commandId: `revision-${index}`,
        patternId: current?.patternId ?? null, expectedVersion: current?.version ?? 0,
        definition: { ...definition, title: `Habit revision ${index}` } }, actor);
      if (proposed.status === "refused") throw new Error(proposed.reason);
      const reviewed = proposed.pattern;
      const accepted = f.service.confirm({ characterId: "taki", commandId: `review-${index}`,
        patternId: reviewed.patternId, expectedVersion: reviewed.version,
        candidateRevisionId: reviewed.candidateRevision!.revisionId }, actor);
      if (accepted.status === "refused") throw new Error(accepted.reason);
      current = accepted.pattern;
      if (index === 0) firstRevision = current.effectiveRevision!.revisionId;
    }
    const first = InteractionPatternHistoryResultSchema.strip().parse(await execute(f.tools,
      { ...empty, action: "history", patternId: current!.patternId }));
    expect(first.revisions).toHaveLength(25);
    expect(first.nextBefore).not.toBeNull();
    const older = InteractionPatternHistoryResultSchema.strip().parse(await execute(f.tools,
      { ...empty, action: "history", patternId: current!.patternId, historyBefore: first.nextBefore }));
    expect(older.revisions.map((row) => row.revisionId)).toEqual([firstRevision]);
    expect(older.nextBefore).toBeNull();
    expect(await execute(f.tools, { ...empty, action: "rollback", patternId: current!.patternId,
      expectedVersion: current!.version, revisionId: older.revisions[0]!.revisionId }, "rollback-oldest"))
      .toMatchObject({ ok: true, pattern: { state: "active", candidateRevision: {
        definition: { title: "Habit revision 0" }, acceptedAt: null,
      }, effectiveRevision: { revisionId: current!.effectiveRevision!.revisionId } } });
  });

  it("is absent without a primary Run/Attempt and refuses retired/cancelled or foreign sources", async () => {
    const f = await fixture();
    expect(createManagePatternTool({ ...f.deps, turn: undefined })).toEqual({});
    expect(createManagePatternTool({ ...f.deps, turn: { ...f.turn, turnKind: "non-primary" } })).toEqual({});
    const foreign = f.timeline.append({ characterId: "other", role: "user", content: "Other relationship." });
    expect(await execute(createManagePatternTool({ ...f.deps, userEntry: foreign }), proposal)).toMatchObject({ ok: false, reason: "source_stale" });
    f.timeline.deleteEntry("taki", f.userEntry.seq);
    expect(await execute(f.tools, proposal)).toMatchObject({ ok: false, reason: "source_stale" });
    f.controller.abort();
    expect(await execute(f.tools, { ...empty, action: "list" })).toMatchObject({ ok: false, reason: "source_stale" });
    expect(f.db.prepare("SELECT * FROM interaction_patterns").all()).toEqual([]);
  });

  it("rejects unsupported direct arguments and does not leak unexpected error text", async () => {
    const f = await fixture();
    expect(await execute(f.tools, { ...empty, action: "list", definition })).toMatchObject({ ok: false, reason: "invalid_request" });
    vi.spyOn(f.service, "propose").mockImplementation(() => { throw new Error("private diagnostic credential"); });
    const result = await execute(f.tools, proposal);
    expect(result).toMatchObject({ ok: false, reason: "operation_failed" });
    expect(JSON.stringify(result)).not.toContain("private diagnostic credential");
  });
});

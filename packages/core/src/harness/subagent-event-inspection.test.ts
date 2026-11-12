import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { SubagentInspectToolSchema } from "@taki/shared";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createSubagentInspectTool } from "../agents/subagent-inspect-tool.ts";
import { createSubagentTools } from "../agents/subagent-tools.ts";
import type { readSubagentEventInspection } from "../agents/subagent-event-inspection.ts";

type EventPage = ReturnType<typeof readSubagentEventInspection>;
const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
const options = { toolCallId: "inspect", messages: [], context: undefined };
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

async function waiting(question: string) {
  const model = scriptedModel([
    { kind: "tool", toolCallId: "ask", toolName: "interact_parent", input: { kind: "needs_input", text: question } },
    { kind: "tool", toolCallId: "finish", toolName: "complete_subagent", input: { text: "Completed after the exact answer", materials: [] } },
  ]);
  const f = await subagentFixture(model); fixtures.push(f);
  const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, {
    characterId: "taki", operationKey: "silent-question", label: "Silent worker", initialContext: { kind: "fresh" },
    direction: "Complete the work after any necessary external choice.", materials: [], completionPolicy: "record_only" });
  const subagentId = accepted.conversation.subagentId;
  await vi.waitFor(() => expect(f.service.summary(subagentId).state).toBe("needs_input"));
  const event = f.service.events.get(f.service.summary(subagentId).pendingRequest!.eventId);
  const inspect = createSubagentInspectTool({ service: f.service, characterId: "taki" }).inspect_subagent!.execute!;
  const params = SubagentInspectToolSchema.parse({ category: "events", subagentId, completionId: null, cursor: null, afterSeq: 0, limit: 20 });
  return { ...f, model, subagentId, event, inspect, params };
}

it("reads a suppressed question through bounded event pages, then answers its exact work without inbox delivery", async () => {
  const question = "Choose the compatible baseline 你好😀? ".repeat(400);
  const f = await waiting(question);
  const canonical = f.service.events.get(f.event.eventId);
  expect(canonical).toMatchObject({ body: question, eligible: false, suppressionReason: "record_only", state: "accepted" });
  let cursor: string | null = null; let text = ""; let pages = 0;
  let target: EventPage["records"][number]["target"] | undefined;
  do {
    const page = await f.inspect({ ...f.params, cursor }, options) as EventPage;
    expect(page.status).toBe("available");
    expect(page.records.reduce((size, record) => size + record.body.length, 0)).toBeLessThanOrEqual(3000);
    for (const record of page.records) {
      expect(record.id).toBe(f.event.eventId);
      expect(record).toMatchObject({ state: "accepted", eligible: false, suppressionReason: "record_only" });
      expect(record.offset).toBe(text.length);
      expect(record.body).not.toMatch(/[\uD800-\uDBFF]$/u);
      text += record.body; target = record.target;
    }
    cursor = page.nextCursor; pages += 1;
    expect(pages).toBeLessThan(30);
  } while (cursor);
  expect(pages).toBeGreaterThan(1);
  expect(JSON.parse(text)).toMatchObject({ body: question, eventId: f.event.eventId,
    sourceContext: { generatedBy: { subagentId: f.subagentId } } });
  expect(text).not.toMatch(/bodyDigest|producerKey|receiptId/);
  expect(f.service.events.get(f.event.eventId)).toEqual(canonical);
  expect(f.model.doStreamCalls).toHaveLength(1);
  expect(f.db.prepare("SELECT count(*) AS n FROM subagent_inbox_consumers").get()?.n).toBe(0);
  const context = f.service.prepareInbox({ characterId: "taki", runId: f.parent.run.runId,
    attemptId: f.parent.attempt.attemptId, actualInvocation: () => undefined })!;
  expect(await context.tools.read_agent_inbox!.execute!({ eventId: f.event.eventId, offset: 0, limit: 1000 }, options))
    .toMatchObject({ ok: false, code: "SUBAGENT_INBOX_NOT_CLAIMED" });
  context.dispose();

  expect(target).toBeDefined();
  const message = createSubagentTools({ service: f.service, characterId: "taki",
    turn: { runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId } }).send_subagent_message!.execute!;
  const answer = await message({ target: target!, replyToEventId: f.event.eventId, direction: "Use the stable baseline.",
    continue: false, materials: [] }, { ...options, toolCallId: "exact-answer" });
  expect(answer).toHaveProperty("input.inputId");
  await vi.waitFor(() => expect(f.model.doStreamCalls).toHaveLength(2));
  await vi.waitFor(() => expect(f.service.summary(f.subagentId).state).toBe("idle"));
  expect(f.service.events.wait(f.event.workInputId)?.state).toBe("answered");
  expect(f.service.events.get(f.event.eventId).state).toBe("accepted");
  expect(f.db.prepare("SELECT count(*) AS n FROM subagent_inbox_consumers").get()?.n).toBe(0);
  expect(f.conversation.history("taki")).toEqual([]);
});

it("keeps event body continuations stable across an answer and fences wrong scope, category and unavailable reads", async () => {
  const question = "Long immutable question 😀 ".repeat(400);
  const f = await waiting(question);
  const first = await f.inspect(f.params, options) as EventPage;
  expect(first.nextCursor).not.toBeNull();
  const firstRecord = first.records[0]!;
  const wrongCharacter = createSubagentInspectTool({ service: f.service, characterId: "other" }).inspect_subagent!.execute!;
  const refused = await wrongCharacter(f.params, options);
  expect(refused).toMatchObject({ ok: false, code: "SUBAGENT_CHARACTER_MISMATCH", currentTarget: null });
  expect(JSON.stringify(refused)).not.toContain("Long immutable question");
  const cursor = JSON.parse(first.nextCursor!) as Record<string, unknown>;
  for (const change of [{ child: randomUUID() }, { category: "messages" }, { recordId: randomUUID() }]) {
    expect(await f.inspect({ ...f.params, cursor: JSON.stringify({ ...cursor, ...change }) }, options))
      .toMatchObject({ status: "invalid_cursor", records: [] });
  }
  const failed = vi.spyOn(f.db, "prepare").mockImplementationOnce(() => { throw new Error("synthetic unavailable storage"); });
  try { expect(await f.inspect(f.params, options)).toMatchObject({ ok: false, code: "SUBAGENT_UNAVAILABLE" }); }
  finally { failed.mockRestore(); }

  f.service.send({ characterId: "taki", target: firstRecord.target, operationKey: "state-change",
    replyToEventId: f.event.eventId, direction: "Use the stable baseline.", materials: [] }, { kind: "parent", runId: f.parent.run.runId });
  await vi.waitFor(() => expect(f.service.summary(f.subagentId).state).toBe("idle"));
  let continuation = first.nextCursor; let text = firstRecord.body;
  while (continuation) {
    const page = await f.inspect({ ...f.params, cursor: continuation }, options) as EventPage;
    expect(page.records.every((record) => record.id === f.event.eventId)).toBe(true);
    text += page.records.map((record) => record.body).join(""); continuation = page.nextCursor;
  }
  expect(JSON.parse(text).body).toBe(question);
  const fresh = await f.inspect({ ...f.params, limit: 1 }, options) as EventPage;
  expect(fresh.records[0]?.target.expectedControlVersion).toBeGreaterThan(firstRecord.target.expectedControlVersion);
  expect(f.model.doStreamCalls).toHaveLength(2);
});

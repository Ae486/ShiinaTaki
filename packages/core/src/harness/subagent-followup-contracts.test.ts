import { afterEach, expect, it, vi } from "vitest";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel, streamingMockModel } from "../testing/mock-language-model.ts";
import { createSubagentInspectTool } from "../agents/subagent-inspect-tool.ts";
import { createSubagentTools, subagentToolRefusal } from "../agents/subagent-tools.ts";
import { SubagentMessageToolSchema } from "@taki/shared";
import { randomUUID } from "node:crypto";

const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
async function ready(body = "Result") {
  const model = scriptedModel([{ kind: "tool", toolCallId: "complete", toolName: "complete_subagent", input: { text: body, materials: [] } }]);
  const f = await subagentFixture(model); fixtures.push(f); f.queue.tryAcquireBackground("taki");
  const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, { characterId: "taki", operationKey: "work",
    label: "Worker", initialContext: { kind: "fresh" }, direction: "Work", materials: [], completionPolicy: "request_parent" });
  const subagentId = accepted.conversation.subagentId; const workInputId = accepted.input!.inputId;
  await vi.waitFor(() => expect(f.service.summary(subagentId).activeRunId).toBeNull());
  await vi.waitFor(() => expect(f.service.summary(subagentId).latestCompletionId).not.toBeNull());
  f.service.stop({ characterId: "taki", target: { subagentId, workInputId, expectedRunId: null,
    expectedControlVersion: f.service.summary(subagentId).controlVersion } }, "user");
  return { ...f, subagentId, workInputId, accepted };
}

it("ordinary messages resolve work in the transaction and explicit work never silently retargets", async () => {
  const f = await ready();
  const next = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, { characterId: "taki", operationKey: "second",
    subagentId: f.subagentId, label: "Worker", initialContext: { kind: "fresh" }, direction: "Other work", materials: [], completionPolicy: "record_only" });
  const sender = { kind: "parent" as const, runId: f.parent.run.runId };
  const ordinary = { characterId: "taki", subagentId: f.subagentId, operationKey: "ordinary", direction: "Correction", materials: [] };
  expect(f.service.sendCurrent(ordinary, sender).input?.workInputId).toBe(next.input!.inputId);
  const explicit = f.service.sendCurrent({ ...ordinary, operationKey: "historical", workInputId: f.workInputId }, sender);
  expect(explicit.input?.workInputId).toBe(f.workInputId);
  expect(f.service.sendCurrent(ordinary, sender).input?.workInputId).toBe(next.input!.inputId);
  expect(() => f.service.sendCurrent({ ...ordinary, operationKey: "wrong", workInputId: randomUUID() }, sender)).toThrow();
  expect(SubagentMessageToolSchema.parse({ target: { subagentId: f.subagentId }, direction: "More", continue: false })).toMatchObject({ target: { subagentId: f.subagentId } });
  const refusal = subagentToolRefusal(new Error("SUBAGENT_CONTROL_CONFLICT"), { service: f.service, subagentId: f.subagentId, characterId: "other" });
  expect(refusal.current).toBeUndefined(); expect(refusal.currentTarget).toBeNull();
});

it("model result inspection pages full useful text without receipts while canonical evidence is unchanged", async () => {
  const original = "Useful result 你好😀 ".repeat(600); const f = await ready(original);
  const completionId = f.service.summary(f.subagentId).latestCompletionId!;
  const canonical = f.service.result({ characterId: "taki", completionId });
  const inspect = createSubagentInspectTool({ service: f.service, characterId: "taki" }).inspect_subagent!.execute!;
  let cursor: string | null = null; let body = ""; let pages = 0;
  do {
    const result = await inspect({ completionId, subagentId: null, afterSeq: 0, limit: 20, cursor }, { toolCallId: "inspect", messages: [], context: undefined }) as {
      body: string; nextCursor: string | null;
    };
    expect(result.body.length).toBeLessThanOrEqual(3000); body += result.body; cursor = result.nextCursor; pages += 1;
  } while (cursor);
  expect(pages).toBeGreaterThan(1); expect(JSON.parse(body).result.child.body).toBe(original);
  expect(body).not.toContain("receiptId"); expect(body).not.toContain("childDigest"); expect(body).not.toContain("parentDigest");
  expect(f.service.result({ characterId: "taki", completionId })).toEqual(canonical);
});

it("needs_user_input remains durable after handling and only addressed user guidance resolves attention", async () => {
  const f = await ready();
  const context = f.service.prepareInbox({ characterId: "taki", runId: f.parent.run.runId,
    attemptId: f.parent.attempt.attemptId, actualInvocation: () => undefined })!;
  const effect = f.effects.prepare({ runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId, kind: "model",
    sourceRef: { type: "model", provider: "test", modelId: "test" }, inputDigest: "a".repeat(64), replayPosture: "never",
    onCommitIntent: (intent) => context.commitModelIntent(intent, 0) });
  const event = f.service.events.list({ characterId: "taki" })[0]!;
  f.service.inbox.action({ consumerId: context.consumerId, eventId: event.eventId, operationKey: "user-needed",
    action: { kind: "needs_user_input", note: "Choose the next direction" }, invocation: { invocationId: randomUUID(),
      runId: effect.runId, attemptId: effect.attemptId, toolCallId: "handle", toolName: "handle_agent_event", modelEffectId: effect.effectId, validationState: "accepted" },
    apply: () => ({ ok: true }) });
  expect(f.service.events.get(event.eventId).state).toBe("handled");
  expect(f.service.attention({ characterId: "taki", limit: 20 }).entries).toHaveLength(1);
  f.service.sendCurrent({ characterId: "taki", subagentId: f.subagentId, workInputId: f.workInputId, operationKey: "parent", direction: "Go", materials: [] }, { kind: "parent", runId: f.parent.run.runId });
  expect(f.service.attention({ characterId: "taki", limit: 20 }).entries).toHaveLength(1);
  f.service.sendCurrent({ characterId: "taki", subagentId: f.subagentId, workInputId: f.workInputId, operationKey: "user", direction: "Use A", materials: [] }, { kind: "user" });
  expect(f.service.attention({ characterId: "taki", limit: 20 }).entries).toEqual([]);
  expect(f.children.get(f.subagentId).stopOrigin).toBe("user");
});

it("idle handler excludes child creation from executable and actual disclosed tools", async () => {
  const model = streamingMockModel(["Private handler text"]); const f = await subagentFixture(model); fixtures.push(f);
  f.service.state.deps.mainTools = (characterId, turn) => createSubagentTools({ service: f.service, characterId, turn });
  const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, { characterId: "taki", operationKey: "idle",
    label: "Worker", initialContext: { kind: "fresh" }, direction: "Work", materials: [], completionPolicy: "request_parent" });
  await vi.waitFor(() => expect(model.doStreamCalls.length).toBe(2));
  const handler = model.doStreamCalls[1]!;
  expect(handler.tools?.map((entry) => entry.name)).not.toContain("delegate_subagent");
  expect(handler.tools?.map((entry) => entry.name)).toEqual(expect.arrayContaining(["send_subagent_message", "stop_subagent", "inspect_subagent", "handle_agent_event"]));
  expect(JSON.stringify(handler.prompt)).toContain("cannot create children");
  await vi.waitFor(() => expect(f.service.attention({ characterId: "taki", limit: 20 }).entries.some((entry) => entry.kind === "reconciliation_needed")).toBe(true));
  expect(f.children.list({ characterId: "taki" })).toHaveLength(1); expect(accepted.conversation.subagentId).toBeTruthy();
});

it("usage keeps single-sided historical totals, missing usage and in-flight calls explicitly incomplete", async () => {
  const f = await ready();
  expect(f.service.summary(f.subagentId).tokenUsage).toMatchObject({ modelEffects: 1, totalTokens: 8, complete: true });
  f.db.exec("UPDATE run_usage SET output_tokens=NULL,total_tokens=input_tokens");
  expect(f.service.summary(f.subagentId).tokenUsage).toMatchObject({ inputTokens: 3, outputTokens: null,
    totalTokens: null, knownTotalTokens: null, missingUsageEffects: 1, complete: false });
  f.db.exec("DELETE FROM run_usage");
  expect(f.service.summary(f.subagentId).tokenUsage).toMatchObject({ totalTokens: null, missingUsageEffects: 1 });
  f.db.exec("UPDATE run_effects SET state='intent_committed' WHERE kind='model'");
  expect(f.service.summary(f.subagentId).tokenUsage).toMatchObject({ totalTokens: null, inflightEffects: 1, complete: false });
});

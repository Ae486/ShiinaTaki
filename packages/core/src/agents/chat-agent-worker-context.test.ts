import { afterEach, describe, expect, it, vi } from "vitest";
import { simulateReadableStream, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import type { SubagentControlResult } from "@taki/shared";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { generatingModel, scriptedModel } from "../testing/mock-language-model.ts";
import type { UtilitySlot } from "../memory/utility-slot.ts";
import { createSubagentContextSummaryRepo } from "../db/subagent-context-summary-repo.ts";
import { readSubagentSelfHistory } from "./subagent-self-history-tool.ts";
import { createSubagentToolResultRepo } from "../db/subagent-tool-result-repo.ts";
import * as stores from "./run-message-store.ts";

type Fixture = Awaited<ReturnType<typeof subagentFixture>>;
const fixtures: Fixture[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });
async function fresh(...args: Parameters<typeof subagentFixture>) {
  const f = await subagentFixture(...args); fixtures.push(f); return f;
}
const work = { characterId: "taki", operationKey: "context-work", label: "Exact research",
  initialContext: { kind: "fresh" as const }, direction: "ROOT_DIRECTION: user did not visit Osaka; external speaker Mina did.",
  materials: [{ key: "source", text: "Mina visited Osaka.", source: { speaker: "Mina" } }], completionPolicy: "record_only" as const };
function utility(text = "Task: continue research. User did not visit Osaka. External speaker Mina visited Osaka. Completed read rounds; remaining work continues.") {
  const model = generatingModel(text);
  const slot: UtilitySlot = { model, run: vi.fn(async (_label, action) => action()),
    usage: () => ({ calls: 0, inputTokens: 0, outputTokens: 0, usageUnknown: 0 }) };
  return { model, slot };
}
async function finished(f: Fixture, accepted: SubagentControlResult) {
  await vi.waitFor(() => expect(f.executions.list({ subagentId: accepted.conversation.subagentId })[0]?.result).toBeTruthy(), { timeout: 15_000 });
  return f.executions.list({ subagentId: accepted.conversation.subagentId })[0]!;
}
async function delegate(f: Fixture, names = ["read"]) {
  return f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: names }, work);
}
function correction(f: Fixture, accepted: SubagentControlResult, detail: number | { ordinal: number; body: string }) {
  const { ordinal, body } = typeof detail === "number" ? { ordinal: detail, body: "" } : detail;
  const current = f.service.summary(accepted.conversation.subagentId);
  return f.service.send({ characterId: "taki", target: { subagentId: current.subagentId,
    workInputId: accepted.input!.workInputId, expectedControlVersion: current.controlVersion, expectedRunId: current.activeRunId! },
  operationKey: `correction-${ordinal}`, direction: `CORRECTION_${ordinal}: user did NOT do action ${ordinal}. ${body}`,
  materials: [] }, { kind: "user" });
}

describe("actual shared ChatAgent worker context", () => {
  it("crosses project and SDK caps through pressure rollovers with one Run/Attempt, exact inputs and durable raw materials", async () => {
    const summary = utility();
    const segments: Array<{ bytes: number; step: number; rolled: boolean }> = [];
    const createStore = stores.createRunMessageStore;
    vi.spyOn(stores, "createRunMessageStore").mockImplementation((input) => {
      const store = createStore(input);
      return { ...store, async checkpointSegment(checkpoint) {
        const result = await store.checkpointSegment!(checkpoint);
        segments.push({ bytes: checkpoint.retainedBytes, step: checkpoint.stepNumber, rolled: result.kind === "context_rollover" });
        return result;
      } };
    });
    const rounds = 35;
    const model = scriptedModel([...Array.from({ length: rounds }, () => ({ kind: "tool" as const,
      toolCallId: "provider-reused-local-id", toolName: "read", input: {} })),
    { kind: "tool", toolCallId: "finish", toolName: "complete_subagent", input: { text: "Completed research", materials: [] } }]);
    let count = 0;
    const prompts = new Map<string, string>();
    const f = await fresh(model, { utility: summary.slot, historyBudget: () => 2400,
      agent: { contextWindowTokens: () => 6200, onPrimaryCommitted: vi.fn(), onUsage: vi.fn() }, tools: {
        read: tool({ inputSchema: z.strictObject({}), execute: async () => {
          await vi.waitFor(() => expect(accepted).toBeDefined());
          count += 1; correction(f, accepted, count);
          return { rawReceipt: `RAW_ONLY_${count}`, body: "Full exact retained evidence. ".repeat(350) };
        }, toModelOutput: ({ output }) => ({ type: "json", value: { body: String(output.body).slice(0, 1200) } }) }),
      } });
    const originalStream = model.doStream.bind(model);
    model.doStream = async (options) => {
      const effect = f.db.prepare("SELECT effect_id FROM run_effects WHERE kind='model' AND state='intent_committed' ORDER BY rowid DESC LIMIT 1").get();
      prompts.set(String(effect?.effect_id), JSON.stringify(options.prompt));
      return originalStream(options);
    };
    const failures: unknown[] = [];
    const originalAgentStream = f.agent.stream;
    f.agent.stream = async function* (...args) {
      try { yield* originalAgentStream(...args); } catch (error) { failures.push(error); throw error; }
    };
    const accepted = await delegate(f);
    const execution = await finished(f, accepted);
    expect(failures, JSON.stringify({ generates: summary.model.doGenerateCalls.length, summaries: f.db.prepare("SELECT * FROM subagent_context_summaries").all(),
      failures: f.db.prepare("SELECT * FROM subagent_context_summary_failures").all() })).toEqual([]);
    expect(execution.result).toMatchObject({ outcome: "completed", outputKind: "validated", body: "Completed research" });
    expect(model.doStreamCalls).toHaveLength(rounds + 1);
    expect(model.doStreamCalls.every((call) => !JSON.stringify(call.prompt).includes("Helping with a task:"))).toBe(true);
    expect(count).toBe(rounds);
    expect(f.executions.list({ subagentId: accepted.conversation.subagentId })).toHaveLength(1);
    const attempts = f.db.prepare("SELECT attempt_id FROM run_attempts WHERE run_id=:run").all({ run: execution.runId });
    expect(attempts).toHaveLength(1);
    expect(segments.filter((row) => row.rolled).length).toBeGreaterThan(2);
    expect(Math.max(...segments.map((row) => row.bytes))).toBeLessThan(90_000);
    expect(segments.map((row) => row.step)).toEqual(Array.from({ length: rounds }, (_, i) => i));
    const sources = f.db.prepare("SELECT * FROM subagent_tool_results WHERE run_id=:run ORDER BY step_number").all({ run: execution.runId });
    expect(sources).toHaveLength(rounds + 1);
    expect(new Set(sources.map((row) => `${row.attempt_id}:${row.step_number}:${row.tool_call_id}`)).size).toBe(rounds + 1);
    expect(sources[0]?.output_json).toContain("RAW_ONLY_1");
    expect([...prompts.values()].some((prompt) => prompt.includes("RAW_ONLY_1"))).toBe(false);
    const checkpoint = createSubagentContextSummaryRepo(f.db).latest(accepted.input!.workInputId);
    expect(checkpoint?.revision).toBeGreaterThan(1);
    expect(checkpoint?.text).toContain("User did not visit Osaka");
    expect(summary.model.doGenerateCalls.length).toBeGreaterThan(1);
    expect(JSON.stringify(summary.model.doGenerateCalls[0]?.prompt)).toContain('\\"kind\\":\\"user\\"');
    expect(JSON.stringify(summary.model.doGenerateCalls[0]?.prompt)).toContain("Mina");
    const receipts = f.db.prepare("SELECT input_id,model_effect_id FROM run_messages WHERE run_id=:run AND entry_kind='input'").all({ run: execution.runId });
    for (const receipt of receipts) expect(prompts.get(String(receipt.model_effect_id))).toContain(f.inputs.get(String(receipt.input_id)).direction);
    const witnessed = f.db.prepare("SELECT effect_id FROM subagent_context_summary_intents WHERE work_input_id=:work").all({ work: accepted.input!.workInputId });
    expect(witnessed.length).toBeGreaterThan(0);
    const summaryOnly = witnessed.find((row) => !prompts.get(String(row.effect_id))?.includes(work.direction));
    expect(summaryOnly).toBeDefined();
    expect(receipts.some((row) => row.model_effect_id === summaryOnly?.effect_id && row.input_id === accepted.input!.inputId)).toBe(false);
    expect(f.inputs.list({ subagentId: accepted.conversation.subagentId, limit: 100 }).every((input) => input.consumed)).toBe(true);
    expect(f.conversation.history("taki")).toEqual([]);
    expect(f.errors).toEqual([]);
  }, 20_000);

  it("keeps primary limits unchanged", async () => {
    const calls = vi.fn(async () => ({ ok: true }));
    const model = scriptedModel(Array.from({ length: 30 }, (_, index) => ({ kind: "tool" as const,
      toolCallId: `primary-${index}`, toolName: "read", input: {} })));
    const f = await fresh(model, { agent: { maxSteps: 3, extraTools: { read: tool({ inputSchema: z.strictObject({}), execute: calls }) } } });
    for await (const text of f.agent.stream({ characterId: "taki", message: "read" })) void text;
    expect(calls).toHaveBeenCalledTimes(3);
    expect(model.doStreamCalls).toHaveLength(3);
  });

  it("continues after a settled tool error at pressure without replaying the failed action", async () => {
    const execute = vi.fn(async (): Promise<{ ok: boolean }> => { throw new Error("Read failed with retained evidence. ".repeat(1500)); });
    const model = scriptedModel([{ kind: "tool", toolCallId: "failed-read", toolName: "read", input: {} },
      { kind: "text", deltas: ["The read failed; I have not obtained its result."] }]);
    const f = await fresh(model, { historyBudget: () => 1200, agent: { contextWindowTokens: () => 6000 },
      tools: { read: tool({ inputSchema: z.strictObject({}), execute }) } });
    const accepted = await delegate(f); const execution = await finished(f, accepted);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(execute).toHaveBeenCalledOnce();
    expect(execution.result).toMatchObject({ outcome: "completed", outputKind: "unstructured" });
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("Read failed");
  });

  it.each([false, true])("refuses a provider-owned frontier at pressure (deferred=%s)", async (deferred) => {
    const remote = vi.fn(async () => ({ mustNotExecute: true }));
    const read = vi.fn(async () => ({ raw: "Retained local evidence. ".repeat(3000) }));
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [
      { type: "stream-start", warnings: [] },
      { type: "tool-call", toolCallId: "remote", toolName: "remote", input: "{}", providerExecuted: true },
      ...deferred ? [] : [{ type: "tool-result" as const, toolCallId: "remote", toolName: "remote", result: { known: "provider result" } }],
      { type: "tool-call", toolCallId: "local", toolName: "read", input: "{}" },
      { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage: {
        inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
      } },
    ] }) }) });
    const f = await fresh(model, { historyBudget: () => 1200, agent: { contextWindowTokens: () => 6000 }, tools: {
      read: tool({ inputSchema: z.strictObject({}), execute: read, toModelOutput: () => ({ type: "text", value: "Read result retained" }) }),
      remote: tool({ inputSchema: z.strictObject({}), execute: remote }),
    } });
    const accepted = await delegate(f, ["read", "remote"]); const execution = await finished(f, accepted);
    expect(model.doStreamCalls).toHaveLength(1);
    expect(read).toHaveBeenCalledOnce(); expect(remote).not.toHaveBeenCalled();
    expect(execution.result?.outcome).toBe("failed");
    expect(createSubagentContextSummaryRepo(f.db).latest(accepted.input!.workInputId)).toBeNull();
    expect(f.db.prepare("SELECT output_json FROM subagent_tool_results WHERE run_id=:run AND tool_call_id='local'")
      .get({ run: execution.runId })?.output_json).toContain("Retained local evidence");
  });

  it("keeps deferred tool disclosure across a loader-triggered rollover without replaying the loader", async () => {
    const describeTool = vi.fn(async () => ({ entry: { identity: { extensionId: "ext:read" }, available: true },
      toolName: "read", internalDetail: "retained exact schema evidence ".repeat(2500) }));
    const read = vi.fn(async () => ({ ok: true }));
    const model = scriptedModel([{ kind: "tool", toolCallId: "describe", toolName: "extension_describe", input: { extensionId: "ext:read" } },
      { kind: "tool", toolCallId: "read", toolName: "read", input: {} }, { kind: "text", deltas: ["done"] }]);
    const f = await fresh(model, { historyBudget: () => 1200, agent: { contextWindowTokens: () => 6000 },
      toolDisclosure: { deferredToolNames: ["read"], describedTools: { "ext:read": "read" }, skills: {} }, tools: {
        extension_describe: tool({ inputSchema: z.strictObject({ extensionId: z.string() }), execute: describeTool,
          toModelOutput: () => ({ type: "text", value: "read is available." }) }),
        read: tool({ inputSchema: z.strictObject({}), execute: read }),
      } });
    const accepted = await delegate(f, ["extension_describe", "read"]); const execution = await finished(f, accepted);
    expect(execution.result?.outcome).toBe("completed");
    expect(model.doStreamCalls[0]?.tools?.map((entry) => entry.name)).not.toContain("read");
    expect(model.doStreamCalls[1]?.tools?.map((entry) => entry.name)).toContain("read");
    expect(describeTool).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledOnce();
    expect(f.executions.list({ subagentId: accepted.conversation.subagentId })).toHaveLength(1);
  });

  it.each(["blank", "non_shrinking", "provider_failure", "truncated"])("keeps raw evidence and reports bounded %s summary failure", async (kind) => {
    const summary = utility(kind === "blank" ? "" : "This is a non-shrinking summary. ".repeat(3000));
    if (kind === "provider_failure") summary.model.doGenerate = async () => { throw new Error("Summary provider unavailable"); };
    if (kind === "truncated") {
      const generate = summary.model.doGenerate.bind(summary.model);
      summary.model.doGenerate = async (options) => ({ ...await generate(options), finishReason: { unified: "length", raw: undefined } });
    }
    const model = scriptedModel([...Array.from({ length: 30 }, (_, index) => ({ kind: "tool" as const,
      toolCallId: `read-${index}`, toolName: "read", input: {} })), { kind: "text", deltas: ["not completed"] }]);
    const f = await fresh(model, { utility: summary.slot, agent: { contextWindowTokens: () => 5000 }, tools: {
      read: tool({ inputSchema: z.strictObject({}), execute: async () => ({ body: "Retained task evidence. ".repeat(50) }) }),
    } });
    const accepted = await delegate(f); const execution = await finished(f, accepted);
    expect(execution.result?.outcome).toBe("failed");
    expect(createSubagentContextSummaryRepo(f.db).latest(accepted.input!.workInputId)).toBeNull();
    const failures = f.db.prepare("SELECT source_digest,code FROM subagent_context_summary_failures WHERE work_input_id=:work").all({ work: accepted.input!.workInputId });
    expect(failures.length).toBeGreaterThan(0);
    const expectedCode = kind === "provider_failure" ? "SUBAGENT_SUMMARY_REPLACEMENT_FAILED" : `SUBAGENT_SUMMARY_QUALITY_${kind.toUpperCase()}`;
    expect(failures.every((row) => row.code === expectedCode)).toBe(true);
    expect(new Set(failures.map((row) => row.source_digest)).size).toBe(failures.length);
    expect(summary.slot.run).toHaveBeenCalledTimes(failures.length * (kind === "non_shrinking" ? 2 : 1));
    expect(f.messages.history({ subagentId: accepted.conversation.subagentId }).some((row) => JSON.stringify(row.parts ?? []).includes("Retained task evidence"))).toBe(true);
    expect(model.doStreamCalls.some((call) => JSON.stringify(call.prompt).includes("current summary checkpoint is unavailable"))).toBe(true);
    expect(f.executions.list({ subagentId: accepted.conversation.subagentId })).toHaveLength(1);
  });

  it("includes every pending correction across pages and rejects an unfit batch without consuming it", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const entered = vi.fn();
    const model = scriptedModel([{ kind: "tool", toolCallId: "read", toolName: "read", input: {} }, { kind: "text", deltas: ["done"] }]);
    const f = await fresh(model, { agent: { contextWindowTokens: () => 60_000 }, tools: {
      read: tool({ inputSchema: z.strictObject({}), execute: async () => { entered(); await blocked; return { ok: true }; } }),
    } });
    const accepted = await delegate(f);
    await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
    const inputs = Array.from({ length: 205 }, (_, index) => correction(f, accepted, index).input!);
    release(); await finished(f, accepted);
    const prompt = JSON.stringify(model.doStreamCalls[1]?.prompt);
    for (const input of inputs) { expect(prompt).toContain(input.direction); expect(f.inputs.get(input.inputId).consumed).not.toBeNull(); }
    expect(f.executions.list({ subagentId: accepted.conversation.subagentId })[0]?.throughWorkSeq).toBe(206);

    const small = scriptedModel([{ kind: "tool", toolCallId: "read", toolName: "read", input: {} }, { kind: "text", deltas: ["must not run"] }]);
    const g = await fresh(small, { agent: { contextWindowTokens: () => 4000 }, tools: {
      read: tool({ inputSchema: z.strictObject({}), execute: async () => {
        await vi.waitFor(() => expect(next).toBeDefined()); correction(g, next, { ordinal: 1, body: "Unfit pending direction. ".repeat(3000) }); return { ok: true };
      } }),
    } });
    const next = await delegate(g); const failed = await finished(g, next);
    expect(failed.result?.outcome).toBe("failed");
    expect(small.doStreamCalls).toHaveLength(1);
    expect(g.inputs.list({ subagentId: next.conversation.subagentId, afterSeq: 1 })[0]?.consumed).toBeNull();
  });

  it("does not start another segment or settle text after user Stop at a durable rollover", async () => {
    const originalStore = stores.createRunMessageStore;
    const rolled = vi.fn();
    vi.spyOn(stores, "createRunMessageStore").mockImplementation((input) => {
      const store = originalStore(input);
      return { ...store, async checkpointSegment(checkpoint) {
        const result = await store.checkpointSegment!(checkpoint);
        if (result.kind === "context_rollover") {
          rolled(); const current = f.service.summary(accepted.conversation.subagentId);
          f.service.stop({ characterId: "taki", target: { subagentId: current.subagentId,
            workInputId: accepted.input!.workInputId, expectedRunId: current.activeRunId!, expectedControlVersion: current.controlVersion } }, "user");
        }
        return result;
      } };
    });
    const execute = vi.fn(async () => ({ body: "Exact evidence ".repeat(5000) }));
    const model = scriptedModel([{ kind: "tool", toolCallId: "once", toolName: "read", input: {} }, { kind: "text", deltas: ["never"] }]);
    const f = await fresh(model, { historyBudget: () => 1200, agent: { contextWindowTokens: () => 6000 }, tools: { read: tool({ inputSchema: z.strictObject({}), execute,
      toModelOutput: () => ({ type: "text", value: "Saved exact evidence" }) }) } });
    const settled = vi.fn(); const retry = vi.fn(); const originalStream = f.agent.stream;
    f.agent.stream = (params, turn) => originalStream(params, { ...turn, onSettledText: settled, onRetry: retry });
    const accepted = await delegate(f); const execution = await finished(f, accepted);
    expect(rolled).toHaveBeenCalledOnce(); expect(execute).toHaveBeenCalledOnce();
    expect(model.doStreamCalls).toHaveLength(1); expect(settled).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
    expect(execution.result?.outcome).toBe("cancelled");
    expect(f.children.get(accepted.conversation.subagentId).stopOrigin).toBe("user");
    expect(f.db.prepare("SELECT count(*) AS count FROM subagent_tool_results WHERE run_id=:run").get({ run: execution.runId })?.count).toBe(1);
  });

  it("refuses unknown non-model Effects before another model dispatch", async () => {
    const model = scriptedModel([{ kind: "tool", toolCallId: "uncertain", toolName: "read", input: {} }, { kind: "text", deltas: ["must not run"] }]);
    const f = await fresh(model, { tools: { read: tool({ inputSchema: z.strictObject({}), execute: async () => {
      await vi.waitFor(() => expect(accepted).toBeDefined());
      const run = f.service.summary(accepted.conversation.subagentId).activeRunId!;
      const attemptId = f.runs.status(run).run.activeAttemptId!;
      const effect = f.effects.prepare({ runId: run, attemptId, kind: "tool", sourceRef: { type: "tool", toolName: "unknown external" }, replayPosture: "never" });
      f.effects.settle({ effectId: effect.effectId, runId: run, attemptId, expectedVersion: effect.version, outcome: "outcome_unknown" });
      return { ok: false, outcome: "unknown" };
    } }) } });
    const accepted = await delegate(f); const execution = await finished(f, accepted);
    expect(model.doStreamCalls).toHaveLength(1);
    expect(execution.result?.outcome).toBe("failed");
    expect(f.effects.list!(execution.runId).some((effect) => effect.outcome === "outcome_unknown")).toBe(true);
  });

  it.each(["correction", "stop"])("fences %s arriving while the summary model is running", async (action) => {
    const summary = utility();
    let changed = false; let dispatchedAtChange = 0; let inputId: string | undefined;
    summary.slot.run = async (_label, generate) => {
      const generated = await generate();
      if (!changed) {
        changed = true; dispatchedAtChange = model.doStreamCalls.length;
        if (action === "correction") inputId = correction(f, accepted, { ordinal: 501,
          body: "Arrived during summary: preserve this new negation." }).input!.inputId;
        else {
          const current = f.service.summary(accepted.conversation.subagentId);
          f.service.stop({ characterId: "taki", target: { subagentId: current.subagentId,
            workInputId: accepted.input!.workInputId, expectedRunId: current.activeRunId,
            expectedControlVersion: current.controlVersion } }, "user");
        }
      }
      return generated;
    };
    const model = scriptedModel([...Array.from({ length: 20 }, (_, index) => ({ kind: "tool" as const,
      toolCallId: `read-${index}`, toolName: "read", input: {} })),
    { kind: "tool", toolCallId: "finish", toolName: "complete_subagent", input: { text: "Work reported", materials: [] } }]);
    const f = await fresh(model, { utility: summary.slot, agent: { contextWindowTokens: () => 5000 }, tools: {
      read: tool({ inputSchema: z.strictObject({}), execute: async () => ({ body: "Retained task evidence. ".repeat(50) }) }),
    } });
    const accepted = await delegate(f); const execution = await finished(f, accepted);
    expect(changed).toBe(true);
    if (action === "stop") {
      expect(execution.result?.outcome).toBe("cancelled");
      expect(model.doStreamCalls).toHaveLength(dispatchedAtChange);
      expect(createSubagentContextSummaryRepo(f.db).latest(accepted.input!.workInputId)).toBeNull();
    } else {
      expect(execution.result?.outcome).toBe("completed");
      expect(f.inputs.get(inputId!).consumed).not.toBeNull();
      const correctionStep = f.inputs.get(inputId!).consumed!.step;
      expect(JSON.stringify(model.doStreamCalls[correctionStep]?.prompt)).toContain("Arrived during summary");
      expect(JSON.stringify(summary.model.doGenerateCalls[0]?.prompt)).not.toContain("Arrived during summary");
    }
  });

  it("commits summaries by owner/source/revision CAS and leaves raw evidence intact on stale or failed generation", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; }); let count = 0;
    const entered = vi.fn();
    const model = scriptedModel([{ kind: "tool", toolCallId: "complete", toolName: "read", input: {} },
      { kind: "tool", toolCallId: "hold", toolName: "read", input: {} }, { kind: "text", deltas: ["done"] }]);
    const f = await fresh(model, { tools: { read: tool({ inputSchema: z.strictObject({}), execute: async () => {
      count += 1; if (count === 2) { entered(); await blocked; } return { ok: true };
    } }) } });
    const accepted = await delegate(f); await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
    const runId = f.service.summary(accepted.conversation.subagentId).activeRunId!;
    const attemptId = f.runs.status(runId).run.activeAttemptId!;
    const summaries = createSubagentContextSummaryRepo(f.db);
    const rows = f.messages.history({ subagentId: accepted.conversation.subagentId });
    const throughSeq = rows.filter((row) => row.entryKind === "output" && row.stepNumber === 0).at(-1)!.seq;
    expect(() => summaries.capture({ subagentId: accepted.conversation.subagentId,
      workInputId: accepted.input!.workInputId, throughSeq: rows.at(-1)!.seq })).toThrow("SUBAGENT_SUMMARY_INCOMPLETE_RANGE");
    const range = summaries.capture({ subagentId: accepted.conversation.subagentId, workInputId: accepted.input!.workInputId, throughSeq });
    const commit = { range, text: "Companion supplied Mina's report. User did not visit Osaka.", runId, attemptId,
      token: f.executions.token(runId), validateCurrent() {} };
    expect(() => summaries.commit({ ...commit, range: { ...range, sourceDigest: "a".repeat(64) } })).toThrow("SUBAGENT_SUMMARY_SOURCE_STALE");
    expect(summaries.latest(accepted.input!.workInputId)).toBeNull();
    expect(() => f.db.prepare("UPDATE subagent_inputs SET direction_text='Changed sender claim' WHERE input_id=:input")
      .run({ input: accepted.input!.inputId })).toThrow("SUBAGENT_INPUT_IMMUTABLE");
    expect(() => summaries.commit({ ...commit, token: { ...commit.token, controlVersion: 100 } })).toThrow("SUBAGENT_SUMMARY_OWNER_STALE");
    f.db.exec("CREATE TEMP TRIGGER fail_summary BEFORE INSERT ON subagent_context_summaries BEGIN SELECT RAISE(ABORT,'summary write failed'); END");
    expect(() => summaries.commit(commit)).toThrow("summary write failed");
    expect(summaries.latest(accepted.input!.workInputId)).toBeNull();
    f.db.exec("DROP TRIGGER fail_summary");
    const committed = summaries.commit(commit); expect(committed.revision).toBe(1);
    expect(() => summaries.commit(commit)).toThrow("SUBAGENT_SUMMARY_CONFLICT");
    expect(f.messages.history({ subagentId: accepted.conversation.subagentId })).toEqual(rows);
    release(); await finished(f, accepted);
    expect(createSubagentContextSummaryRepo(f.db).latest(accepted.input!.workInputId)).toEqual(committed);
  });

  it("retrieves every exact body page with self scope, and distinguishes invalid/unavailable/failed reads", async () => {
    const body = "source-😀".repeat(8000);
    const model = scriptedModel([{ kind: "tool", toolCallId: "body", toolName: "read", input: {} }, { kind: "text", deltas: ["done"] }]);
    const f = await fresh(model, { agent: { contextWindowTokens: () => 6000 },
      tools: { read: tool({ inputSchema: z.strictObject({}), execute: async () => ({ body }) }) } });
    const accepted = await delegate(f); await finished(f, accepted);
    const projected = JSON.stringify(model.doStreamCalls[1]?.prompt);
    expect(projected).toContain("exact retained row is pageable");
    expect(projected).toContain("[... reduced ...]");
    const bound = { characterId: "taki", subagentId: accepted.conversation.subagentId, children: f.children,
      inputs: f.inputs, executions: f.executions, messages: f.messages, toolResults: createSubagentToolResultRepo(f.db) };
    let cursor: string | null = null; let accumulated = ""; let pages = 0;
    do {
      const page = readSubagentSelfHistory(bound, { category: "materials", cursor, limit: 1 });
      expect(page.status).toBe("available"); accumulated += page.records[0]?.body; cursor = page.nextCursor; pages += 1;
    } while (cursor);
    expect(pages).toBeGreaterThan(3);
    expect(JSON.parse(accumulated).text).toBe(JSON.stringify({ body }));
    expect(readSubagentSelfHistory(bound, { category: "inputs", cursor: "invalid", limit: 1 }).status).toBe("invalid_cursor");
    const first = readSubagentSelfHistory(bound, { category: "materials", cursor: null, limit: 1 });
    const foreign = JSON.stringify({ ...JSON.parse(first.nextCursor!), child: "another-child" });
    expect(readSubagentSelfHistory(bound, { category: "materials", cursor: foreign, limit: 1 }).status).toBe("invalid_cursor");
    expect(readSubagentSelfHistory({ ...bound, characterId: "other" }, { category: "inputs", cursor: null, limit: 1 }).status).toBe("unavailable");
    expect(readSubagentSelfHistory({ ...bound, messages: { ...f.messages, history: () => { throw new Error("storage down"); } } },
      { category: "messages", cursor: null, limit: 1 }).status).toBe("failed");
  });
});

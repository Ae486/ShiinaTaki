import { afterEach, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { SubagentSelfHistoryResultSchema, type SubagentContextSummary } from "@taki/shared";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedGenerateModel, scriptedModel } from "../testing/mock-language-model.ts";
import type { UtilitySlot } from "../memory/utility-slot.ts";
import { estimateMessagesTokens } from "../memory/token-estimator.ts";
import { createSubagentToolResultRepo } from "../db/subagent-tool-result-repo.ts";
import * as stores from "./run-message-store.ts";

const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });

function unwrapped(value: unknown): unknown {
  return value && typeof value === "object" && ("materialReferences" in value || "sourceContext" in value) && "result" in value
    ? unwrapped(value.result) : value;
}

it.each(["capacity", "non_shrinking"])("repairs a persisted summary after %s rejection through bounded governed Utility calls with unchanged history pages and raw-input receipts", async (kind) => {
  const previousText = "summary ".repeat(1500);
  const correctedText = "The external source supplied the evidence; the user did not perform the action. Continue the unfinished audit.";
  const summaryModel = scriptedGenerateModel([
    { kind: "text", deltas: ["summary ".repeat(kind === "capacity" ? 1400 : 1600)] },
    { kind: "text", deltas: [correctedText] },
  ]);
  const utility: UtilitySlot = { model: summaryModel, run: vi.fn(async (_label, generate) => generate()),
    usage: () => ({ calls: 0, inputTokens: 0, outputTokens: 0, usageUnknown: 0 }) };
  let previous: SubagentContextSummary | undefined;
  let inputReceipts = 0;
  const createStore = stores.createRunMessageStore;
  vi.spyOn(stores, "createRunMessageStore").mockImplementation((input) => {
    const store = createStore(input);
    return { ...store, recordCompletedStep(step) {
      store.recordCompletedStep(step);
      if (step.stepNumber !== 0 || input.scope.kind !== "subagent" || previous) return;
      const throughSeq = input.messages.history({ subagentId: input.scope.subagentId })
        .filter((row) => row.entryKind === "output" && row.stepNumber === 0).at(-1)!.seq;
      // Reproduce an already persisted checkpoint produced by the old shrinking-only acceptance path.
      const range = input.summaries!.capture({ subagentId: input.scope.subagentId, workInputId: input.scope.workInputId, throughSeq });
      previous = input.summaries!.commit({ range, text: previousText, runId: input.runId, attemptId: step.attemptId,
        token: input.executions.token(input.runId), validateCurrent() {} });
      inputReceipts = input.messages.history({ subagentId: input.scope.subagentId }).filter((row) => row.entryKind === "input").length;
    } };
  });
  const model = scriptedModel([
    { kind: "tool", toolCallId: "seed", toolName: "read_file", input: {} },
    { kind: "tools", calls: [
      { toolCallId: "message-page", toolName: "read_self_history", input: { category: "messages", cursor: null, limit: 20 } },
      { toolCallId: "material-page", toolName: "read_self_history", input: { category: "materials", cursor: null, limit: 1 } },
    ] },
    { kind: "tool", toolCallId: "finish", toolName: "complete_subagent", input: { text: "The audit is complete.", materials: [] } },
  ]);
  const f = await subagentFixture(model, { utility, historyBudget: () => 4000,
    agent: { contextWindowTokens: () => 48000, requestEnvelopeReserve: () => 44000 },
    tools: { read_file: tool({ inputSchema: z.object({}), execute: () => ({ content: "Original attributed source evidence. ".repeat(1000) }) }) } });
  fixtures.push(f);
  const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["read_file"] }, {
    characterId: "taki", operationKey: "summary-repair", label: "Worker", direction: "Audit the retained evidence without changing its attribution.",
    materials: [], initialContext: { kind: "fresh" }, completionPolicy: "record_only",
  });
  const subagentId = accepted.conversation.subagentId;
  await vi.waitFor(() => expect(f.executions.list({ subagentId })[0]?.result).toBeTruthy(), { timeout: 5000 });
  const execution = f.executions.list({ subagentId })[0]!;
  expect(execution.result).toMatchObject({ outcome: "completed", outputKind: "validated" });
  expect(model.doStreamCalls).toHaveLength(3);
  expect(summaryModel.doGenerateCalls).toHaveLength(2);
  expect(utility.run).toHaveBeenCalledTimes(2);
  const firstPrompt = summaryModel.doGenerateCalls[0]!.prompt;
  const secondPrompt = summaryModel.doGenerateCalls[1]!.prompt;
  expect(firstPrompt.filter((message) => message.role !== "system")).toEqual(secondPrompt.filter((message) => message.role !== "system"));
  expect(JSON.stringify(firstPrompt)).toContain(previousText);
  expect(JSON.stringify(secondPrompt)).toContain(kind === "capacity" ? "previous replacement was valid but too large"
    : "previous replacement did not reduce the task context");
  if (kind === "non_shrinking") expect(JSON.stringify(secondPrompt)).toContain("strictly below 3000 estimated summary tokens");
  expect(summaryModel.doGenerateCalls.every((request) => request.maxOutputTokens === undefined)).toBe(true);
  const summaries = f.db.prepare("SELECT * FROM subagent_context_summaries ORDER BY revision").all();
  expect(summaries).toHaveLength(2);
  expect(summaries[0]).toMatchObject({ revision: 1, summary_text: previousText, through_seq: previous!.throughSeq });
  expect(summaries[1]).toMatchObject({ revision: 2, summary_text: correctedText,
    through_seq: previous!.throughSeq, source_from_seq: previous!.throughSeq + 1 });
  expect(f.db.prepare("SELECT count(*) AS n FROM subagent_context_summary_failures").get()?.n).toBe(0);
  expect(f.messages.history({ subagentId }).filter((row) => row.entryKind === "input")).toHaveLength(inputReceipts);
  expect(f.db.prepare("SELECT count(*) AS n FROM subagent_task_steps WHERE completed_ordinal IS NOT NULL").get()?.n).toBe(3);
  const intents = f.db.prepare("SELECT revision FROM subagent_context_summary_intents ORDER BY rowid").all();
  expect(intents.map((row) => row.revision)).toEqual([1, 2]);
  const stored = createSubagentToolResultRepo(f.db);
  const finalPrompt = model.doStreamCalls[2]!.prompt;
  const parts = finalPrompt.flatMap((message) => message.role === "tool" ? message.content : []);
  for (const toolCallId of ["message-page", "material-page"]) {
    const raw = SubagentSelfHistoryResultSchema.parse(JSON.parse(stored.read({ runId: execution.runId,
      attemptId: execution.result!.attemptId, stepNumber: 1, toolCallId })!.text));
    const part = parts.find((part) => part.type === "tool-result" && part.toolCallId === toolCallId)!;
    if (part.type !== "tool-result" || part.output.type !== "json") throw new Error("Expected an exact history page");
    expect(JSON.stringify(unwrapped(part.output.value))).toBe(JSON.stringify(raw));
    expect(raw.hasMore).toBe(true);
  }
  expect(estimateMessagesTokens(finalPrompt.filter((message) => message.role !== "system"))).toBeLessThan(4000);
  expect(f.errors).toEqual([]);
}, 15_000);

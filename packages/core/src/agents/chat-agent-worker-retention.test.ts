import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { generatingModel, scriptedModel } from "../testing/mock-language-model.ts";
import type { UtilitySlot } from "../memory/utility-slot.ts";
import { createSubagentContextSummaryRepo } from "../db/subagent-context-summary-repo.ts";
import { readSubagentSelfHistory } from "./subagent-self-history-tool.ts";
import { createSubagentToolResultRepo } from "../db/subagent-tool-result-repo.ts";

type Fixture = Awaited<ReturnType<typeof subagentFixture>>;
const fixtures: Fixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });
async function fresh(...args: Parameters<typeof subagentFixture>) {
  const fixture = await subagentFixture(...args); fixtures.push(fixture); return fixture;
}
function utility(): UtilitySlot {
  return { model: generatingModel("Task: continue exact research. The user did not visit Osaka; Mina did. Completed evidence is retained; continue outstanding work."),
    run: async (_label, action) => action(), usage: () => ({ calls: 0, inputTokens: 0, outputTokens: 0, usageUnknown: 0 }) };
}
const work = { characterId: "taki", operationKey: "retained-context", label: "Long research",
  initialContext: { kind: "fresh" as const }, direction: "Do not confuse Mina's Osaka visit with the user's experience.",
  materials: [], completionPolicy: "record_only" as const };
async function finished(f: Fixture, child: string) {
  await vi.waitFor(() => expect(f.executions.list({ subagentId: child })[0]?.result).toBeTruthy(), { timeout: 15_000 });
}

describe("private task continuation and retained evidence", () => {
  it.each([true, false])("compacts terminal historical interrupted evidence after explicit continuation (partial=%s)", async (partial) => {
    let first = true; let entered = false;
    const later = scriptedModel([...Array.from({ length: 35 }, (_, index) => ({ kind: "tool" as const,
      toolCallId: `read-${index}`, toolName: "read", input: {} })),
    { kind: "tool", toolCallId: "finish", toolName: "complete_subagent", input: { text: "Continued research finished", materials: [] } }]);
    const model = new MockLanguageModelV4({ doStream: async (options) => {
      if (!first) return later.doStream(options);
      first = false; entered = true;
      return { stream: new ReadableStream({ start(controller) {
        if (partial) {
          controller.enqueue({ type: "text-start", id: "partial" });
          controller.enqueue({ type: "text-delta", id: "partial", delta: "Historical unfinished partial evidence" });
        }
      } }) };
    } });
    const summary = generatingModel("The earlier Run was cancelled, its output unfinished. Exact partial evidence remains available. Completed later reads retain evidence; continue current work.");
    const f = await fresh(model, { utility: { ...utility(), model: summary }, agent: { contextWindowTokens: () => 5000 },
      tools: { read: tool({ inputSchema: z.strictObject({}), execute: async () => ({ body: "Exact completed evidence. ".repeat(70) }) }) } });
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["read"] }, work);
    const child = accepted.conversation.subagentId;
    await vi.waitFor(() => expect(entered).toBe(true));
    // Let the SDK consumer receive the actual partial delta before the user interrupts it.
    await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
    let current = f.service.summary(child);
    f.service.stop({ characterId: "taki", target: { subagentId: child, workInputId: accepted.input!.workInputId,
      expectedRunId: current.activeRunId, expectedControlVersion: current.controlVersion } }, "user");
    await finished(f, child);
    const previous = f.executions.list({ subagentId: child })[0]!;
    const oldRows = f.messages.history({ subagentId: child });
    expect(oldRows.map((row) => row.entryKind)).toEqual(partial ? ["input", "partial"] : ["input"]);
    current = f.service.summary(child);
    f.service.continue({ characterId: "taki", target: { subagentId: child, workInputId: accepted.input!.workInputId,
      expectedRunId: current.activeRunId, expectedControlVersion: current.controlVersion }, operationKey: "continue-interrupted",
    direction: "Continue the research with the retained evidence", materials: [] }, { kind: "user" });
    await vi.waitFor(() => expect(f.executions.list({ subagentId: child }).find((run) => run.runId !== previous.runId)?.result).toBeTruthy(), { timeout: 15_000 });
    const continued = f.executions.list({ subagentId: child }).find((run) => run.runId !== previous.runId)!;
    expect(continued.result).toMatchObject({ outcome: "completed", outputKind: "validated" });
    expect(later.doStreamCalls).toHaveLength(36);
    expect(summary.doGenerateCalls.length).toBeGreaterThan(0);
    expect(JSON.stringify(summary.doGenerateCalls[0]?.prompt)).toContain("cancelled");
    expect(JSON.stringify(summary.doGenerateCalls[0]?.prompt)).toContain(partial ? "Historical unfinished partial evidence" : work.direction);
    expect(f.messages.history({ subagentId: child }).filter((row) => row.runId === previous.runId)).toEqual(oldRows);
    expect(f.executions.get(previous.runId).result).toEqual(previous.result);
  }, 20_000);

  it("reuses a committed summary on explicit continuation without consuming summary-only inputs again", async () => {
    const model = scriptedModel([...Array.from({ length: 24 }, (_, index) => ({ kind: "tool" as const,
      toolCallId: `read-${index}`, toolName: "read", input: {} })),
    { kind: "tool", toolCallId: "first-final", toolName: "complete_subagent", input: { text: "First result retained", materials: [] } },
    { kind: "tool", toolCallId: "second-final", toolName: "complete_subagent", input: { text: "Corrected result retained", materials: [] } }]);
    const f = await fresh(model, { historyBudget: () => 1800, utility: utility(), agent: { contextWindowTokens: () => 6200 },
      tools: { read: tool({ inputSchema: z.strictObject({}), execute: async () => ({ body: "Exact retained research. ".repeat(350) }),
        toModelOutput: () => ({ type: "text", value: "Research result: ".repeat(65) }) }) } });
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["read"] }, work);
    const child = accepted.conversation.subagentId;
    await finished(f, child);
    const first = f.executions.list({ subagentId: child })[0]!;
    const summary = createSubagentContextSummaryRepo(f.db).latest(accepted.input!.workInputId);
    expect(summary).not.toBeNull();
    const originalReceipt = f.inputs.get(accepted.input!.inputId).consumed;
    const current = f.service.summary(child);
    const continued = f.service.continue({ characterId: "taki", target: { subagentId: child,
      workInputId: accepted.input!.workInputId, expectedControlVersion: current.controlVersion, expectedRunId: current.activeRunId },
    operationKey: "continue-summary", direction: "User correction: Mina did NOT take that train. Apply this correction.", materials: [] }, { kind: "user" });
    await vi.waitFor(() => {
      const executions = f.executions.list({ subagentId: child });
      expect(executions).toHaveLength(2); expect(executions.every((execution) => execution.result)).toBe(true);
    });
    const second = f.executions.list({ subagentId: child }).find((execution) => execution.runId !== first.runId)!;
    expect(second.workInputId).toBe(first.workInputId);
    expect(second.result).toMatchObject({ outcome: "completed", outputKind: "validated" });
    expect(model.doStreamCalls).toHaveLength(26);
    const prompt = JSON.stringify(model.doStreamCalls[25]?.prompt);
    expect(prompt).toContain("Core private task summary");
    expect(prompt).toContain("Mina did NOT take that train");
    expect(prompt).not.toContain(work.direction);
    expect(f.inputs.get(accepted.input!.inputId).consumed).toEqual(originalReceipt);
    expect(f.inputs.get(continued.input!.inputId).consumed?.runId).toBe(second.runId);
    expect(f.db.prepare("SELECT input_id FROM run_messages WHERE run_id=:run AND input_id=:input")
      .all({ run: second.runId, input: accepted.input!.inputId })).toEqual([]);
  }, 20_000);

  it("pages all retained records beyond the old 2,000-row cap and freezes each traversal watermark", async () => {
    const entered = vi.fn(); let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const model = scriptedModel([{ kind: "tool", toolCallId: "hold", toolName: "read", input: {} }]);
    const f = await fresh(model, { tools: { read: tool({ inputSchema: z.strictObject({}),
      execute: async () => { entered(); await held; return { held: true }; } }) } });
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["read"] }, work);
    await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
    const child = accepted.conversation.subagentId;
    const runId = f.service.summary(child).activeRunId!;
    const attemptId = f.runs.status(runId).run.activeAttemptId!;
    const toolResults = createSubagentToolResultRepo(f.db);
    const bound = { characterId: "taki", subagentId: child, children: f.children, inputs: f.inputs,
      executions: f.executions, messages: f.messages, toolResults };
    f.db.transaction(() => {
      for (let index = 1; index <= 2105; index += 1) {
        f.messages.recordStep({ runId, attemptId, batch: { stepNumber: index, entryKind: "output",
          messages: [{ role: "assistant", content: `Retained record ${index}: Mina visited Osaka; the user did not.` }] } });
        toolResults.persist({ runId, attemptId, stepNumber: index, toolCallId: `material-${index}`, toolName: "read",
          text: JSON.stringify({ index }), materials: [{ key: "result", source: { speaker: "Mina" } }] });
        // Repository history fixtures exceed page sizes without claiming 2,105 simultaneous runtime admissions.
        f.inputs.accept({ subagentId: child, operationKey: `input-${index}`, sender: { kind: "user" },
          direction: `Correction ${index}`, materials: [], input: { kind: "message", workInputId: accepted.input!.workInputId,
            expectedRunId: runId, expectedControlVersion: f.children.get(child).controlVersion } });
      }
    });
    for (const category of ["messages", "inputs", "materials"] as const) {
      let cursor: string | null = null;
      const bodies = new Map<string, string>(); let pages = 0;
      do {
        const page = readSubagentSelfHistory(bound, { category, cursor, limit: 20 });
        expect(page.status).toBe("available");
        for (const row of page.records) {
          const previous = bodies.get(row.id) ?? "";
          expect(row.offset).toBe(previous.length);
          bodies.set(row.id, previous + row.body);
        }
        if (pages === 0 && category === "messages") f.messages.recordStep({ runId, attemptId,
          batch: { stepNumber: 2106, entryKind: "output", messages: [{ role: "assistant", content: "Later arrival" }] } });
        cursor = page.nextCursor; pages += 1;
      } while (cursor);
      expect(bodies.size).toBe(category === "materials" ? 2105 : 2106);
      expect(pages).toBeGreaterThan(100);
      for (const body of bodies.values()) expect(() => JSON.parse(body)).not.toThrow();
      expect([...bodies.values()].some((body) => body.includes("Later arrival"))).toBe(false);
    }
    const current = f.service.summary(child);
    f.service.stop({ characterId: "taki", target: { subagentId: child, workInputId: accepted.input!.workInputId,
      expectedRunId: runId, expectedControlVersion: current.controlVersion } }, "user");
    release(); await finished(f, child);
  }, 25_000);

  it.runIf(typeof globalThis.gc === "function")("reclaims completed SDK raw results across 25 pressure segments while preserving exact durable bodies", async () => {
    const references: WeakRef<object>[] = [];
    let reclaimed = 0;
    const model = scriptedModel([...Array.from({ length: 25 }, (_, index) => ({ kind: "tool" as const,
      toolCallId: `read-${index}`, toolName: "read", input: {} })),
    { kind: "tool", toolCallId: "finish", toolName: "complete_subagent", input: { text: "Research retained", materials: [] } }]);
    const f = await fresh(model, { historyBudget: () => 1200, utility: utility(), agent: { contextWindowTokens: () => 6200 },
      tools: { read: tool({ inputSchema: z.strictObject({}), execute: async () => {
        if (references.length === 24) {
          for (let pass = 0; pass < 3; pass += 1) {
            await new Promise<void>((resolve) => { setTimeout(resolve, 0); }); globalThis.gc!();
          }
          reclaimed = references.slice(0, 22).filter((reference) => reference.deref() === undefined).length;
        }
        const value = { index: references.length, exact: "Large raw result evidence. ".repeat(3000) };
        references.push(new WeakRef(value)); return value;
      }, toModelOutput: ({ output }) => ({ type: "text", value: `Completed read ${output.index}; full body retained.` }) }) } });
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["read"] }, work);
    await finished(f, accepted.conversation.subagentId);
    expect(model.doStreamCalls).toHaveLength(26);
    expect(reclaimed).toBe(22);
    const execution = f.executions.list({ subagentId: accepted.conversation.subagentId })[0]!;
    expect(execution.result).toMatchObject({ outputKind: "validated", outcome: "completed" });
    expect(f.db.prepare("SELECT count(*) AS count FROM subagent_tool_results WHERE run_id=:run").get({ run: execution.runId })?.count).toBe(26);
    expect(createSubagentContextSummaryRepo(f.db).latest(accepted.input!.workInputId)).not.toBeNull();
  }, 30_000);
});

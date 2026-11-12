import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import * as stores from "./run-message-store.ts";

type Fixture = Awaited<ReturnType<typeof subagentFixture>>;
const fixtures: Fixture[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

describe("actual SDK worker validation errors at retained-reference pressure", () => {
  it("rolls over a durable local validation error and corrects it in the same Run without executing or replaying it", async () => {
    const checkpoints: Array<{ step: number; bytes: number; safe: boolean; rolled: boolean }> = [];
    const createStore = stores.createRunMessageStore;
    vi.spyOn(stores, "createRunMessageStore").mockImplementation((input) => {
      const store = createStore(input);
      return { ...store, async checkpointSegment(checkpoint) {
        const result = await store.checkpointSegment!(checkpoint);
        checkpoints.push({ step: checkpoint.stepNumber, bytes: checkpoint.retainedBytes,
          safe: checkpoint.safeToRollover, rolled: result.kind === "context_rollover" });
        return result;
      } };
    });
    const pressure = vi.fn(async () => ({ body: "Original retained evidence. ".repeat(4000) }));
    const read = vi.fn(async ({ path }: { path: string }) => ({ ok: true, path, content: "Verified source." }));
    const model = scriptedModel([
      { kind: "tools", calls: [
        { toolCallId: "pressure-evidence", toolName: "load_evidence", input: {} },
        { toolCallId: "invalid-read", toolName: "read_file", input: { path: null } },
      ] },
      { kind: "tool", toolCallId: "corrected-read", toolName: "read_file", input: { path: "source.json" } },
      { kind: "tool", toolCallId: "finish", toolName: "complete_subagent", input: { text: "Verified the source after correcting the read arguments.", materials: [] } },
    ]);
    const f = await subagentFixture(model, { historyBudget: () => 1200, agent: { contextWindowTokens: () => 6000 },
      tools: {
        load_evidence: tool({ inputSchema: z.strictObject({}), execute: pressure,
          toModelOutput: () => ({ type: "text", value: "Full evidence is retained in private history." }) }),
        read_file: tool({ inputSchema: z.strictObject({ path: z.string() }), execute: read }),
      } });
    fixtures.push(f);
    const originalStream = model.doStream.bind(model);
    let request = 0;
    let correctionSawDurableError = false;
    model.doStream = async (options) => {
      if (request++ === 1) {
        expect(read).not.toHaveBeenCalled();
        const rows = f.db.prepare("SELECT parts_json FROM run_messages WHERE entry_kind='output' AND step_number=0 AND role='tool'").all();
        correctionSawDurableError = rows.some((row) => String(row.parts_json).includes("invalid-read")
          && String(row.parts_json).includes("error-text"));
      }
      return originalStream(options);
    };
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["load_evidence", "read_file"] }, {
      characterId: "taki", operationKey: "invalid-frontier-work", label: "Correct a read",
      initialContext: { kind: "fresh" }, direction: "Inspect the supplied source and report the verified result.",
      materials: [], completionPolicy: "record_only",
    });
    await vi.waitFor(() => expect(f.executions.list({ subagentId: accepted.conversation.subagentId })[0]?.result).toBeTruthy());
    const executions = f.executions.list({ subagentId: accepted.conversation.subagentId });
    expect(executions).toHaveLength(1);
    const execution = executions[0]!;
    expect(execution.result).toMatchObject({ outcome: "completed", outputKind: "validated" });
    expect(f.db.prepare("SELECT attempt_id FROM run_attempts WHERE run_id=:run").all({ run: execution.runId })).toHaveLength(1);
    expect(model.doStreamCalls).toHaveLength(3);
    expect(pressure).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledExactlyOnceWith({ path: "source.json" }, expect.anything());
    expect(correctionSawDurableError).toBe(true);
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("invalid-read");
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("Invalid input");
    expect(checkpoints[0]).toMatchObject({ step: 0, safe: true, rolled: true });
    expect(checkpoints[0]!.bytes).toBeGreaterThan(1200 * 16);
    const steps = f.db.prepare("SELECT step_number FROM subagent_task_steps WHERE run_id=:run ORDER BY step_number").all({ run: execution.runId });
    expect(steps.map((step) => step.step_number)).toEqual([0, 1, 2]);
    expect(f.errors).toEqual([]);
  });

  it("pauses an invalid-argument step exactly at N instead of failing the next request's check-in fence", async () => {
    const read = vi.fn(async ({ path }: { path: string }) => ({ ok: true, path }));
    const model = scriptedModel([
      { kind: "tool", toolCallId: "invalid-at-N", toolName: "read_file", input: { path: null } },
      { kind: "tool", toolCallId: "not-yet-authorized", toolName: "read_file", input: { path: "source.json" } },
    ]);
    const f = await subagentFixture(model, { tools: {
      read_file: tool({ inputSchema: z.strictObject({ path: z.string() }), execute: read }),
    } });
    fixtures.push(f);
    f.service.state.deps.checkInPolicy = () => ({ steps: 1, parentApprovals: 0 });
    // Keep the separately tested main inbox consumer idle while inspecting the child's exact boundary.
    f.queue.tryAcquireBackground("taki");
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["read_file"] }, {
      characterId: "taki", operationKey: "invalid-at-checkin", label: "Read with a check-in",
      initialContext: { kind: "fresh" }, direction: "Read the supplied source and report the verified result.",
      materials: [], completionPolicy: "record_only",
    });
    const subagentId = accepted.conversation.subagentId;
    await vi.waitFor(() => expect(f.service.summary(subagentId)).toMatchObject({ activeRunId: null, state: "needs_input" }));
    const wait = f.service.events.wait(accepted.input!.workInputId);
    expect(wait).toMatchObject({ state: "open", reason: "check_in",
      checkIn: { completedSteps: 1, intervalSteps: 1, requiredActor: "user" } });
    expect(model.doStreamCalls).toHaveLength(1);
    expect(read).not.toHaveBeenCalled();
    const execution = f.executions.list({ subagentId })[0]!;
    expect(execution.result).toMatchObject({ outcome: "completed", outputKind: "unstructured" });
    const errors = f.messages.list({ runId: execution.runId }).flatMap((row) => row.parts ?? [])
      .filter((part) => part.type === "tool-result" && part.toolCallId === "invalid-at-N");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ output: { type: "error-text" } });
    expect(f.db.prepare("SELECT completed_ordinal FROM subagent_task_steps WHERE run_id=:run").all({ run: execution.runId }))
      .toEqual([{ completed_ordinal: 1 }]);
    expect(f.errors).toEqual([]);
  });
});

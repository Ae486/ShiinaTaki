import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import type { SubagentControlResult } from "@taki/shared";
import { scriptedModel, slowStreamingModel, streamingMockModel } from "../testing/mock-language-model.ts";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import type { DelegateWork } from "./subagent-state.ts";

const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
async function fresh(...args: Parameters<typeof subagentFixture>) { const f = await subagentFixture(...args); fixtures.push(f); return f; }
const work = (changes: Partial<DelegateWork> = {}): DelegateWork => ({ characterId: "taki", operationKey: "work-a", label: "Research",
  initialContext: { kind: "fresh" }, direction: "Find the answer", materials: [], completionPolicy: "record_only", lifetimeMinutes: 30, ...changes });
function target(result: SubagentControlResult) {
  return { subagentId: result.conversation.subagentId, workInputId: result.input!.workInputId,
    expectedControlVersion: result.conversation.controlVersion, ...(result.conversation.activeRunId ? { expectedRunId: result.conversation.activeRunId } : {}) };
}
async function finish(f: Awaited<ReturnType<typeof fresh>>, accepted: SubagentControlResult) {
  await vi.waitFor(() => {
    const rows = f.executions.list({ subagentId: accepted.conversation.subagentId, workInputId: accepted.input!.workInputId });
    expect(rows.length).toBeGreaterThan(0); expect(rows.every((row) => row.result)).toBe(true);
  });
  return f.executions.list({ subagentId: accepted.conversation.subagentId, workInputId: accepted.input!.workInputId });
}

describe("shared child execution", () => {
  it("executes a record-only collector through SDK and retains private native evidence without primary history or Memory callbacks", async () => {
    const model = scriptedModel([{ kind: "tool", toolCallId: "result-call", toolName: "complete_subagent", input: { text: "Useful retained answer", materials: [] } }]);
    const witness = vi.fn(); const maintenance = vi.fn();
    const f = await fresh(model, { agent: { onPrimaryCommitted: witness, onUsage: maintenance } });
    f.conversation.appendUser("taki", "UNRELATED_PARENT_HISTORY");
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, work());
    const rows = await finish(f, accepted);
    expect(rows[0]?.result).toMatchObject({ body: "Useful retained answer", outputKind: "validated", outcome: "completed" });
    expect(rows[0]?.completionState).toBe("not_requested");
    expect(model.doStreamCalls).toHaveLength(1);
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).not.toContain("UNRELATED_PARENT_HISTORY");
    expect(f.inputs.get(accepted.input!.inputId).consumed).not.toBeNull();
    expect(f.messages.history({ subagentId: accepted.conversation.subagentId }).map((row) => row.role)).toEqual(["user", "assistant", "tool"]);
    expect(f.conversation.history("taki")).toHaveLength(1);
    expect(witness).not.toHaveBeenCalled(); expect(maintenance).not.toHaveBeenCalled(); expect(f.errors).toEqual([]);
  });

  it("preserves explicit empty executable selection and never falls back to memory mutations", async () => {
    const mutate = vi.fn(async () => ({ ok: true }));
    const model = streamingMockModel(["No tools were executed"]);
    const f = await fresh(model, { memoryTools: { memory_write: tool({ inputSchema: z.object({}), execute: mutate }) } });
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["memory_write"] },
      work({ toolSelection: { mode: "allow", names: [] } }));
    await finish(f, accepted);
    expect(model.doStreamCalls[0]?.tools ?? []).toEqual([]); expect(mutate).not.toHaveBeenCalled();
    expect(f.errors).toEqual([]);
  });

  it("consumes addressed input at the next actual model intent and keeps its complete materials in replay", async () => {
    let release!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; });
    const read = vi.fn(async () => { await blocked; return { ok: true, text: "read" }; });
    const model = scriptedModel([{ kind: "tool", toolCallId: "read", toolName: "probe", input: {} },
      { kind: "text", deltas: ["Corrected result"] }]);
    const f = await fresh(model, { tools: { probe: tool({ inputSchema: z.object({}), execute: read }) } });
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["probe"] }, work());
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    const current = f.service.summary(accepted.conversation.subagentId);
    const sent = f.service.send({ characterId: "taki", target: { ...target(accepted), expectedControlVersion: current.controlVersion, expectedRunId: current.activeRunId! },
      operationKey: "correction", direction: "Use the corrected speaker", materials: [{ key: "quote", text: "PRIVATE_MATERIAL", source: { speaker: "Video speaker" } }] }, { kind: "user" });
    expect(sent.input?.consumed).toBeNull(); release(); await finish(f, accepted);
    expect(f.inputs.get(sent.input!.inputId).consumed).not.toBeNull();
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("PRIVATE_MATERIAL");
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt).match(/Use the corrected speaker/g)).toHaveLength(1);
    expect(f.executions.list({ subagentId: current.subagentId })[0]?.throughWorkSeq).toBe(2);
    expect(f.errors).toEqual([]);
  });

  it("parent cancellation leaves parallel child controllers alive; child stop latches until user continuation", async () => {
    const model = slowStreamingModel(["one", "two"], 40);
    const f = await fresh(model);
    const parentController = f.turns.begin("taki", undefined, f.parent.run.runId);
    const a = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, work());
    const b = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, work({ operationKey: "work-b", label: "Second" }));
    await vi.waitFor(() => expect(model.doStreamCalls).toHaveLength(2));
    f.runs.requestCancel(f.parent.run.runId); f.turns.cancel("taki");
    expect(parentController.signal.aborted).toBe(true);
    expect([...f.service.state.active.values()].every((entry) => !entry.controller.signal.aborted)).toBe(true);
    const current = f.service.summary(a.conversation.subagentId);
    f.service.stop({ characterId: "taki", target: { ...target(a), expectedRunId: current.activeRunId!, expectedControlVersion: current.controlVersion } }, "user");
    await finish(f, a); await finish(f, b);
    const stopped = f.service.summary(a.conversation.subagentId);
    const addressed = { characterId: "taki", target: { ...target(a), expectedControlVersion: stopped.controlVersion },
      operationKey: "continue-a", direction: "Continue", materials: [] };
    expect(() => f.service.continue(addressed, { kind: "parent", runId: f.parent.run.runId })).toThrow("USER_CONTINUE_REQUIRED");
    f.service.continue(addressed, { kind: "user" });
    await vi.waitFor(() => expect(model.doStreamCalls).toHaveLength(3));
    await finish(f, a);
    expect(f.executions.list({ subagentId: a.conversation.subagentId })).toHaveLength(2);
    expect(f.children.get(a.conversation.subagentId).stopOrigin).toBeNull();
    f.turns.end("taki", parentController);
  });
});

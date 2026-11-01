import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createSubagentExecutionRepo } from "../db/subagent-execution-repo.ts";
import { createSubagentTerminalChoice } from "./subagent-interact-tool.ts";
import { createSubagentResultCollector } from "./subagent-result-tool.ts";
import type { TurnMessage } from "./turn-mapping.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  const executions = createSubagentExecutionRepo(db);
  const recordProposal = vi.spyOn(executions, "recordProposal").mockImplementation(() => undefined);
  const resolve = vi.fn(() => [{ label: "Workspace file", reference: "evidence.txt" }]);
  const terminal = createSubagentTerminalChoice();
  const current = vi.fn(() => true);
  const canCommit = vi.fn(() => true);
  const collector = createSubagentResultCollector({ runId: "run", attemptId: () => "attempt", current, canCommit,
    token: () => ({ subagentId: "child", workInputId: "work", throughWorkSeq: 1, controlVersion: 1 }),
    executions, materials: { resolve, select: () => [] }, terminal });
  const invoke = (callId: string, text = "report") => collector.tools.complete_subagent!.execute!(
    { text, materials: [] }, { toolCallId: callId, messages: [], context: {} });
  const commit = (callId: string) => collector.commit({ attemptId: "attempt", messages: [{ role: "tool", content: [{
    type: "tool-result", toolName: "complete_subagent", toolCallId: callId,
    output: { type: "json", value: { ok: true, proposed: true, accepted: false } },
  }] }] satisfies TurnMessage[] });
  return { collector, resolve, terminal, recordProposal, current, canCommit, invoke, commit };
}

describe("subagent final collector material refusals", () => {
  it.each(["SUBAGENT_MATERIAL_NOT_FOUND", "SUBAGENT_MATERIAL_SCOPE_MISMATCH", "SUBAGENT_MATERIAL_STALE",
    "SUBAGENT_MATERIAL_LIMIT", "SUBAGENT_INPUT_NOT_FOUND", "SUBAGENT_EXECUTION_NOT_FOUND", "SUBAGENT_NOT_FOUND"])(
    "returns an actionable %s without consuming the final slot", (code) => {
      const f = fixture();
      f.resolve.mockImplementationOnce(() => { throw new Error(code); });
      expect(f.invoke("bad")).toMatchObject({ ok: false, code, state: "not_proposed",
        nextAction: expect.stringContaining("materialReferences") });
      f.commit("bad"); expect(f.recordProposal).not.toHaveBeenCalled();
      expect(f.invoke("corrected")).toMatchObject({ ok: true, proposed: true });
      f.commit("corrected");
      expect(f.recordProposal).toHaveBeenCalledOnce();
      expect(f.recordProposal.mock.calls[0]?.[0].proposal.sourceContext?.materials)
        .toEqual([{ label: "Workspace file", reference: "evidence.txt" }]);
    });

  it("lets a needs-input choice follow refused material without losing an existing accepted choice", () => {
    const f = fixture();
    f.resolve.mockImplementationOnce(() => { throw new Error("SUBAGENT_MATERIAL_NOT_FOUND"); });
    expect(f.invoke("bad")).toMatchObject({ ok: false });
    expect(f.terminal.reserve("attempt", "question", "needs_input")).toBe(true);
    expect(f.invoke("later-final")).toMatchObject({ ok: false, code: "SUBAGENT_TERMINAL_CHOICE_CONFLICT" });
    expect(f.recordProposal).not.toHaveBeenCalled();
  });

  it("propagates unknown storage failure before reserving or creating a proposal", () => {
    const f = fixture(); const failure = new Error("SQLITE_IOERR");
    f.resolve.mockImplementationOnce(() => { throw failure; });
    expect(() => f.invoke("storage-failed")).toThrow(failure);
    expect(f.terminal.reserve("attempt", "question", "needs_input")).toBe(true);
    expect(f.recordProposal).not.toHaveBeenCalled();
  });

  it("preserves the first accepted final and refuses competing completion or input wait", () => {
    const f = fixture();
    expect(f.invoke("first", "original")).toMatchObject({ proposed: true });
    f.resolve.mockImplementationOnce(() => { throw new Error("SUBAGENT_MATERIAL_NOT_FOUND"); });
    expect(f.invoke("invalid-later")).toMatchObject({ ok: false, code: "SUBAGENT_MATERIAL_NOT_FOUND" });
    expect(f.invoke("second", "replacement")).toMatchObject({ ok: false });
    expect(f.invoke("first", "replacement")).toMatchObject({ ok: false, code: "SUBAGENT_RESULT_CONFLICT" });
    expect(f.terminal.reserve("attempt", "question", "needs_input")).toBe(false);
    f.commit("first");
    expect(f.recordProposal.mock.calls[0]?.[0].proposal.text).toBe("original");
  });

  it("preserves currentness and releases a stale uncommitted choice", () => {
    const f = fixture(); f.current.mockReturnValueOnce(false);
    expect(f.invoke("stale")).toMatchObject({ ok: false, code: "SUBAGENT_RESULT_STALE" });
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.invoke("accepted")).toMatchObject({ proposed: true });
    f.canCommit.mockReturnValueOnce(false); f.commit("accepted");
    expect(f.recordProposal).not.toHaveBeenCalled();
    expect(f.terminal.reserve("attempt", "question", "needs_input")).toBe(true);
  });
});

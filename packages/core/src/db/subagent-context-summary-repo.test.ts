import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createSubagentContextSummaryRepo } from "./subagent-context-summary-repo.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const model = scriptedModel([
    { kind: "tool", toolCallId: "read", toolName: "read", input: {} },
    { kind: "tool", toolCallId: "hold", toolName: "read", input: {} },
    { kind: "text", deltas: ["Done"] },
  ]);
  const f = await subagentFixture(model, { tools: { read: tool({ inputSchema: z.object({}), execute: async () => {
    calls += 1;
    if (calls === 2) await held;
    return { evidence: "The user did not perform this action; the external source did." };
  } }) } });
  cleanups.push(async () => { release(); await f.close(); });
  const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["read"] }, {
    characterId: "taki", operationKey: "summary", label: "Worker", direction: "Preserve attribution", materials: [],
    initialContext: { kind: "fresh" }, completionPolicy: "record_only",
  });
  await vi.waitFor(() => expect(calls).toBe(2));
  const subagentId = accepted.conversation.subagentId;
  const workInputId = accepted.input!.inputId;
  const runId = f.service.summary(subagentId).activeRunId!;
  const attemptId = f.runs.status(runId).run.activeAttemptId!;
  const repo = createSubagentContextSummaryRepo(f.db);
  const throughSeq = f.messages.history({ subagentId }).filter((row) => row.entryKind === "output" && row.stepNumber === 0).at(-1)!.seq;
  const owner = { runId, attemptId, token: f.executions.token(runId), validateCurrent() {} };
  const previous = repo.commit({ ...owner, range: repo.capture({ subagentId, workInputId, throughSeq }),
    text: "The user did not perform this action. External evidence remains attributed; the task is unfinished." });
  return { ...f, repo, previous, owner, identity: { subagentId, workInputId }, release };
}

describe("same-coverage private summary revisions", () => {
  it("appends a rewrite of the exact previous summary without advancing raw coverage, receipts or task steps", async () => {
    const f = await fixture();
    const before = {
      messages: f.db.prepare("SELECT * FROM run_messages ORDER BY seq").all(),
      inputs: f.db.prepare("SELECT * FROM subagent_inputs ORDER BY input_seq").all(),
      steps: f.db.prepare("SELECT * FROM subagent_task_steps ORDER BY step_number").all(),
    };
    expect(() => f.repo.capture({ ...f.identity, throughSeq: f.previous.throughSeq })).toThrow("SUBAGENT_SUMMARY_EMPTY_RANGE");
    const range = f.repo.captureRewrite(f.identity);
    expect(range).toMatchObject({ kind: "rewrite", expectedRevision: 1, sourceFromSeq: f.previous.throughSeq + 1,
      throughSeq: f.previous.throughSeq, previous: { revision: 1, text: f.previous.text, sourceDigest: f.previous.sourceDigest } });
    expect(() => f.repo.commit({ ...f.owner, range: { ...range, kind: "advance" }, text: "Invalid empty advance" }))
      .toThrow("SUBAGENT_SUMMARY_EMPTY_RANGE");
    const rewritten = f.repo.commit({ ...f.owner, range, text: "External action, not the user's. Continue the unfinished task." });
    expect(rewritten).toMatchObject({ revision: 2, throughSeq: f.previous.throughSeq, sourceFromSeq: f.previous.throughSeq + 1 });
    expect(rewritten.sourceDigest).not.toBe(f.previous.sourceDigest);
    expect(rewritten).not.toHaveProperty("kind");
    expect(rewritten).not.toHaveProperty("previous");
    expect(f.db.prepare("SELECT * FROM run_messages ORDER BY seq").all()).toEqual(before.messages);
    expect(f.db.prepare("SELECT * FROM subagent_inputs ORDER BY input_seq").all()).toEqual(before.inputs);
    expect(f.db.prepare("SELECT * FROM subagent_task_steps ORDER BY step_number").all()).toEqual(before.steps);
    expect(f.db.prepare("SELECT summary_text,source_digest,through_seq FROM subagent_context_summaries WHERE revision=1").get())
      .toEqual({ summary_text: f.previous.text, source_digest: f.previous.sourceDigest, through_seq: f.previous.throughSeq });
    expect(() => f.repo.commit({ ...f.owner, range, text: "Stale second rewrite" })).toThrow("SUBAGENT_SUMMARY_CONFLICT");
    expect(f.repo.latest(f.identity.workInputId)).toEqual(rewritten);
  });

  it.each(["text", "sourceDigest", "revision", "throughSeq"] as const)("refuses changed previous %s without replacing the old revision", async (field) => {
    const f = await fixture();
    const range = f.repo.captureRewrite(f.identity);
    if (range.kind !== "rewrite") throw new Error("Expected rewrite capture");
    const previous = { ...range.previous, [field]: typeof range.previous[field] === "number" ? 999 : "changed" };
    expect(() => f.repo.commit({ ...f.owner, range: { ...range, previous }, text: "Changed source" })).toThrow("SUBAGENT_SUMMARY_SOURCE_STALE");
    expect(f.repo.latest(f.identity.workInputId)).toEqual(f.previous);
  });

  it("refuses wrong child and changed coverage and preserves the original failure identity", async () => {
    const f = await fixture();
    expect(() => f.repo.captureRewrite({ ...f.identity, subagentId: randomUUID() })).toThrow("SUBAGENT_SUMMARY_SOURCE_STALE");
    const range = f.repo.captureRewrite(f.identity);
    expect(() => f.repo.commit({ ...f.owner, range: { ...range, throughSeq: range.throughSeq + 1 }, text: "No raw advance" }))
      .toThrow("SUBAGENT_SUMMARY_SOURCE_STALE");
    f.repo.recordFailure(range, "SUBAGENT_SUMMARY_FAILED");
    expect(f.repo.failed(f.repo.captureRewrite(f.identity))).toBe(true);
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_context_summary_failures").get()?.n).toBe(1);
    expect(f.repo.latest(f.identity.workInputId)).toEqual(f.previous);
  });

  it("rolls back SQL failure and keeps user Stop authoritative for an already captured rewrite", async () => {
    const f = await fixture();
    const range = f.repo.captureRewrite(f.identity);
    const candidate = { ...f.owner, range, text: "Concise corrected summary" };
    f.db.exec("CREATE TEMP TRIGGER fail_rewrite BEFORE INSERT ON subagent_context_summaries WHEN NEW.revision=2 BEGIN SELECT RAISE(ABORT,'rewrite rejected'); END");
    expect(() => f.repo.commit(candidate)).toThrow("rewrite rejected");
    expect(f.repo.latest(f.identity.workInputId)).toEqual(f.previous);
    f.db.exec("DROP TRIGGER fail_rewrite");
    f.service.stop({ characterId: "taki", target: { ...f.identity, expectedRunId: f.owner.runId,
      expectedControlVersion: f.owner.token.controlVersion } }, "user");
    expect(() => f.repo.commit(candidate)).toThrow("SUBAGENT_SUMMARY_OWNER_STALE");
    expect(f.repo.latest(f.identity.workInputId)).toEqual(f.previous);
  });
});

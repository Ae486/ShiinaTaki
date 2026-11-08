import { afterEach, describe, expect, it, vi } from "vitest";
import { scriptedGenerateModel } from "../../testing/mock-language-model.ts";
import { curatorTestFixture, curatorTestBank, curatorTestAssessDriver, curatorTestPolicy, curatorTestReport, curatorTestRemotePolicy,
  curatorTestTool, curatorTestAssessment } from "./hindsight-policy-curator-fixtures.ts";
import { runHindsightPolicyCuratorModel } from "./hindsight-policy-curator-model.ts";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.useRealTimers(); vi.restoreAllMocks(); });
function fixture(input: Parameters<typeof curatorTestFixture>[0] = {}) {
  const value = curatorTestFixture(input); cleanup.push(value.close); return value;
}
function deferred() {
  let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve };
}
function tick() { return new Promise<void>((resolve) => setImmediate(resolve)); }

describe("policy curator cancellation and repeated input admission", () => {
  it("stops an abort-ignoring model and its queued pass before SQLite closes, refusing every late tool callback", async () => {
    const entered = deferred(); const release = deferred(); const late: unknown[] = [];
    const f = fixture({ driver: async (input) => {
      const row = curatorTestReport(input).policies[0]!; entered.resolve(); await release.promise;
      late.push(await curatorTestTool(input, "memory_policy_assess", curatorTestAssessment(row.policy, row.workId)));
      input.onStepEnd(); return { steps: 1, usage: { inputTokens: 10, outputTokens: 4 } };
    } });
    const prepare = vi.spyOn(f.db, "prepare"); const save = vi.spyOn(f.work, "saveResult");
    const first = f.curator.runNow("taki"); const queued = f.curator.runNow("taki");
    const results = Promise.allSettled([first, queued]); await entered.promise; await f.curator.stop();
    expect(await results).toMatchObject([
      { status: "fulfilled", value: { status: "failed", assessed: 0, edits: 0 } },
      { status: "rejected", reason: { message: "MEMORY_OPERATION_CANCELLED" } },
    ]);
    expect(f.db.prepare("SELECT state,prompt_version FROM hindsight_policy_work WHERE work_kind='policy'").get())
      .toMatchObject({ state: "claimed", prompt_version: "taki-hindsight-policy-curator/v1" });
    expect(f.banks[0]!.server.calls).toHaveLength(0); await f.close(); const reads = prepare.mock.calls.length;
    release.resolve(); await tick(); await tick();
    expect(late).toEqual([{ ok: false, code: "MEMORY_OPERATION_CANCELLED", message: "The policy proposal was not accepted." }]);
    expect(prepare).toHaveBeenCalledTimes(reads); expect(save).not.toHaveBeenCalled();
    await expect(f.curator.runNow("taki")).rejects.toThrow("MEMORY_OPERATION_CANCELLED"); expect(prepare).toHaveBeenCalledTimes(reads);
  });

  it("stops work waiting behind another Utility Slot job without later admitting a model or touching SQLite", async () => {
    const release = deferred(); const entered = deferred(); const driver = vi.fn(curatorTestAssessDriver);
    const f = fixture({ driver }); const held = f.slot.run("fixture-owned-hold", async () => { entered.resolve(); await release.promise; });
    await entered.promise; const running = f.curator.runNow("taki"); await tick();
    expect(f.db.prepare("SELECT state,prompt_version FROM hindsight_policy_work WHERE work_kind='policy'").get())
      .toMatchObject({ state: "claimed", prompt_version: null });
    await f.curator.stop(); expect(await running).toMatchObject({ status: "failed", assessed: 0 });
    const prepare = vi.spyOn(f.db, "prepare"); await f.close(); release.resolve(); await held; await tick(); await tick();
    expect(driver).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });

  it("rechecks policy after waiting for the Utility Slot and withholds a record hidden while queued", async () => {
    const release = deferred(); const entered = deferred();
    const model = scriptedGenerateModel([{ kind: "tool", toolCallId: "finish", toolName: "policy_review_finish", input: {} }]);
    const f = fixture({ model }); const held = f.slot.run("fixture-owned-hold", async () => { entered.resolve(); await release.promise; });
    await entered.promise; const running = f.curator.runNow("taki"); await tick();
    curatorTestRemotePolicy(f.banks[0]!, "memory-a", (body) => ({ ...body, policy: { ...body.policy, visibility: "hidden", policyVersion: 2 } }));
    await f.deps.refreshBank("bank-a", { timeoutMs: 10_000 }); release.resolve(); await held;
    expect(await running).toMatchObject({ status: "failed", assessed: 0, edits: 0 });
    expect(model.doGenerateCalls).toHaveLength(0); expect(f.banks[0]!.server.calls).toHaveLength(0);
    expect(curatorTestPolicy(f)).toMatchObject({ policy: { visibility: "hidden" }, assessment: { state: "due" } });
    expect(f.db.prepare("SELECT state,prompt_version FROM hindsight_policy_work WHERE work_kind='policy'").get())
      .toMatchObject({ state: "superseded", prompt_version: null });
  });

  it("rechecks before the next real AI SDK submission after a policy restriction changes during the first request", async () => {
    const model = scriptedGenerateModel([
      { kind: "tool", toolCallId: "read", toolName: "block_read", input: { id: "user-card" } },
      { kind: "tool", toolCallId: "finish", toolName: "policy_review_finish", input: {} },
    ]);
    const f = fixture({ model }); const generate = model.doGenerate;
    vi.spyOn(model, "doGenerate").mockImplementation(async (input) => {
      const result = await generate(input);
      curatorTestRemotePolicy(f.banks[0]!, "memory-a", (body) => ({ ...body, policy: { ...body.policy, visibility: "hidden", policyVersion: body.policy.policyVersion + 1 } }));
      await f.deps.refreshBank("bank-a", { timeoutMs: 10_000 }); return result;
    });
    expect(await f.curator.runNow("taki")).toMatchObject({ status: "failed", assessed: 0, edits: 0 });
    expect(model.doGenerateCalls).toHaveLength(1); expect(f.banks[0]!.server.calls).toHaveLength(0);
    expect(curatorTestPolicy(f).policy.visibility).toBe("hidden");
  });

  it("settles an ordinary in-flight review without cancelling it", async () => {
    const entered = deferred(); const release = deferred();
    const f = fixture({ driver: async (input) => { entered.resolve(); await release.promise; return curatorTestAssessDriver(input); } });
    const running = f.curator.runNow("taki"); await entered.promise; let settled = false;
    const drain = f.curator.settle().then(() => { settled = true; }); await tick(); expect(settled).toBe(false);
    release.resolve(); await drain; expect(await running).toMatchObject({ status: "ran", assessed: 1 }); expect(settled).toBe(true);
  });

  it("allows an unchanged record's proposal but refuses the stale record and the next model submission", async () => {
    const bank = curatorTestBank({ memories: [{ id: "memory-a" }, { id: "memory-b" }] });
    const results: unknown[] = []; let nextStepError: unknown;
    const f = fixture({ banks: [bank], driver: async (input) => {
      input.assertInput(); const report = curatorTestReport(input);
      curatorTestRemotePolicy(bank, "memory-b", (body) => ({ ...body,
        policy: { ...body.policy, visibility: "hidden", policyVersion: body.policy.policyVersion + 1 } }));
      await f.deps.refreshBank("bank-a", { timeoutMs: 10_000 });
      for (const id of ["memory-a", "memory-b"]) {
        const row = report.policies.find((value) => value.nativeId === id)!;
        results.push(await curatorTestTool(input, "memory_policy_assess", curatorTestAssessment(row.policy, row.workId)));
      }
      try { input.assertInput(); } catch (error) { nextStepError = error; }
      await curatorTestTool(input, "policy_review_finish"); input.onStepEnd();
      return { steps: 1, usage: { inputTokens: 11, outputTokens: 7 } };
    } });
    expect(await f.curator.runNow("taki")).toMatchObject({ status: "failed", assessed: 1, edits: 1 });
    expect(results).toMatchObject([{ ok: true, status: "proposal_saved" },
      { ok: false, code: "MEMORY_REVISION_MISMATCH", message: "The policy proposal was not accepted." }]);
    expect(nextStepError).toMatchObject({ message: "MEMORY_REVISION_MISMATCH" });
    expect(curatorTestPolicy(f, bank, "memory-a").assessment.state).toBe("assessed");
    expect(curatorTestPolicy(f, bank, "memory-b")).toMatchObject({ policy: { visibility: "hidden" }, assessment: { state: "due" } });
  });

  it("returns the captured Block but prevents its stale tool output reaching the next real AI SDK submission", async () => {
    const model = scriptedGenerateModel([
      { kind: "tool", toolCallId: "read", toolName: "block_read", input: { id: "user-card" } },
      { kind: "tool", toolCallId: "finish", toolName: "policy_review_finish", input: {} },
    ]);
    const results: unknown[] = [];
    const f = fixture({ model, driver: (input) => {
      const read = input.tools.block_read!.execute!;
      vi.spyOn(input.tools.block_read!, "execute").mockImplementation(async (...args) => {
        const result = await read(...args); results.push(result); return result;
      });
      return runHindsightPolicyCuratorModel(input);
    } });
    const scope = f.banks[0]!.bankScope;
    f.blocks.replace({ blockId: "user-card", scope, content: "Captured card", actor: "user", now: f.clock.at });
    const generate = model.doGenerate;
    vi.spyOn(model, "doGenerate").mockImplementationOnce(async (input) => {
      const result = await generate(input);
      f.blocks.replace({ blockId: "user-card", scope, content: "Changed card", actor: "user", now: f.clock.at });
      return result;
    });
    expect(await f.curator.runNow("taki")).toMatchObject({ status: "failed", assessed: 0, edits: 0 });
    expect(results).toMatchObject([{ ok: true, readOnly: true, value: { content: "Captured card", block_revision: 1 } }]);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(f.blocks.read("user-card", scope)?.content).toBe("Changed card");
    expect(curatorTestPolicy(f).assessment.state).toBe("failed");
  });

  it.each(["block", "source"] as const)("refuses Block update when its %s changes before the tool saves", async (changed) => {
    let result: unknown;
    const f = fixture({ driver: async (input) => {
      input.assertInput(); const bank = f.banks[0]!;
      if (changed === "block") {
        f.blocks.replace({ blockId: "user-model", scope: bank.bankScope, content: "Newer Block", actor: "background", now: f.clock.at });
      } else {
        curatorTestRemotePolicy(bank, "memory-a", (body) => ({ ...body,
          policy: { ...body.policy, visibility: "hidden", policyVersion: body.policy.policyVersion + 1 } }));
        await f.deps.refreshBank("bank-a", { timeoutMs: 10_000 });
      }
      result = await curatorTestTool(input, "block_update", { id: "user-model", content: "Stale proposal" });
      input.onStepEnd(); return { steps: 1, usage: { inputTokens: 11, outputTokens: 7 } };
    } });
    const save = vi.spyOn(f.work, "saveResult");
    expect(await f.curator.runNow("taki")).toMatchObject({ status: "failed", blocks: 0, edits: 0 });
    expect(result).toEqual({ ok: false, code: "MEMORY_REVISION_MISMATCH", message: "The policy proposal was not accepted." });
    expect(save.mock.calls.filter(([request]) => request.result.kind === "block-update")).toHaveLength(0);
    expect(f.blocks.read("user-model", f.banks[0]!.bankScope)?.content).toBe(changed === "block" ? "Newer Block" : undefined);
  });

  it.each(["assessment", "block-update", "block-unchanged"] as const)("refuses a saved %s at publication after its input is hidden", async (kind) => {
    let proposal: unknown;
    const f = fixture({ driver: async (input) => {
      input.assertInput(); const row = curatorTestReport(input).policies[0]!;
      if (kind === "assessment") proposal = await curatorTestTool(input, "memory_policy_assess", curatorTestAssessment(row.policy, row.workId));
      if (kind === "block-update") proposal = await curatorTestTool(input, "block_update", { id: "user-model", content: "Supported before restriction" });
      const finish = await curatorTestTool(input, "policy_review_finish");
      if (kind === "block-unchanged") proposal = finish;
      curatorTestRemotePolicy(f.banks[0]!, "memory-a", (body) => ({ ...body,
        policy: { ...body.policy, visibility: "hidden", policyVersion: body.policy.policyVersion + 1 } }));
      await f.deps.refreshBank("bank-a", { timeoutMs: 10_000 });
      input.onStepEnd(); return { steps: 1, usage: { inputTokens: 11, outputTokens: 7 } };
    } });
    const save = vi.spyOn(f.work, "saveResult");
    expect(await f.curator.runNow("taki")).toMatchObject({ status: "failed", assessed: 0, blocks: 0, edits: 0 });
    expect(proposal).toMatchObject({ ok: true });
    expect(save.mock.calls.filter(([request]) => request.result.kind === kind)).toHaveLength(1);
    expect(f.banks[0]!.server.calls).toHaveLength(0);
    expect(f.blocks.read("user-model", f.banks[0]!.bankScope)).toBeUndefined();
    expect(curatorTestPolicy(f)).toMatchObject({ policy: { visibility: "hidden" }, assessment: { state: "due" } });
    expect(f.db.prepare("SELECT state FROM hindsight_policy_work WHERE work_kind=:kind")
      .get({ kind: kind === "assessment" ? "policy" : "block" })?.state).toBe("superseded");
  });

  it.each(["finished", "closed"] as const)("refuses every tool callback after the review is %s without accessing SQLite", async (boundary) => {
    let captured: Parameters<typeof curatorTestAssessDriver>[0] | undefined;
    const results: unknown[] = [];
    const invokeLateTools = async (input: Parameters<typeof curatorTestAssessDriver>[0]) => {
      const row = curatorTestReport(input).policies[0]!;
      results.push(await curatorTestTool(input, "memory_policy_assess", curatorTestAssessment(row.policy, row.workId)));
      results.push(await curatorTestTool(input, "block_update", { id: "user-model", content: "Late proposal" }));
      results.push(await curatorTestTool(input, "block_read", { id: "user-card" }));
      results.push(await curatorTestTool(input, "policy_review_finish"));
    };
    let readsAfterCallbacks = -1;
    const f = fixture({ driver: async (input) => {
      captured = input; await curatorTestTool(input, "policy_review_finish");
      if (boundary === "finished") {
        prepare.mockClear(); await invokeLateTools(input); readsAfterCallbacks = prepare.mock.calls.length;
      }
      input.onStepEnd(); return { steps: 1, usage: { inputTokens: 11, outputTokens: 7 } };
    } });
    const prepare = vi.spyOn(f.db, "prepare");
    await f.curator.runNow("taki"); expect(captured).toBeDefined();
    if (boundary === "closed") {
      prepare.mockClear(); await invokeLateTools(captured!); readsAfterCallbacks = prepare.mock.calls.length;
    }
    expect(results).toEqual(Array.from({ length: 4 }, () => ({ ok: false, code: "MEMORY_OPERATION_CANCELLED",
      message: "The policy proposal was not accepted." })));
    expect(readsAfterCallbacks).toBe(0);
  });

  it("bounds the whole pass and leaves a retryable admitted attempt after an abort-ignoring model timeout", async () => {
    const entered = deferred(); const release = deferred(); const late: unknown[] = [];
    const f = fixture({ driver: async (input) => {
      const row = curatorTestReport(input).policies[0]!; entered.resolve(); await release.promise;
      late.push(await curatorTestTool(input, "memory_policy_assess", curatorTestAssessment(row.policy, row.workId)));
      return { steps: 1, usage: { inputTokens: 1, outputTokens: 1 } };
    } });
    f.config.policy.timeoutMs = 100; vi.useFakeTimers(); const running = f.curator.runNow("taki"); await entered.promise;
    await vi.advanceTimersByTimeAsync(100); expect(await running).toMatchObject({ status: "failed", assessed: 0, edits: 0 });
    const rows = f.db.prepare("SELECT state,last_failure,next_attempt_at FROM hindsight_policy_work WHERE work_kind='policy'").all();
    expect(rows).toMatchObject([{ state: "ready", last_failure: "model_failed", next_attempt_at: "2026-09-11T08:01:00.000Z" }]);
    expect(f.banks[0]!.server.calls).toHaveLength(0); release.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(late).toMatchObject([{ ok: false, code: "MEMORY_OPERATION_CANCELLED" }]);
    expect(f.db.prepare("SELECT state,last_failure,next_attempt_at FROM hindsight_policy_work WHERE work_kind='policy'").all()).toEqual(rows);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { failingGenerateModel, scriptedGenerateModel } from "../../testing/mock-language-model.ts";
import { hindsightRuntimeFixture, type HindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { memoryChatTurn } from "../../testing/memory-chat-turn-fixture.ts";
import type { CapturedMemoryRun } from "../canonical-memory-run.ts";
import { EPISODIC_EVERY_N } from "../auto-memory.ts";
import { hindsightBankBindings } from "./hindsight-bank-identity.ts";
import { MEMORY_UNAVAILABLE_SYSTEM_PROMPT } from "./hindsight-unavailable-run.ts";
import { writeNativeFixture } from "./hindsight-memory-write-native-fixtures.ts";
import { writeTestRetain } from "./hindsight-memory-write-fixtures.ts";
import { createHindsightMemoryWriteRepo } from "../../db/hindsight-memory-write-repo.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); vi.useRealTimers(); });
function fixture(input: Parameters<typeof hindsightRuntimeFixture>[0] = {}) { const f = hindsightRuntimeFixture(input); cleanup.push(f.close); return f; }
function expectUnavailable(run: CapturedMemoryRun) {
  expect(run.snapshot).toMatchObject({ providerId: "hindsight", authorityEpochId: "epoch", capabilities: { recall: false, retain: false } });
  expect(run.tools).toEqual({}); expect(run.automaticRecall).toBeUndefined(); expect(run.prompt).toBe(MEMORY_UNAVAILABLE_SYSTEM_PROMPT);
}
const logCode = (entry: HindsightRuntimeFixture["logs"][number]) => (entry.obj as { code?: string } | undefined)?.code;
function degradedCodes(f: HindsightRuntimeFixture) {
  return f.logs.filter((entry) => entry.msg === "Hindsight Run admitted without memory").map(logCode);
}

describe("Hindsight subsystem scheduled recovery", () => {
  it("settles a foreground Pending write from the real scheduler timer after its provider owner has finished", async () => {
    // Keep native timers: a fake callback queue loses the AsyncLocalStorage context inherited at registration.
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = fixture(); const subsystem = f.subsystem(); const { state, scheduler } = subsystem;
    const bank = f.banks[0]!; const native = writeNativeFixture(bank, state.pending); let ready = false;
    Object.assign(f.remote.client, native.client);
    f.remote.client.trackedNativeWrite = async (input) => {
      const response = await native.client.trackedNativeWrite(input);
      if ("error" in response) throw new Error("fixture Native dispatch failed");
      return { ...response, status: "processing", result: null };
    };
    f.remote.client.nativeResult = async (input) => {
      const response = await native.client.nativeResult(input);
      return ready ? response : { ...response, status: "processing", result: null };
    };
    subsystem.start(); await scheduler.tick();
    const requestRetry = scheduler.requestRetry.bind(scheduler);
    // Shorten only the observation wait; the persisted Pending row retains its real retry eligibility.
    vi.spyOn(scheduler, "requestRetry").mockImplementation((bankId) => requestRetry(bankId, new Date().toISOString()));
    const failures: string[] = []; const run = state.service.runner.run;
    const scheduled = vi.spyOn(state.service.runner, "run").mockImplementation(async (input) => {
      try { return await run(input); }
      catch (error) { failures.push(error instanceof Error ? error.message : String(error)); throw error; }
    });
    const call = { requestId: "scheduled-original", authorityEpochId: "epoch", actor: "foreground-agent" as const };
    const result = await state.provider.retain(call, writeTestRetain(bank.scope.bankId));
    expect(result).toMatchObject({ ok: true, data: { status: "pending" } });
    const key = { authorityEpochId: "epoch", bankId: bank.scope.bankId };
    const journal = createHindsightMemoryWriteRepo({ db: f.db, assertActive: state.assertActive });
    const parent = journal.get({ ...key, requestId: call.requestId })!;
    const original = state.pending.list({ authorityEpochId: "epoch", bankId: bank.scope.bankId })[0]!;
    expect(original.phase).toBe("submitted"); const callsBefore = f.remote.calls.length;
    ready = true; vi.setSystemTime(new Date(original.nextRetryAt!));
    await vi.waitFor(() => expect(scheduled).toHaveBeenCalledTimes(1), { timeout: 2000, interval: 10 });
    await scheduler.tick();
    expect(subsystem.workFence.writable()).toBe(true);
    expect({ failures, mode: scheduler.status(bank.scope.bankId)[0]?.mode }).toEqual({ failures: [], mode: "idle" });
    expect(f.remote.calls.length).toBeGreaterThan(callsBefore);
    expect(journal.get(parent.identity.key)).toMatchObject({ identity: parent.identity, preparedAt: parent.preparedAt, terminal: { kind: "retain" } });
    expect(state.pending.get({ ...key, operationId: original.intent.operationId })).toMatchObject({ phase: "completed",
      remoteOperationId: original.remoteOperationId, intent: original.intent });
    expect(await state.provider.retain(call, writeTestRetain(bank.scope.bankId))).toMatchObject({ ok: true, data: { status: "completed" } });
    expect(native.calls.filter((entry) => entry.startsWith("dispatch:"))).toHaveLength(1);
  });

  it.each([false, true])("retains a real fence failure and its bounded Core diagnostic when loggerThrows=%s", async (loggerThrows) => {
    const f = fixture(); const subsystem = f.subsystem(); subsystem.start(); await subsystem.scheduler.tick();
    await subsystem.workFence.quiesce({ timeoutMs: 1000 });
    const warn = vi.spyOn(f.logger, "warn");
    if (loggerThrows) warn.mockImplementation(() => { throw new Error("fixture log sink unavailable"); });
    const before = f.remote.calls.length;
    subsystem.scheduler.requestManual("bank-a"); await subsystem.scheduler.tick();
    const status = subsystem.scheduler.status("bank-a")[0]!;
    expect(status).toMatchObject({ mode: "failed", errorCode: "HINDSIGHT_REPLICA_SYNC_FAILED", consecutiveFailures: 1 });
    expect(warn).toHaveBeenCalledWith({ bankId: "bank-a", runId: expect.any(String), code: "HINDSIGHT_REPLICA_SYNC_FAILED",
      cause: "MEMORY_AUTHORITY_FENCED" }, "Hindsight scheduled synchronization failed");
    expect(f.remote.calls).toHaveLength(before);
  });
});

describe("Hindsight subsystem memory-unavailable degrade path", () => {
  it("admits a new Character without a verified Bank as a memory-unavailable chat turn that still replies", async () => {
    const f = fixture(); const runtime = f.compose();
    expectUnavailable(await runtime.captureRun("mika"));
    const mikaBank = hindsightBankBindings("mika")[1].externalBankId;
    expect(f.remote.calls.some((call) => call.bankId === mikaBank)).toBe(false); expect(degradedCodes(f)).toEqual(["bank_not_ready"]);
    const turn = await memoryChatTurn(runtime, f.db, "mika");
    expect(turn.text).toBe("hello mika"); expect(turn.memorySnapshot).toMatchObject({ providerId: "hindsight", capabilities: { recall: false } });
    expect(turn.toolNames).toEqual([]); expect(turn.prompt).not.toContain("Memory (non-negotiable)");
    expect(Object.keys((await runtime.captureRun("taki")).tools)).toContain("recall");
  });

  it.each([
    ["timeout change", "config_changed", (f: HindsightRuntimeFixture) => f.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", 12_345)],
    ["key rotation", "config_changed", (f: HindsightRuntimeFixture) => { f.secrets.catalog.set("memory.hindsight.connection.api-key", "rotated-key"); }],
    ["disabled flag", "connection_disabled", (f: HindsightRuntimeFixture) => f.config.upsert("TAKI_HINDSIGHT_ENABLED", false)],
  ] as const)("degrades a Run after a %s without a network call", async (_name, reason, change) => {
    const f = fixture(); const runtime = f.compose(); await runtime.captureRun("taki"); const before = f.remote.calls.length;
    change(f);
    expectUnavailable(await runtime.captureRun("taki"));
    expect(degradedCodes(f)).toEqual([reason]); expect(f.remote.calls).toHaveLength(before);
    expect(runtime.hindsightBindingSnapshot().binding).toEqual({ kind: "published", epochId: "epoch" });
  });

  it("degrades while an unreachable provider left no admission evidence, then serves memory once it is reachable", async () => {
    const f = fixture(); const runtime = f.compose(); f.remote.control.offline = true;
    expectUnavailable(await runtime.captureRun("taki")); expect(degradedCodes(f)).toEqual(["admission_unavailable"]);
    f.remote.control.offline = false;
    expect(Object.keys((await runtime.captureRun("taki")).tools)).toContain("recall");
  });

  it("keeps a primary witness during drift and ingests it exactly once after the connection is restored", async () => {
    const model = scriptedGenerateModel([{ kind: "text", deltas: [JSON.stringify({ decision: "keep", route: "both", fromSeq: 1, throughSeq: 2 })] }]);
    const f = fixture({ model }); const subsystem = f.subsystem(); await subsystem.captureRun("taki");
    f.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", 12_345);
    const entries = [f.timeline.append({ characterId: "taki", role: "user", content: "Drifted source fact" }),
      f.timeline.append({ characterId: "taki", role: "assistant", content: "Drifted committed answer" })];
    subsystem.recordPrimaryCommitted({ characterId: "taki", entries });
    expect(f.logs.some((entry) => logCode(entry) === "MEMORY_INGESTION_WITNESS_FAILED")).toBe(false);
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_ingestion_primary_commits").get()?.n).toBe(2);
    f.config.delete("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS"); f.remote.control.offline = true;
    expect(await subsystem.memoryFlush.prepareRetirement({ characterId: "taki", fromSeq: 1, throughSeq: 2, operationId: "restored-flush" }))
      .toMatchObject({ status: "success", writes: 2, throughSeq: 2 });
    expect(await subsystem.memoryFlush.prepareRetirement({ characterId: "taki", fromSeq: 1, throughSeq: 2, operationId: "restored-flush-again" }))
      .toMatchObject({ status: "success", writes: 0 });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("skips background ingestion, curation and flush for a Character without a routed Bank before any model call and keeps its witness", async () => {
    const model = failingGenerateModel(new Error("no Utility model call is allowed for an unprovisioned Character"));
    const f = fixture({ model }); const subsystem = f.subsystem(); expectUnavailable(await subsystem.captureRun("mika"));
    // Enough committed source to cross the ingestion threshold, so only the routing skip keeps the gate model idle.
    const entries = Array.from({ length: EPISODIC_EVERY_N }, (_, index) =>
      f.timeline.append({ characterId: "mika", role: index % 2 === 0 ? "user" : "assistant", content: `Unprovisioned source ${index}` }));
    subsystem.recordPrimaryCommitted({ characterId: "mika", entries });
    for (let turn = 0; turn < 3; turn++) await subsystem.maintenance.run("mika", "primary");
    expect(await subsystem.memoryFlush.prepareRetirement({ characterId: "mika", fromSeq: 1, throughSeq: EPISODIC_EVERY_N, operationId: "unrouted-flush" }))
      .toEqual({ status: "retryable_failure", code: "MEMORY_FLUSH_INCOMPLETE" });
    expect(model.doGenerateCalls).toHaveLength(0); expect(f.remote.calls).toEqual(expect.not.arrayContaining([expect.objectContaining({ operation: "retain" })]));
    expect(f.logs.some((entry) => ["MEMORY_INGESTION_FAILED", "MEMORY_INGESTION_WITNESS_FAILED"].includes(logCode(entry) ?? ""))).toBe(false);
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_ingestion_primary_commits").get()?.n).toBe(EPISODIC_EVERY_N);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerRequest } from "@taki/shared";
import { createRunRepo } from "../db/run-repo.ts";
import { APPLICATION_TEST_AT } from "../testing/hindsight-application-fixtures.ts";
import { hindsightRuntimeFixture, type HindsightRuntimeFixture } from "../testing/hindsight-runtime-composition-fixtures.ts";
import { createHindsightClient } from "../memory/hindsight/hindsight-client.ts";
import { hindsightError } from "../memory/hindsight/hindsight-errors.ts";
import type { TurnInteractive } from "../mcp/mcp-turn-tools.ts";
import { createRunSnapshotCapture } from "./run-snapshot-capture.ts";
import { createRunService } from "./run-service.ts";

const fixtures: HindsightRuntimeFixture[] = [];
const trigger: TriggerRequest = { triggerRequestId: "cold-capture", idempotencyKey: "cold-capture", characterId: "taki",
  initiator: "primary", provenance: { provider: "chat" }, deliveryClass: "class_a", contextMode: "primary" };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(APPLICATION_TEST_AT); });
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); vi.restoreAllMocks(); vi.useRealTimers(); });
function deferred() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(seed = false) {
  const f = hindsightRuntimeFixture({ seed }); fixtures.push(f);
  const entered = deferred(); const response = deferred();
  // The real client, not this abort-ignoring transport, owns cancellation and
  // its finite per-HTTP timer. No server or model is started by this fixture.
  const transport = vi.fn(async () => {
    entered.resolve(); await response.promise;
    return { status: 200, body: JSON.stringify({ status: "healthy", database: "connected" }) };
  });
  const client = createHindsightClient({ endpoint: "http://127.0.0.1:18481", resolveApiKey: () => "capture-fixture-key", transport });
  vi.spyOn(f.remote.client, "health").mockImplementation(client.health);
  const runtime = f.compose(); const repo = createRunRepo(f.db); const admit = vi.spyOn(repo, "admit");
  const extensions = { runContext: vi.fn((_interactive?: TurnInteractive, runId = "capture-run") => ({ tools: {}, toolDisclosure: { deferredToolNames: [], describedTools: {}, skills: {} }, instructions: "",
    snapshot: { runId, primaryHostId: "core-host", hosts: [], entries: [], collisions: [],
      budget: { maxEntries: 1, maxDescriptionChars: 1, maxSearchResults: 1, maxCalls: 1 } } })) };
  const snapshot = createRunSnapshotCapture({ memory: runtime, extensions,
    governance: { level: () => ({ level: "standard", policyGeneration: 1, registryRevision: 1 }) }, provider: "test", modelId: "test" });
  const runs = createRunService<TurnInteractive>({ repo, snapshot, provider: "test", modelId: "test" });
  return { ...f, runtime, runs, snapshot, entered, response, transport, admit, extensions };
}
const interactive = (signal: AbortSignal): TurnInteractive => ({ connection: {} as never, signal });
const outcome = (work: Promise<unknown>) => work.then(() => ({ code: "admitted" }), (error: unknown) => ({ code: error instanceof Error ? error.message : "unknown" }));
function noAdmission(f: ReturnType<typeof fixture>) {
  expect(f.admit).not.toHaveBeenCalled();
  expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
  expect(f.db.prepare("SELECT count(*) AS n FROM run_snapshots").get()?.n).toBe(0);
}

describe("Run snapshot capture lifetime", () => {
  it("degrades instead of using unverified capabilities after both pre-sync failures without starting an uncancellable retry", async () => {
    const f = fixture(true); const controller = new AbortController();
    vi.mocked(f.remote.client.health).mockRejectedValueOnce(hindsightError("HINDSIGHT_UNREACHABLE"))
      .mockRejectedValueOnce(hindsightError("HINDSIGHT_UNREACHABLE"));
    let result: { code: string } | undefined; let tools: object | undefined;
    const running = outcome(f.runtime.captureRun("taki", controller.signal).then((run) => { tools = run.tools; }))
      .then((value) => { result = value; });
    try {
      await vi.advanceTimersByTimeAsync(0);
      // No admission evidence and an unreachable provider admit a memory-unavailable Run, never unverified capabilities.
      expect(result).toEqual({ code: "admitted" }); expect(tools).toEqual({});
      expect(f.remote.client.health).toHaveBeenCalledTimes(2); expect(f.transport).not.toHaveBeenCalled();
    } finally { controller.abort(); f.response.resolve(); await vi.runAllTimersAsync(); await running; }
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_application_runtime_admission").get()?.n).toBe(0);
    noAdmission(f);
  });

  it.each(["cold", "queued"] as const)("propagates interactive cancellation through the real %s capture path", async (phase) => {
    const f = fixture(); const controller = new AbortController();
    const preceding = phase === "queued" ? outcome(f.runtime.captureRun("taki")) : undefined;
    if (preceding) await f.entered.promise;
    let result: { code: string } | undefined;
    const running = outcome(f.runs.admit(trigger, interactive(controller.signal))).then((value) => { result = value; });
    await f.entered.promise;
    const before = f.db.prepare("SELECT * FROM hindsight_replica_sync_leases").all();
    try {
      controller.abort("private disconnected socket"); await vi.advanceTimersByTimeAsync(0);
      expect(result).toEqual({ code: "MEMORY_OPERATION_CANCELLED" });
      noAdmission(f); expect(f.transport).toHaveBeenCalledOnce();
      if (phase === "queued") expect(f.db.prepare("SELECT * FROM hindsight_replica_sync_leases").all()).toEqual(before);
    } finally { f.response.resolve(); await vi.runAllTimersAsync(); await running; await preceding; }
    noAdmission(f);
  });

  it("honors an explicit Run deadline during cold admission before the first HTTP allowance expires", async () => {
    const f = fixture(); let result: { code: string } | undefined;
    const running = outcome(f.runs.admit({ ...trigger, deadlineAt: new Date(Date.now() + 5000).toISOString() }))
      .then((value) => { result = value; });
    await f.entered.promise;
    try {
      await vi.advanceTimersByTimeAsync(4999); expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1); expect(result).toEqual({ code: "RUN_DEADLINE_EXCEEDED" });
      noAdmission(f); expect(f.transport).toHaveBeenCalledOnce();
    } finally { f.response.resolve(); await vi.runAllTimersAsync(); await running; }
    noAdmission(f);
  });

  it("rejects a previously cancelled capture before acquiring a Bank lease or creating extension context", async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    const result = outcome(f.runs.admit(trigger, interactive(controller.signal)));
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(f.transport).not.toHaveBeenCalled(); expect(f.extensions.runContext).not.toHaveBeenCalled();
      expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_replica_sync_leases").get()?.n).toBe(0);
    } finally { f.response.resolve(); await vi.runAllTimersAsync(); }
    expect(await result).toEqual({ code: "MEMORY_OPERATION_CANCELLED" }); noAdmission(f);
  });

  it("does not overflow a distant explicit deadline and cleans its timer after caller cancellation", async () => {
    const f = fixture(); const controller = new AbortController(); let result: { code: string } | undefined;
    const running = outcome(f.runs.admit({ ...trigger, deadlineAt: new Date(Date.now() + 2_147_484_647).toISOString() },
      interactive(controller.signal))).then((value) => { result = value; });
    await f.entered.promise;
    try {
      await vi.advanceTimersByTimeAsync(1); expect(result).toBeUndefined();
      controller.abort(); await vi.advanceTimersByTimeAsync(0);
      expect(result).toEqual({ code: "MEMORY_OPERATION_CANCELLED" }); expect(vi.getTimerCount()).toBe(0);
      noAdmission(f);
    } finally { f.response.resolve(); await vi.runAllTimersAsync(); await running; }
  });
});

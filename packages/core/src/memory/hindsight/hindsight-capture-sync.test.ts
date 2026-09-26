import { afterEach, describe, expect, it, vi } from "vitest";
import type { TakiApplicationCommitReceipt } from "@taki/shared";
import { APPLICATION_TEST_AT, applicationTestEvent, applicationTestMemoryPayload, applicationTestNative,
  type ApplicationNativeFixture } from "../../testing/hindsight-application-fixtures.ts";
import { hindsightRuntimeFixture, type HindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import type { CuratorTestBank } from "./hindsight-policy-curator-fixtures.ts";

const fixtures: HindsightRuntimeFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
  vi.restoreAllMocks(); vi.useRealTimers();
});
async function primed(config: Record<string, number> = {}) {
  const f = hindsightRuntimeFixture(); fixtures.push(f);
  for (const [key, value] of Object.entries(config)) f.config.upsert(key, value);
  const subsystem = f.subsystem();
  expect(Object.keys((await subsystem.captureRun("taki")).tools)).toContain("recall");
  f.logs.splice(0); return { f, subsystem, bank: f.banks[0]! };
}
function publishNative(bank: CuratorTestBank, native: ApplicationNativeFixture[], from: { native_cursor: number; state_cursor: number }) {
  for (const entry of native) bank.native = [...bank.native.filter((old) => old.head.object_id !== entry.head.object_id), entry];
  bank.server.cursor.state++;
  bank.events.push(applicationTestEvent({ scope: bank.scope, native, from,
    to: { native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state } }));
}
/** New native units that Core has not bound yet, as native extraction publishes them. */
function remoteUnits(bank: CuratorTestBank, count: number, prefix = "unit"): string[] {
  const from = { native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state };
  const ids = Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
  publishNative(bank, ids.map((id) => applicationTestNative({ scope: bank.scope, kind: "memory_unit", cursor: ++bank.server.cursor.native,
    payload: applicationTestMemoryPayload({ bank_id: bank.scope.bankId, memory_id: id, document_id: null, text: `${bank.scope.bankId} ${id}` }) })), from);
  return ids;
}
/** Native consolidation advances an unbound unit's revision between Core's pull and its binding commit. */
function remoteConsolidate(bank: CuratorTestBank, id: string): void {
  const old = bank.native.find((entry) => entry.head.object_id === id)!.body.content;
  if (old.body_schema !== "application-native-record.v1" || !("memory_id" in old.value.payload)) throw new Error("fixture unit missing");
  const from = { native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state };
  publishNative(bank, [applicationTestNative({ scope: bank.scope, kind: "memory_unit", cursor: ++bank.server.cursor.native,
    payload: { ...old.value.payload, revision: old.value.payload.revision + 1, consolidated_at: APPLICATION_TEST_AT } })], from);
}
function raceCommits(bank: CuratorTestBank, times: number, id: string) {
  const commit = bank.server.client.commitApplication; let raced = 0;
  bank.server.client.commitApplication = async (request) => {
    if (raced < times) { raced++; remoteConsolidate(bank, id); }
    return commit(request);
  };
}
function receipts(bank: CuratorTestBank, state: TakiApplicationCommitReceipt["state"]) {
  return [...bank.server.receipts.values()].filter((receipt) => receipt.state === state).length;
}
function bound(f: HindsightRuntimeFixture, bank: CuratorTestBank, id: string) {
  return f.replica.record({ ...bank.scope, memoryId: id }) !== undefined;
}
/** Holds every binding commit, so admission can only end by its budget; reports whether capture was pending at expected-1 and done at expected. */
async function admissionMs(subsystem: Awaited<ReturnType<typeof primed>>["subsystem"], bank: CuratorTestBank, expected: number) {
  remoteUnits(bank, 1, `unit-${expected}`); const commit = bank.server.client.commitApplication;
  bank.server.client.commitApplication = async (request) => { await new Promise((resolve) => setTimeout(resolve, 60_000)); return commit(request); };
  let done = false; void subsystem.captureRun("taki").then(() => { done = true; }, () => { done = true; });
  await vi.advanceTimersByTimeAsync(expected - 1); const early = done;
  await vi.advanceTimersByTimeAsync(1); bank.server.client.commitApplication = commit;
  await vi.runAllTimersAsync(); await subsystem.state.service.settle();
  return { early, done };
}
function syncLogs(f: HindsightRuntimeFixture) {
  return f.logs.filter((log) => typeof log.obj === "object" && log.obj !== null && "outcome" in log.obj).map((log) => ({ level: log.level, ...log.obj as object }));
}

describe("Run-admission Hindsight sync resilience", () => {
  it("re-pulls and rebinds when native consolidation races the foreground binding commit (D1)", async () => {
    const { f, subsystem, bank } = await primed(); const [id] = remoteUnits(bank, 1); raceCommits(bank, 1, id!);
    const run = await subsystem.captureRun("taki");
    expect(Object.keys(run.tools)).toContain("recall"); expect(syncLogs(f)).toEqual([]);
    expect(receipts(bank, "refused")).toBe(1); expect(receipts(bank, "completed")).toBe(1); expect(bound(f, bank, id!)).toBe(true);
    expect(f.replica.checkpoint(bank.scope.bankId)?.checkpoint).toEqual({ native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state });
  });

  it("degrades the Run to its readable replica after bounded conflict retries, then converges later without a duplicate commit", async () => {
    const { f, subsystem, bank } = await primed(); const [id] = remoteUnits(bank, 1); raceCommits(bank, 4, id!);
    const run = await subsystem.captureRun("taki");
    expect(Object.keys(run.tools)).toContain("recall"); expect(run.automaticRecall).toBeDefined();
    expect(syncLogs(f)).toEqual([{ level: "warn", characterId: "taki", bankId: bank.scope.bankId,
      code: "HINDSIGHT_APPLICATION_NATIVE_VERSION_CONFLICT", outcome: "degraded" }]);
    expect(receipts(bank, "refused")).toBe(4); expect(bound(f, bank, id!)).toBe(false);
    await subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } });
    expect(receipts(bank, "refused")).toBe(4); expect(receipts(bank, "completed")).toBe(1); expect(bound(f, bank, id!)).toBe(true);
  });

  it("admits a partial Run for any non-integrity sync failure and logs only a closed code", async () => {
    const { f, subsystem, bank } = await primed(); remoteUnits(bank, 1);
    vi.spyOn(f.remote.client, "applicationChanges").mockRejectedValueOnce(new TypeError("private provider detail"));
    const run = await subsystem.captureRun("taki");
    expect(Object.keys(run.tools)).toContain("recall");
    expect(syncLogs(f)).toEqual([{ level: "warn", characterId: "taki", bankId: bank.scope.bankId, code: "MEMORY_INTERNAL_ERROR", outcome: "degraded" }]);
    expect(JSON.stringify(f.logs)).not.toContain("private");
  });

  it("keeps refusing an integrity failure, as a logged structured refusal", async () => {
    const { f, subsystem, bank } = await primed(); remoteUnits(bank, 1); const before = f.replica.checkpoint(bank.scope.bankId);
    const changes = f.remote.client.applicationChanges;
    vi.spyOn(f.remote.client, "applicationChanges").mockImplementation(async (input) => {
      const page = await changes(input); return { ...page, changes: page.changes.map((event) => ({ ...event, event_hash: "0".repeat(64) })) };
    });
    const error = await subsystem.captureRun("taki").then(() => undefined, (value: unknown) => value as Error);
    expect(error?.message).toMatch(/^[A-Z][A-Z0-9_]+$/);
    expect(syncLogs(f)).toEqual([{ level: "error", characterId: "taki", bankId: bank.scope.bankId, code: error?.message }]
      .map((log) => ({ ...log, outcome: "refused" })));
    expect(f.replica.checkpoint(bank.scope.bankId)).toEqual(before);
  });

  it("bounds admission by its budget with many pending units; binding finishes in the background exactly once (D2)", async () => {
    vi.useFakeTimers(); vi.setSystemTime(APPLICATION_TEST_AT);
    const { f, subsystem, bank } = await primed(); const ids = remoteUnits(bank, 8);
    const commit = bank.server.client.commitApplication;
    bank.server.client.commitApplication = async (request) => { await new Promise((resolve) => setTimeout(resolve, 2500)); return commit(request); };
    const budget = 7500;
    const captured: unknown[] = []; const capture = () => void subsystem.captureRun("taki").then((run) => captured.push(run), (error: unknown) => captured.push(error));
    capture();
    await vi.advanceTimersByTimeAsync(budget - 1); expect(captured).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); expect(captured).toHaveLength(1);
    expect(Object.keys((captured[0] as { tools: object }).tools)).toContain("recall");
    const early = receipts(bank, "completed"); expect(early).toBeGreaterThan(0); expect(early).toBeLessThan(ids.length);
    // A second Run queues behind the unfinished Bank work and is bounded the same way.
    capture();
    await vi.advanceTimersByTimeAsync(budget); expect(captured).toHaveLength(2);
    expect(Object.keys((captured[1] as { tools: object }).tools)).toContain("recall");
    expect(syncLogs(f).map((log) => ("outcome" in log ? log.outcome : null))).toEqual(["deferred", "deferred", "deferred", "deferred"]);
    await vi.runAllTimersAsync(); await subsystem.state.service.settle();
    expect(receipts(bank, "completed")).toBe(ids.length); expect(receipts(bank, "refused")).toBe(0);
    for (const id of ids) expect(bound(f, bank, id)).toBe(true);
  });

  it.each([
    { request: 60_000, ack: undefined, budget: 7500 },
    { request: 5000, ack: undefined, budget: 5000 },
    { request: 60_000, ack: 9000, budget: 4500 },
  ])("bounds admission by min(request timeout $request, half the chat ack deadline $ack) = $budget", async ({ request, ack, budget }) => {
    vi.useFakeTimers(); vi.setSystemTime(APPLICATION_TEST_AT);
    const { subsystem, bank } = await primed({ TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS: request, ...(ack ? { TAKI_CHAT_ACK_TIMEOUT_MS: ack } : {}) });
    expect(await admissionMs(subsystem, bank, budget)).toEqual({ early: false, done: true });
  });

  it("reads the chat ack deadline at each capture, so a live change applies without a restart", async () => {
    vi.useFakeTimers(); vi.setSystemTime(APPLICATION_TEST_AT);
    const { f, subsystem, bank } = await primed({ TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS: 60_000 });
    expect(await admissionMs(subsystem, bank, 7500)).toEqual({ early: false, done: true });
    f.config.upsert("TAKI_CHAT_ACK_TIMEOUT_MS", 6000);
    expect(await admissionMs(subsystem, bank, 3000)).toEqual({ early: false, done: true });
  });
});

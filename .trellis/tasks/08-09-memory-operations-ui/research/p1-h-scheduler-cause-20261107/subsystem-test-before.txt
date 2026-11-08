import { afterEach, describe, expect, it } from "vitest";
import { failingGenerateModel, scriptedGenerateModel } from "../../testing/mock-language-model.ts";
import { hindsightRuntimeFixture, type HindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { memoryChatTurn } from "../../testing/memory-chat-turn-fixture.ts";
import type { CapturedMemoryRun } from "../canonical-memory-run.ts";
import { EPISODIC_EVERY_N } from "../auto-memory.ts";
import { hindsightBankBindings } from "./hindsight-bank-identity.ts";
import { MEMORY_UNAVAILABLE_SYSTEM_PROMPT } from "./hindsight-unavailable-run.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function fixture(input: Parameters<typeof hindsightRuntimeFixture>[0] = {}) { const f = hindsightRuntimeFixture(input); cleanup.push(f.close); return f; }
function expectUnavailable(run: CapturedMemoryRun) {
  expect(run.snapshot).toMatchObject({ providerId: "hindsight", authorityEpochId: "epoch", capabilities: { recall: false, retain: false } });
  expect(run.tools).toEqual({}); expect(run.automaticRecall).toBeUndefined(); expect(run.prompt).toBe(MEMORY_UNAVAILABLE_SYSTEM_PROMPT);
}
const logCode = (entry: HindsightRuntimeFixture["logs"][number]) => (entry.obj as { code?: string } | undefined)?.code;
function degradedCodes(f: HindsightRuntimeFixture) {
  return f.logs.filter((entry) => entry.msg === "Hindsight Run admitted without memory").map(logCode);
}

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

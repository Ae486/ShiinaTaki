import { afterEach, describe, expect, it } from "vitest";
import { hindsightRuntimeFixture, type HindsightRuntimeFixture } from "../testing/hindsight-runtime-composition-fixtures.ts";
import { memoryChatTurn } from "../testing/memory-chat-turn-fixture.ts";
import { MEMORY_UNAVAILABLE_SYSTEM_PROMPT } from "./hindsight/hindsight-unavailable-run.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function fixture() { const f = hindsightRuntimeFixture(); cleanup.push(f.close); return f; }
const witnesses = (f: HindsightRuntimeFixture) => Number(f.db.prepare("SELECT count(*) AS n FROM hindsight_ingestion_primary_commits").get()?.n);

describe("unbound selected Hindsight runtime at boot", () => {
  it.each([
    { name: "the connection flag disabled", code: "HINDSIGHT_APPLICATION_CONNECTION_UNAVAILABLE", reason: "connection_disabled",
      change: (f: HindsightRuntimeFixture) => f.config.upsert("TAKI_HINDSIGHT_ENABLED", false) },
    { name: "a template-revision conflict", code: "HINDSIGHT_TEMPLATE_CONFLICT", reason: "config_changed",
      change: (f: HindsightRuntimeFixture) => f.config.upsert("TAKI_HINDSIGHT_TEMPLATE_REVISION", "taki-bank-v2") },
  ])("admits a memory-unavailable chat turn and keeps the witness with $name", async ({ code, reason, change }) => {
    const f = fixture(); change(f); const runtime = f.compose();
    expect(runtime.hindsightBindingSnapshot().binding).toEqual({ kind: "unavailable", epochId: "epoch", code });
    expect(runtime.operations()).toBeNull(); expect(runtime.selected.legacy).toBeNull();
    const run = await runtime.captureRun("taki");
    expect(run.snapshot).toMatchObject({ providerId: "hindsight", authorityEpochId: "epoch",
      providerLineageId: f.authority.authorityEpoch("epoch").providerLineageId, capabilities: { recall: false } });
    expect(run.tools).toEqual({}); expect(run.prompt).toBe(MEMORY_UNAVAILABLE_SYSTEM_PROMPT);
    const turn = await memoryChatTurn(runtime, f.db, "taki");
    expect(turn.text).toBe("hello taki"); expect(turn.toolNames).toEqual([]);
    const entries = [f.timeline.append({ characterId: "taki", role: "user", content: "Unbound source" }),
      f.timeline.append({ characterId: "taki", role: "assistant", content: "Unbound answer" })];
    runtime.recordPrimaryCommitted({ characterId: "taki", entries });
    expect(witnesses(f)).toBe(2);
    expect(f.logs.filter((entry) => entry.msg === "Hindsight Run admitted without memory").map((entry) => (entry.obj as { code?: string }).code))
      .toEqual([reason, reason]);
    expect(f.remote.calls).toEqual([]);
  });

  it("keeps refusing an unbound runtime whose construction failed for any other cause", async () => {
    const f = fixture(); f.db.exec(`UPDATE hindsight_bank_setup SET template_digest='${"Z".repeat(64)}'`);
    const runtime = f.compose();
    expect(runtime.hindsightBindingSnapshot().binding).toMatchObject({ kind: "unavailable", epochId: "epoch" });
    await expect(runtime.captureRun("taki")).rejects.toThrow("MEMORY_RUNTIME_UNAVAILABLE");
    const entries = [f.timeline.append({ characterId: "taki", role: "user", content: "Refused source" })];
    runtime.recordPrimaryCommitted({ characterId: "taki", entries });
    expect(witnesses(f)).toBe(1); expect(f.remote.calls).toEqual([]);
  });

  it("returns to the full memory Run through the unchanged same-epoch recovery once the setting is repaired", async () => {
    const f = fixture(); f.config.upsert("TAKI_HINDSIGHT_ENABLED", false); const runtime = f.compose();
    expect((await runtime.captureRun("taki")).tools).toEqual({});
    f.config.upsert("TAKI_HINDSIGHT_ENABLED", true);
    expect(runtime.recoverHindsightBinding("epoch")).toEqual({ binding: "published", reconciledGroups: 0 });
    expect(Object.keys((await runtime.captureRun("taki")).tools)).toContain("recall");
  });
});

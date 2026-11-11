import { describe, expect, it, vi } from "vitest";
import { createTurnRegistry } from "../../agents/turn-registry.ts";
import { hindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { failingGenerateModel } from "../../testing/mock-language-model.ts";
import { readHindsightPolicyReviewStatus } from "../../db/hindsight-policy-review-repo.ts";
import * as reports from "../tidy-report.ts";
import * as modelDriver from "./hindsight-policy-curator-model.ts";
import { curatorTestAssessDriver } from "./hindsight-policy-curator-fixtures.ts";

// Failure modes: automatic maintenance still enters diagnostic/model review; manual-only sync suppresses review wakes;
// the activity signal mistakes a cancelled but unsettled turn for idle.
describe("policy review production wiring", () => {
  it("suppresses stale review hints once stop enters, including the paused drain saved during shutdown", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const changed = vi.fn(); const f = hindsightRuntimeFixture({ onPolicyReviewChanged: changed });
    f.config.upsert("TAKI_HINDSIGHT_POLICY_REVIEW_THRESHOLD", 1);
    const subsystem = f.subsystem(); let release!: () => void; let saved!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { saved = resolve; });
    const driver = vi.spyOn(modelDriver, "runHindsightPolicyCuratorModel").mockImplementation(async (input) => {
      const result = await curatorTestAssessDriver(input); saved(); await held; return result;
    });
    try {
      for (const bank of subsystem.state.runtime.banks()) subsystem.scheduler.configure(bank.bankId,
        { automatic: false, autoIntervalMs: 21_600_000, fullReconciliationIntervalMs: 604_800_000 });
      vi.setSystemTime(Date.now() + 10_000); subsystem.start(); await subsystem.scheduler.tick(); await ready;
      expect(changed).toHaveBeenCalledTimes(3);
      const stopped = subsystem.stop(); release(); await stopped;
      expect(changed).toHaveBeenCalledTimes(3);
      expect(readHindsightPolicyReviewStatus(f.db, { epochId: "epoch", available: false })[0])
        .toMatchObject({ state: "paused", savedAwaitingPublication: 2 });
    } finally { release(); driver.mockRestore(); await f.close(); vi.useRealTimers(); }
  });
  it("keeps post-turn ingestion but performs no policy review or tidy enumeration below threshold", async () => {
    const model = failingGenerateModel(new Error("no policy model call expected"));
    const f = hindsightRuntimeFixture({ model }); const subsystem = f.subsystem();
    const report = vi.spyOn(reports, "buildTidyReport"); const curator = vi.spyOn(subsystem.curator, "runNow");
    const ingestion = vi.spyOn(subsystem.ingestion, "maybeRun");
    try {
      for (let i = 0; i < 3; i++) await subsystem.maintenance.run("taki", "primary");
      await subsystem.tidy.maybeRun("taki");
      expect(ingestion).toHaveBeenCalledTimes(3); expect(curator).not.toHaveBeenCalled();
      expect(report).not.toHaveBeenCalled(); expect(model.doGenerateCalls).toHaveLength(0);
    } finally { report.mockRestore(); await f.close(); }
  });
  it("arms policy startup reconciliation on the single scheduler timer even with all sync Banks manual-only", async () => {
    const f = hindsightRuntimeFixture(); const subsystem = f.subsystem();
    try {
      for (const bank of subsystem.state.runtime.banks()) subsystem.scheduler.configure(bank.bankId,
        { automatic: false, autoIntervalMs: 21_600_000, fullReconciliationIntervalMs: 604_800_000 });
      subsystem.start(); await subsystem.scheduler.tick();
      await vi.waitFor(() => expect(readHindsightPolicyReviewStatus(f.db, { epochId: "epoch", available: true })).toHaveLength(2));
      expect(subsystem.scheduler.status().every((bank) => bank.lastAttemptAt === null)).toBe(true);
    } finally { await f.close(); }
  });
  it("reports actual per-Character activity and only notifies idle when the current turn ends", () => {
    const turns = createTurnRegistry(); const idle = vi.fn(); const unsubscribe = turns.observe(idle);
    const first = turns.begin("taki"); expect(turns.idleSince("taki")).toBeNull(); expect(turns.idleSince(null)).toBeNull();
    expect(turns.idleSince("saki")).toEqual(expect.any(Number));
    turns.cancel("taki"); expect(turns.idleSince("taki")).toBeNull();
    const second = turns.begin("taki"); turns.end("taki", first); expect(idle).not.toHaveBeenCalled();
    turns.end("taki", second); expect(idle).toHaveBeenCalledOnce(); expect(turns.idleSince(null)).toEqual(expect.any(Number));
    unsubscribe();
  });
});

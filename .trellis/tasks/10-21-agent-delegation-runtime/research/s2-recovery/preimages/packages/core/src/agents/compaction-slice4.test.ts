import type { LanguageModel } from "ai";
import { describe, expect, it, afterEach } from "vitest";
import { createCompactionPass } from "./compaction-pass.ts";
import { measureRequest } from "./request-measurement.ts";
import { createCompactionOperationRepo } from "../db/compaction-operation-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { failingGenerateModel, generatingModel } from "../testing/mock-language-model.ts";
import type { UtilitySlot } from "../memory/utility-slot.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function measurement(projectedInputTokens: number) {
  return { ...measureRequest({
    replay: { sourceRows: 10, liveRows: 10, selectedRows: 10, summaryTokens: 0, liveTokensBeforeFolds: 0,
      foldedTokensSaved: 0, historyTokens: 10, tokenBoundaryHit: false, sourceBackstopHit: false },
    messages: [{ role: "user" as const, content: "request" }], instructions: "instructions", toolSchemaTokens: 1,
    envelopeReserveTokens: 0,
  }), projectedInputTokens };
}

function fixture(projectedInputTokens: number) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  const timeline = createTimelineRepo(db); for (let index = 0; index < 10; index += 1)
    timeline.append({ characterId: "taki", role: "user", content: `message-${index}` });
  const summaries = createSummaryRepo(db); const operations = createCompactionOperationRepo(db);
  const calls: string[] = []; const model = generatingModel("compact summary") as LanguageModel;
  let clock = new Date("2026-08-31T00:00:00.000Z");
  const { logger } = createCaptureLogger();
  const makePass = (selectedModel: LanguageModel, config: { summaryQuality?: boolean; retryBudget?: number; retryCooldownMs?: number } = {}) => {
    const slot: UtilitySlot = { model: selectedModel, run: async (label, task) => { calls.push(label); return task(); }, usage: () => ({ calls: calls.length, inputTokens: 0, outputTokens: 0, usageUnknown: 0 }) };
    return createCompactionPass({
      view: { estimatedTokens: () => 90, budget: () => 100, effectiveWindowTokens: () => 100,
        measureRequest: () => measurement(projectedInputTokens) },
      timeline, summaries, operations, flush: { prepareRetirement: async () => ({ status: "not_required", reason: "canonical_local_records_are_authoritative" }) },
      slot, config: { triggerRatio: 0.8, keepMessages: 3, ...config }, logger, now: () => new Date(clock),
    });
  };
  return { pass: makePass(model), makePass, calls, summaries, operations, timeline, advance: (ms: number) => { clock = new Date(clock.getTime() + ms); } };
}

describe("Slice 4 pressure admission", () => {
  it("does not fire just below the complete-envelope boundary", async () => {
    const f = fixture(79); await f.pass.maybeRun("taki");
    expect(f.calls).toEqual([]);
  });

  it("fires at the complete-envelope 0.8 boundary", async () => {
    const f = fixture(80); await f.pass.maybeRun("taki");
    expect(f.calls).toEqual(["compact"]);
  });

  it("fires above the complete-envelope boundary", async () => {
    const f = fixture(81); await f.pass.maybeRun("taki");
    expect(f.calls).toEqual(["compact"]);
  });

  it("derives retry cooldown and budget from the durable terminal operation after restart", async () => {
    const f = fixture(90);
    const failing = failingGenerateModel(new Error("provider unavailable")) as LanguageModel;
    const first = f.makePass(failing, { summaryQuality: true, retryBudget: 1, retryCooldownMs: 60_000 });
    await first.maybeRun("taki");
    const restarted = f.makePass(generatingModel("should not run") as LanguageModel, { summaryQuality: true, retryBudget: 1, retryCooldownMs: 60_000 });
    await restarted.maybeRun("taki");
    expect(f.calls).toEqual(["compact"]);
    f.advance(60_001);
    await restarted.maybeRun("taki");
    expect(f.calls).toEqual(["compact"]);
  });

  it("starts a fresh durable budget when the stable source operation changes", async () => {
    const f = fixture(90);
    const first = f.makePass(failingGenerateModel(new Error("provider unavailable")) as LanguageModel,
      { summaryQuality: true, retryBudget: 1, retryCooldownMs: 0 });
    await first.maybeRun("taki");
    f.timeline.append({ characterId: "taki", role: "user", content: "new source row" });
    const changed = f.makePass(generatingModel("compact summary") as LanguageModel,
      { summaryQuality: true, retryBudget: 1, retryCooldownMs: 60_000 });
    await changed.maybeRun("taki");
    expect(f.calls).toEqual(["compact"]);
    f.advance(60_001);
    await changed.maybeRun("taki");
    expect(f.calls).toEqual(["compact", "compact"]);
  });

});

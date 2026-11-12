import { describe, expect, it, vi } from "vitest";
import { createUtilitySlot } from "./utility-slot.ts";
import { createMaintenanceAutoMemory } from "./auto-memory.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { failingGenerateModel } from "../testing/mock-language-model.ts";
import { MockLanguageModelV4 } from "ai/test";
import { createCompactionPass } from "../agents/compaction-pass.ts";
import { createCompactionOperationRepo } from "../db/compaction-operation-repo.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { openDatabase } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";

describe("emergency background generation retirement", () => {
  it("revokes an old compaction result while a fresh generation can commit Summary", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    const { logger } = createCaptureLogger(); let release!: () => void; let calls = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => {
      if (++calls === 1) await new Promise<void>((resolve) => { release = resolve; });
      return { content: [{ type: "text", text: calls === 1 ? "old result" : "fresh Local summary" }],
        finishReason: { unified: "stop", raw: undefined }, warnings: [],
        usage: { inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined } } };
    } });
    const slot = createUtilitySlot({ mainModel: model, logger });
    try {
      const timeline = createTimelineRepo(db); const summaries = createSummaryRepo(db);
      for (let index = 0; index < 10; index++) timeline.append({ characterId: "taki", role: "user", content: `m${index}` });
      const pass = createCompactionPass({ timeline, summaries, slot, operations: createCompactionOperationRepo(db), logger,
        view: { estimatedTokens: () => 90, budget: () => 100 }, config: { triggerRatio: 0.8, keepMessages: 3 },
        legacyFlush: () => undefined });
      const old = pass.maybeRun("taki"); await vi.waitFor(() => expect(release).toBeDefined());
      pass.retirePending(); slot.retirePending();
      await pass.maybeRun("taki"); expect(calls).toBe(2);
      const committed = summaries.getCheckpoint("taki"); expect(committed?.text).toBe("fresh Local summary");
      release(); await old; expect(summaries.getCheckpoint("taki")).toEqual(committed);
    } finally { release?.(); await slot.stop(); db.close(); }
  });
  it("detaches old utility and auto-memory chains, skips queued closures and retains cumulative usage for the fresh generation", async () => {
    const { logger } = createCaptureLogger();
    const slot = createUtilitySlot({ mainModel: failingGenerateModel(new Error("unused")), logger });
    let release!: (value: { usage: { inputTokens: number; outputTokens: number } }) => void;
    const old = slot.run("old", () => new Promise<{ usage: { inputTokens: number; outputTokens: number } }>((resolve) => { release = resolve; }));
    const queued = vi.fn(async () => undefined); const waiting = slot.run("old-queued", queued);
    await Promise.resolve();
    const calls = slot.usage().calls; slot.retirePending();
    const fresh = await slot.run("new-local", async () => ({ usage: { inputTokens: 3, outputTokens: 2 } }));
    expect(fresh).toBeDefined(); expect(slot.usage().calls).toBe(calls + 1); await slot.settle();
    release({ usage: { inputTokens: 7, outputTokens: 5 } });
    expect(await old).toBeUndefined(); await waiting; expect(queued).not.toHaveBeenCalled();
    expect(slot.usage()).toMatchObject({ calls: calls + 1, inputTokens: 10, outputTokens: 7 });

    let finish!: () => void; const compact = vi.fn(async () => undefined);
    const maintenance = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    const auto = createMaintenanceAutoMemory({ maintenance: () => ({ run: maintenance }), compact: { maybeRun: compact },
      legacyMaintenanceBeforeCompact: () => true, logger });
    const inflight = auto.onTurnCompleted("taki"); const pending = auto.onTurnCompleted("taki");
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(maintenance).toHaveBeenCalledTimes(1); auto.retirePending();
    await auto.onTurnCompleted("taki"); expect(maintenance).toHaveBeenCalledTimes(2); expect(compact).toHaveBeenCalledTimes(1);
    finish(); await Promise.all([inflight, pending]);
    expect(maintenance).toHaveBeenCalledTimes(2); expect(compact).toHaveBeenCalledTimes(1);
    await auto.stop(); await slot.stop();
  });
});

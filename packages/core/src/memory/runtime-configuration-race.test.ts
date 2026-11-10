import { setImmediate } from "node:timers/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMemoryConfig } from "../config/memory-config.ts";
import { createMemoryFixture, type MemoryFixture } from "../testing/memory-fixture.ts";
import { createCanonicalMaintenanceFixture } from "../db/canonical-memory-maintenance-fixtures.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createSearchProjectionPolicyRepo } from "../db/search-projection-policy-repo.ts";
import { createConfigRepo } from "../db/config-repo.ts";
import { createConfigSource } from "../config/config-source.ts";
import { createConfigApplication } from "../config/config-application.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { scriptedGenerateModel } from "../testing/mock-language-model.ts";
import { createMemoryEngine } from "./memory-engine.ts";
import { composeMemoryRuntime } from "./runtime-composition.ts";
import { createMemoryStore } from "./store.ts";
import { indexEntry } from "./indexer.ts";

const fixtures: MemoryFixture[] = [];
const runtimes: Array<ReturnType<typeof composeMemoryRuntime>> = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.stop();
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

describe("independent memory policy application", () => {
  it("retains newly applied ranking when an earlier tokenizer rebuild finishes", async () => {
    const f = createMemoryFixture(); fixtures.push(f);
    const trigger = "那天我们聊了很久也走了很远的路啊";
    const mention = "ramen 拉面 was fine and we moved on";
    f.store.write({ layer: "profile", content: trigger, disclosure: "拉面", importance: 5 });
    f.store.write({ layer: "profile", content: mention, importance: 5 });
    for (let index = 0; index < 70; index++) {
      f.store.write({ layer: "profile", content: `无关的填充条目第${index}条内容随便写点`, importance: 5 });
    }
    const engine = createMemoryEngine({ db: f.db, memoryRoot: f.root }); engine.reconcile();
    const search = engine.createTools("taki").memory_search!;
    const query = () => search.execute!({ query: "拉面" }, { toolCallId: "ranking", messages: [], context: {} });
    expect(await query()).toMatchObject({ ok: true, results: [{ content: trigger }, { content: mention }] });
    const rebuild = engine.reconfigureSearch!({ ...loadMemoryConfig({}), stoplist: false });
    await setImmediate();
    engine.reconfigureRanking!({ disclosure: 1, content: 4, searchTerms: 2 });
    expect(await query()).toMatchObject({ ok: true, results: [{ content: mention }, { content: trigger }] });
    await rebuild;
    expect(await query()).toMatchObject({ ok: true, results: [{ content: mention }, { content: trigger }] });
  });

  it.each([true, false])("refuses manual tidy before Utility dispatch when the index policy is unknown (canonical=%s)", async (canonical) => {
    const f = createMemoryFixture(); fixtures.push(f);
    const authority = createCanonicalMaintenanceFixture(f.db);
    if (canonical) {
      authority.seed({ unit: { text: "A retained fact with no recall trigger" }, policy: { disclosure: null } });
      f.db.prepare(`UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,
        verified_snapshot_id='fixture',activation_transaction_id='fixture' WHERE singleton=1`).run({ epoch: authority.epochId });
    } else {
      const store = createMemoryStore({ root: join(f.root, "workspace", "memory") });
      indexEntry(f, store.write({ layer: "profile", content: "A retained fact with no recall trigger", importance: 5 }));
    }
    const model = scriptedGenerateModel([{ kind: "text", deltas: ["reviewed"] }]);
    const { logger } = createCaptureLogger();
    const runtime = composeMemoryRuntime({ db: f.db, dataDir: f.root, promptDir: join(f.root, "prompt"), model,
      timeline: createTimelineRepo(f.db), summaries: createSummaryRepo(f.db), windowStart: () => 1,
      estimatedTokens: () => 0, budget: () => 1000, compact: { triggerRatio: 0.8, keepMessages: 40 },
      env: { TAKI_MEMORY_TIDY_MAX_STEPS: "1" }, logger });
    runtimes.push(runtime);
    const table = canonical ? "canonical_memory_units" : "memory_entries";
    const before = f.db.prepare(`SELECT * FROM ${table}`).all();
    expect(runtime.memory.searchStatus?.()).toEqual({ ready: false, stoplist: null });
    await expect(runtime.tidy.runNow("a")).rejects.toThrow("MEMORY_SEARCH_INDEX_UNAVAILABLE");
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(f.db.prepare(`SELECT * FROM ${table}`).all()).toEqual(before);
  });

  it("reports the proven active search policy when invalid desired configuration survives a restart", async () => {
    const f = createMemoryFixture(); fixtures.push(f);
    const authority = createCanonicalMaintenanceFixture(f.db);
    f.db.prepare(`UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,
      verified_snapshot_id='fixture',activation_transaction_id='fixture' WHERE singleton=1`).run({ epoch: authority.epochId });
    createSearchProjectionPolicyRepo(f.db).write({ table: "canonical_memory_fts", epochId: authority.epochId }, false);
    const env = { TAKI_MEMORY_STOPLIST: "invalid" };
    const source = createConfigSource({ repo: createConfigRepo(f.db), env });
    const application = createConfigApplication({ source, changed() {} });
    const { logger } = createCaptureLogger();
    const runtime = composeMemoryRuntime({ db: f.db, dataDir: f.root, promptDir: join(f.root, "prompt"),
      configuration: source, application, timeline: createTimelineRepo(f.db), summaries: createSummaryRepo(f.db),
      windowStart: () => 1, estimatedTokens: () => 0, budget: () => 1000, compact: { triggerRatio: 0.8, keepMessages: 40 }, env, logger });
    runtimes.push(runtime); runtime.start();
    expect((await runtime.captureRun("a")).snapshot.providerId).toBe("local");
    expect(runtime.memory.searchStatus?.()).toEqual({ ready: true, stoplist: false });
    expect(application.read("TAKI_MEMORY_STOPLIST")).toMatchObject({ state: "failed", activeValue: "off" });
  });
});

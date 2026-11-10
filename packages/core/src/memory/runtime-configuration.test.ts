import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase } from "../db/sqlite.ts";
import { createConfigRepo } from "../db/config-repo.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createSearchProjectionPolicyRepo } from "../db/search-projection-policy-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { createConfigSource } from "../config/config-source.ts";
import { createConfigApplication } from "../config/config-application.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { composeMemoryRuntime } from "./runtime-composition.ts";
import { createMemoryOperationService } from "./operations/memory-operation-service.ts";
import { createIndexOperationAdapter } from "./operations/index-operation-adapter.ts";
import { fakeSetup } from "./operations/memory-operation-fixtures.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

function fixture(canonical = true, env: Record<string, string> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "taki-live-memory-"));
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  const epoch = createCanonicalMemoryAuthorityRepo(db).initializeLocalAuthority(new Date().toISOString());
  if (canonical) db.prepare(`UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,
    verified_snapshot_id='test',activation_transaction_id='test' WHERE singleton=1`).run({ epoch: epoch.epochId });
  const repo = createConfigRepo(db);
  const source = createConfigSource({ repo, env });
  const application = createConfigApplication({ source, changed() {} });
  const { logger } = createCaptureLogger();
  const runtime = composeMemoryRuntime({ db, dataDir, promptDir: join(dataDir, "prompt"),
    configuration: source, application, timeline: createTimelineRepo(db), summaries: createSummaryRepo(db),
    windowStart: () => 1, estimatedTokens: () => 0, budget: () => 1000,
    compact: { triggerRatio: 0.8, keepMessages: 40 }, env, logger });
  const operations = createMemoryOperationService({ db, live: runtime.operations, searchIndex: runtime.searchIndex,
    setup: fakeSetup(), bootId: "test", logger, onChanged() {} });
  runtime.installIndexSubmit(createIndexOperationAdapter(operations, runtime.searchIndex));
  cleanup.push(async () => { await runtime.stop(); await operations.stop(); db.close(); rmTempDir(dataDir); });
  const apply = async (key: string, value: string | number) => {
    repo.upsert(key, value);
    await application.apply([key], () => runtime.reconfigure(key));
  };
  return { db, dataDir, epoch, repo, application, runtime, operations, apply };
}

describe("live Local/Legacy policy composition", () => {
  it.each([true, false])("initializes an unknown index through the durable owner and applies search policy (canonical=%s)", async (canonical) => {
    const f = fixture(canonical);
    expect(f.runtime.memory.searchStatus?.()).toEqual({ ready: false, stoplist: null });
    const run = await f.runtime.captureRun("taki");
    expect(run.snapshot.providerId).toBe(canonical ? "local" : "legacy-markdown");
    expect(f.operations.recent(10)).toMatchObject([{ kind: "index.rebuild", state: "completed" }]);
    f.runtime.writeMemory({ characterId: "taki", layer: "episodes", content: "我 喜欢 拉面", importance: 5, origin: "observed" });
    await f.apply("TAKI_MEMORY_STOPLIST", "off");
    expect(f.application.read("TAKI_MEMORY_STOPLIST")).toMatchObject({ state: "applied", activeValue: "off" });
    expect(f.runtime.memory.searchStatus?.()).toEqual({ ready: true, stoplist: false });
    const table = canonical ? "canonical_memory_fts" : "memory_fts";
    expect(String(f.db.prepare(`SELECT search_terms FROM ${table}`).get()?.search_terms).split(" ")).toContain("我");
    const persisted = createSearchProjectionPolicyRepo(f.db).read(canonical
      ? { table: "canonical_memory_fts", epochId: f.epoch.epochId } : { table: "memory_fts", epochId: null });
    expect(persisted?.stoplist).toBe(false);
  });

  it("keeps basic composition and Main memory available with invalid tidy and unrelated Utility context", async () => {
    const f = fixture(true, { TAKI_MEMORY_TIDY_MAX_STEPS: "bad", TAKI_UTILITY_CONTEXT_TOKENS: "bad" });
    expect(f.application.read("TAKI_MEMORY_TIDY_MAX_STEPS")).toMatchObject({ state: "unavailable", activeValue: null });
    expect((await f.runtime.captureRun("taki")).snapshot.providerId).toBe("local");
    await expect(f.runtime.tidy.runNow("taki")).rejects.toThrow("MEMORY_POLICY_UNAVAILABLE");
    await f.apply("TAKI_MEMORY_TIDY_MAX_STEPS", 4);
    expect(f.application.read("TAKI_MEMORY_TIDY_MAX_STEPS")?.state).toBe("applied");
  });

  it("preserves the usable index on failed apply, then cancels superseded preparation before publication", async () => {
    const f = fixture();
    await f.runtime.captureRun("taki");
    for (let index = 0; index < 70; index++) f.runtime.writeMemory({ characterId: "taki", layer: "episodes",
      content: `我 喜欢 拉面 ${index}`, importance: 5, origin: "observed" });
    await f.apply("TAKI_MEMORY_STOPLIST", "invalid");
    expect(f.application.read("TAKI_MEMORY_STOPLIST")).toMatchObject({ state: "failed", activeValue: "on" });
    expect(f.runtime.memory.searchStatus?.().stoplist).toBe(true);
    const pending = f.apply("TAKI_MEMORY_STOPLIST", "off");
    await setImmediate();
    await f.apply("TAKI_MEMORY_STOPLIST", "on");
    await pending;
    expect(f.runtime.memory.searchStatus?.().stoplist).toBe(true);
    expect(f.application.read("TAKI_MEMORY_STOPLIST")).toMatchObject({ state: "applied", activeValue: "on" });
    expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'taki_reindex_%'").all()).toEqual([]);
  });
});

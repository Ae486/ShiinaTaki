import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createCanonicalIngestionSourceRepo } from "../db/canonical-ingestion-source-repo.ts";
import { createMemoryAutoRepo } from "../db/memory-auto-repo.ts";
import { createCompactionOperationRepo } from "../db/compaction-operation-repo.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { scriptedGenerateModel, type ScriptStep } from "../testing/mock-language-model.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { composeMemoryRuntime } from "./runtime-composition.ts";

interface Opened {
  db: Database;
  dataDir: string;
  runtime?: ReturnType<typeof composeMemoryRuntime>;
}

const opened: Opened[] = [];
afterEach(async () => {
  for (const item of opened.splice(0)) {
    await item.runtime?.stop();
    item.db.close();
    rmTempDir(item.dataDir);
  }
  vi.restoreAllMocks();
});

async function boot(canonical: boolean, beforeCompose?: (db: Database) => void, steps?: ScriptStep[]) {
  const dataDir = mkdtempSync(join(tmpdir(), "taki-runtime-composition-"));
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  const openedItem: Opened = { db, dataDir };
  opened.push(openedItem);
  const timeline = createTimelineRepo(db);
  const summaries = createSummaryRepo(db);
  const script: ScriptStep[] = canonical ? [] : [
    { kind: "text", deltas: ["[]"] },
    { kind: "text", deltas: ["legacy rolling summary"] },
  ];
  script.push({ kind: "text", deltas: ["canonical rolling summary"] });
  const model = scriptedGenerateModel(steps ?? script);
  const { logger, records } = createCaptureLogger();
  const epoch = createCanonicalMemoryAuthorityRepo(db).initializeLocalAuthority("2026-08-29T00:00:00.000Z");
  if (canonical) activateMarker(db, epoch.epochId);
  beforeCompose?.(db);
  const runtime = composeMemoryRuntime({
    db,
    dataDir,
    promptDir: join(dataDir, "prompt"),
    model,
    timeline,
    windowStart: () => 1,
    summaries,
    estimatedTokens: () => 90,
    budget: () => 100,
    compact: { triggerRatio: 0.8, keepMessages: 3 },
    env: {},
    logger,
  });
  openedItem.runtime = runtime;
  await runtime.captureRun("taki");
  return { db, timeline, summaries, model, records, runtime, epochId: epoch.epochId };
}

function seed(fixture: Awaited<ReturnType<typeof boot>>, from: number, through: number): void {
  const entries = [];
  for (let seq = from; seq <= through; seq += 1) {
    entries.push(fixture.timeline.append({ characterId: "taki", role: "user", content: `m${seq}` }));
  }
  fixture.runtime.recordPrimaryCommitted({ characterId: "taki", entries });
}

function activateMarker(db: Database, epochId: string): void {
  db.prepare(`UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,
    verified_snapshot_id='snapshot',activation_transaction_id='activation' WHERE singleton=1`).run({ epoch: epochId });
}

describe("provider-independent Compaction composition", () => {
  it("exposes a null operations() accessor outside the Hindsight runtime", async () => {
    const fixture = await boot(true);
    expect(fixture.runtime.operations()).toBeNull();
    expect((await boot(false)).runtime.operations()).toBeNull();
  });
  it("constructs Legacy Compaction in the shared maintenance chain and keeps it detached", async () => {
    const fixture = await boot(false);
    const flush = vi.spyOn(fixture.runtime.selected.legacy!.memoryFlush, "prepareRetirement");
    seed(fixture, 1, 10);

    const completed = fixture.runtime.autoMemory.onTurnCompleted("taki");
    expect(fixture.model.doGenerateCalls).toHaveLength(0);
    await completed;

    expect(fixture.summaries.get("taki")?.throughSeq).toBe(6);
    expect(fixture.model.doGenerateCalls).toHaveLength(2);
    expect(flush).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ characterId: "taki", fromSeq: 1, throughSeq: 6 }));
    expect(createMemoryAutoRepo(fixture.db).get("taki").lastFlushSeq).toBe(6);
    expect(fixture.db.prepare("SELECT kind,flush_status FROM conversation_compaction_events ORDER BY operation_seq").all())
      .toEqual(["started", "flush_completed", "summary_generated", "committed"].map((kind) => ({
        kind, flush_status: kind === "flush_completed" ? "success" : null,
      })));
  });

  it("constructs Canonical Local Compaction before the ordinary ingestion threshold without forcing extraction", async () => {
    const fixture = await boot(true);
    seed(fixture, 1, 10);

    expect(fixture.runtime.autoMemory).toBeDefined();
    await fixture.runtime.autoMemory.onTurnCompleted("taki");

    expect(fixture.summaries.get("taki")?.throughSeq).toBe(6);
    expect(fixture.summaries.get("taki")?.text).toBe("canonical rolling summary");
    expect(fixture.model.doGenerateCalls).toHaveLength(1);
    const sources = createCanonicalIngestionSourceRepo(fixture.db);
    const scope = { epochId: fixture.epochId, characterId: "taki" };
    expect(sources.unprocessedCount(scope)).toBe(10);
    expect(sources.cursor(scope)).toBe(0);
    expect(fixture.db.prepare("SELECT kind FROM conversation_compaction_events ORDER BY operation_seq").all())
      .toEqual(["started", "summary_generated", "committed"].map((kind) => ({ kind })));
  });

  it("commits canonical summaries while the real ingestion journal fails and retains all pending source rows", async () => {
    const fixture = await boot(true);
    seed(fixture, 1, 20);
    fixture.db.exec(`CREATE TRIGGER unavailable_ingestion BEFORE INSERT ON canonical_memory_ingestion_spans
      BEGIN SELECT RAISE(ABORT, 'fixture ingestion storage unavailable'); END;`);
    const raw = fixture.db.prepare("SELECT * FROM timeline_messages ORDER BY seq").all();
    await fixture.runtime.autoMemory.onTurnCompleted("taki");
    expect(fixture.records).toContainEqual(expect.objectContaining({
      obj: expect.objectContaining({ code: "MEMORY_INGESTION_FAILED" }),
    }));
    expect(fixture.summaries.get("taki")?.text).toBe("canonical rolling summary");
    expect(fixture.model.doGenerateCalls).toHaveLength(1);
    const sources = createCanonicalIngestionSourceRepo(fixture.db);
    const scope = { epochId: fixture.epochId, characterId: "taki" };
    expect(sources.unprocessedCount(scope)).toBe(20);
    expect(sources.cursor(scope)).toBe(0);
    expect(fixture.db.prepare("SELECT * FROM timeline_messages ORDER BY seq").all()).toEqual(raw);
    expect(fixture.db.prepare("SELECT kind FROM conversation_compaction_events ORDER BY operation_seq").all())
      .toEqual(["started", "summary_generated", "committed"].map((kind) => ({ kind })));
  });

  it("admits a summary while canonical Write Gate admission is pending outside the shared model slot", async () => {
    const fixture = await boot(true, undefined, [
      { kind: "text", deltas: ["canonical rolling summary"] },
      { kind: "text", deltas: ['{"decision":"skip"}'] },
    ]);
    seed(fixture, 1, 20);
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    const run = fixture.runtime.utility.run.bind(fixture.runtime.utility);
    const scheduling = vi.spyOn(fixture.runtime.utility, "run").mockImplementation(async <T>(label: string, task: () => Promise<T>) => {
      if (label === "canonical-write-gate") await delayed;
      return run(label, task);
    });
    const active = fixture.runtime.autoMemory.onTurnCompleted("taki");
    try {
      await vi.waitFor(() => expect(fixture.summaries.get("taki")?.text).toBe("canonical rolling summary"));
      expect(scheduling.mock.calls.map(([label]) => label)).toEqual(["canonical-write-gate", "compact"]);
      expect(fixture.model.doGenerateCalls).toHaveLength(1);
      expect(fixture.db.prepare("SELECT state FROM canonical_memory_ingestion_spans").get()?.state).toBe("pending");
      expect(createCanonicalIngestionSourceRepo(fixture.db).cursor({ epochId: fixture.epochId, characterId: "taki" })).toBe(0);
    } finally {
      release();
      await active;
    }
    expect(fixture.db.prepare("SELECT state FROM canonical_memory_ingestion_spans").get()?.state).toBe("complete");
    expect(fixture.model.doGenerateCalls).toHaveLength(2);
  });

  it("retires the Legacy maintenance and flush writer after in-process activation", async () => {
    const fixture = await boot(false);
    seed(fixture, 1, 10);
    await fixture.runtime.autoMemory.onTurnCompleted("taki");
    expect(fixture.model.doGenerateCalls).toHaveLength(2);

    activateMarker(fixture.db, fixture.epochId);
    fixture.runtime.selected.bindCanonical(fixture.epochId);
    expect(fixture.runtime.selected.legacy).toBeNull();
    await fixture.runtime.captureRun("taki");
    seed(fixture, 11, 16);
    await fixture.runtime.autoMemory.onTurnCompleted("taki");

    expect(fixture.summaries.get("taki")?.throughSeq).toBeGreaterThan(6);
    expect(fixture.model.doGenerateCalls).toHaveLength(3);
    expect(fixture.summaries.get("taki")?.text).toBe("canonical rolling summary");
    expect(fixture.db.prepare("SELECT count(*) AS count FROM conversation_compaction_events WHERE kind='flush_completed'").get()?.count).toBe(1);
  });

  it("serializes duplicate Canonical triggers so only one summary call runs", async () => {
    const fixture = await boot(true);
    seed(fixture, 1, 10);

    await Promise.all([
      fixture.runtime.autoMemory.onTurnCompleted("taki"),
      fixture.runtime.autoMemory.onTurnCompleted("taki"),
    ]);

    expect(fixture.model.doGenerateCalls).toHaveLength(1);
    expect(fixture.summaries.get("taki")?.throughSeq).toBe(6);
  });

  it("exposes the internal typed cancel/reconcile lifecycle and reconciles expired work at composition", async () => {
    const fixture = await boot(true, (db) => {
      createCompactionOperationRepo(db).begin({
        operationId: "compact:" + "a".repeat(64),
        characterId: "taki",
        reason: "pressure",
        selectedFromSeq: 1,
        selectedThroughSeq: 6,
        capturedTailSeq: 10,
        expectedSummaryRevision: 0,
        expectedSummaryThrough: 0,
        sourceDigest: "b".repeat(64),
        beforeTokens: 90,
        provider: "mock-provider",
        modelId: "mock-model",
        owner: "expired-generation",
        now: "2000-01-01T00:00:00.000Z",
        expiresAt: "2000-01-01T00:10:00.000Z",
      });
    });

    expect(fixture.runtime.compaction.cancel("taki")).toBe(false);
    expect(fixture.runtime.compaction.reconcile()).toBe(0);
    expect(fixture.db.prepare("SELECT state,failure_code FROM conversation_compaction_operations").get()).toEqual({
      state: "abandoned",
      failure_code: "LEASE_EXPIRED",
    });
  });
});

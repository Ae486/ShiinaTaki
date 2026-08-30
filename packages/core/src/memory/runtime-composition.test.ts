import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createCompactionOperationRepo } from "../db/compaction-operation-repo.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { generatingModel } from "../testing/mock-language-model.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { composeMemoryRuntime } from "./runtime-composition.ts";

interface Opened {
  db: Database;
  dataDir: string;
}

const opened: Opened[] = [];
afterEach(() => {
  for (const item of opened.splice(0)) {
    item.db.close();
    rmTempDir(item.dataDir);
  }
});

function boot(canonical: boolean, beforeCompose?: (db: Database) => void) {
  const dataDir = mkdtempSync(join(tmpdir(), "taki-runtime-composition-"));
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  opened.push({ db, dataDir });
  const timeline = createTimelineRepo(db);
  const summaries = createSummaryRepo(db);
  const model = generatingModel("rolling summary");
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
  return { db, timeline, summaries, model, records, runtime, epochId: epoch.epochId };
}

function seed(timeline: ReturnType<typeof createTimelineRepo>, from: number, through: number): void {
  for (let seq = from; seq <= through; seq += 1) {
    timeline.append({ characterId: "taki", role: "user", content: `m${seq}` });
  }
}

function activateMarker(db: Database, epochId: string): void {
  db.prepare(`UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,
    verified_snapshot_id='snapshot',activation_transaction_id='activation' WHERE singleton=1`).run({ epoch: epochId });
}

describe("provider-independent Compaction composition", () => {
  it("constructs Legacy Compaction in the shared maintenance chain and keeps it detached", async () => {
    const fixture = boot(false);
    seed(fixture.timeline, 1, 10);

    const completed = fixture.runtime.autoMemory.onTurnCompleted("taki");
    expect(fixture.model.doGenerateCalls).toHaveLength(0);
    await completed;

    expect(fixture.summaries.get("taki")?.throughSeq).toBe(6);
    expect(fixture.model.doGenerateCalls).toHaveLength(2);
  });

  it("constructs Canonical Local Compaction with an explicit no-flush-required path", async () => {
    const fixture = boot(true);
    seed(fixture.timeline, 1, 10);

    expect(fixture.runtime.autoMemory).toBeDefined();
    await fixture.runtime.autoMemory.onTurnCompleted("taki");

    expect(fixture.summaries.get("taki")?.throughSeq).toBe(6);
    expect(fixture.model.doGenerateCalls).toHaveLength(1);
  });

  it("retires the Legacy maintenance and flush writer after in-process activation", async () => {
    const fixture = boot(false);
    seed(fixture.timeline, 1, 10);
    await fixture.runtime.autoMemory.onTurnCompleted("taki");
    expect(fixture.model.doGenerateCalls).toHaveLength(2);

    activateMarker(fixture.db, fixture.epochId);
    fixture.runtime.selected.bindCanonical(fixture.epochId);
    expect(fixture.runtime.selected.legacy).toBeNull();
    seed(fixture.timeline, 11, 16);
    await fixture.runtime.autoMemory.onTurnCompleted("taki");

    expect(fixture.summaries.get("taki")?.throughSeq).toBeGreaterThan(6);
    expect(fixture.model.doGenerateCalls).toHaveLength(3);
  });

  it("serializes duplicate Canonical triggers so only one summary call runs", async () => {
    const fixture = boot(true);
    seed(fixture.timeline, 1, 10);

    await Promise.all([
      fixture.runtime.autoMemory.onTurnCompleted("taki"),
      fixture.runtime.autoMemory.onTurnCompleted("taki"),
    ]);

    expect(fixture.model.doGenerateCalls).toHaveLength(1);
    expect(fixture.summaries.get("taki")?.throughSeq).toBe(6);
  });

  it("exposes the internal typed cancel/reconcile lifecycle and reconciles expired work at composition", () => {
    const fixture = boot(true, (db) => {
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

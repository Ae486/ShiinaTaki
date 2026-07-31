import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConversationStore } from "../agents/conversation-store.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createCaptureLogger, type CapturedLog } from "../testing/capture-logger.ts";
import { generatingModel } from "../testing/mock-language-model.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createMemorySubsystem, type MemorySubsystem } from "./bootstrap.ts";

const UTILITY_ENV = {
  TAKI_UTILITY_BASE_URL: "https://utility.example.com",
  TAKI_UTILITY_API_KEY: "sk-utility",
  TAKI_UTILITY_MODEL: "cheap-fast-1",
};

const opened: Array<{ db: Database; dir: string }> = [];
afterEach(() => {
  for (const { db, dir } of opened.splice(0)) {
    db.close();
    rmTempDir(dir);
  }
});

function boot(
  env: Record<string, string | undefined> = {},
  modelText = "main",
): {
  subsystem: MemorySubsystem;
  dataDir: string;
  records: CapturedLog[];
  mainModel: ReturnType<typeof generatingModel>;
  db: Database;
} {
  const dataDir = mkdtempSync(join(tmpdir(), "taki-boot-"));
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  opened.push({ db, dir: dataDir });
  const { logger, records } = createCaptureLogger();
  const mainModel = generatingModel(modelText);
  const subsystem = createMemorySubsystem({
    db,
    dataDir,
    promptDir: join(dataDir, "prompt"),
    model: mainModel,
    timeline: createTimelineRepo(db),
    env,
    logger,
  });
  return { subsystem, dataDir, records, mainModel, db };
}

describe("memory subsystem boot wiring (batch 4a extraction)", () => {
  it("reconciles the index at boot and reports it under the memory logger", () => {
    const { records } = boot();

    expect(records).toContainEqual({
      level: "info",
      obj: { upserted: 0, deleted: 0, total: 0, invalid: [] },
      msg: "memory index reconciled from workspace",
    });
  });

  it("places the entry tree beside the db, under the Workspace (invariant 1)", () => {
    const { subsystem, dataDir } = boot();

    expect(subsystem.memoryRoot).toBe(join(dataDir, "workspace", "memory"));
  });

  it("gives background work the MAIN model when no utility slot is configured", () => {
    const { subsystem, mainModel } = boot();

    expect(subsystem.utility.model).toBe(mainModel);
  });

  it("routes background work onto the utility provider when the env configures one", () => {
    const { subsystem, mainModel } = boot(UTILITY_ENV);

    expect(subsystem.utility.model).not.toBe(mainModel);
    expect(subsystem.utility.model).toMatchObject({ modelId: "cheap-fast-1" });
  });

  it("fails the boot on a partial utility slot rather than silently spending on the chat model", () => {
    expect(() => boot({ TAKI_UTILITY_BASE_URL: "https://utility.example.com" })).toThrow(/TAKI_UTILITY_/);
  });

  it("returns a bound write op that lands a real entry file through the engine", () => {
    const { subsystem } = boot();

    const written = subsystem.writeMemory({
      characterId: "taki",
      layer: "episodes",
      content: "一起看了海边的日落",
      importance: 6,
    });

    expect(written.id).toMatch(/^\d{4}-/);
    const rows = subsystem.engine.retention.listActive("episodes");
    expect(rows).toHaveLength(1);
    expect(existsSync(rows[0]!.path)).toBe(true);
  });

  it("runs the background writers on the utility slot's model in the default configuration", async () => {
    // With no utility slot configured the slot resolves to the main model, so an episodic pass must reach THIS mock.
    // It catches a writer wired to some OTHER model (the vision slot, say); the utility-configured case is not
    // asserted here because it would mean a real provider call.
    const { subsystem, db, mainModel } = boot({}, "[]");
    const conversation = createConversationStore({ repo: createTimelineRepo(db) });
    for (let i = 0; i < 20; i += 1) conversation.appendUser("taki", `m${i + 1}`);

    await subsystem.autoMemory.onTurnCompleted("taki");

    expect(mainModel.doGenerateCalls.length).toBeGreaterThan(0);
  });

  it("exposes the tidy pass, wired end-to-end: a clean store answers runNow with zero model calls (batch 4b)", async () => {
    const { subsystem, mainModel } = boot();

    const outcome = await subsystem.tidy.runNow("taki");

    expect(outcome).toMatchObject({ status: "clean", edits: 0, steps: 0 });
    expect(mainModel.doGenerateCalls).toHaveLength(0);
  });
});

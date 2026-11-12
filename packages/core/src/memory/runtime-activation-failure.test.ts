import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Tool, ToolExecutionOptions } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createPrimaryMemoryCustody } from "../db/primary-memory-custody-repo.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { createSearchProjectionPolicyRepo } from "../db/search-projection-policy-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { scriptedGenerateModel } from "../testing/mock-language-model.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import * as canonicalSubsystem from "./canonical-local-subsystem.ts";
import { readMemoryAuthoritySelection } from "./legacy-migration/legacy-activation-repo.ts";
import { createLegacyMigrationRunner, type LegacyMigrationRunner } from "./legacy-migration/legacy-migration-runner.ts";
import { composeMemoryRuntime } from "./runtime-composition.ts";

const opened: Array<{ db: Database; dataDir: string }> = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const fixture of opened.splice(0)) {
    fixture.db.close();
    rmTempDir(fixture.dataDir);
  }
});

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "taki-activation-failure-"));
  const dbPath = join(dataDir, "state.db");
  const db = openDatabase({ path: dbPath, migrations: MIGRATIONS });
  // This fixture starts with an empty derived index under the explicit default tokenizer.
  createSearchProjectionPolicyRepo(db).write({ table: "memory_fts", epochId: null }, true);
  opened.push({ db, dataDir });
  const timeline = createTimelineRepo(db);
  const model = scriptedGenerateModel([]);
  const { logger } = createCaptureLogger();
  const runtime = composeMemoryRuntime({ db, dataDir, promptDir: join(dataDir, "prompt"), model, timeline, bootId: "boot-a",
    windowStart: () => 1, summaries: createSummaryRepo(db), estimatedTokens: () => 90, budget: () => 100,
    compact: { triggerRatio: 0.8, keepMessages: 3 }, env: {}, logger });
  const legacy = runtime.selected.legacy!;
  const entry = runtime.writeMemory({ characterId: "taki", layer: "profile", content: "Synthetic source before cutover", importance: 6 });
  if (entry instanceof Promise) throw new Error("Legacy fixture write unexpectedly became asynchronous");
  const path = legacy.engine.retention.listActive("profile")[0]!.path;
  const heldTools = {
    foreground: legacy.engine.createTools("taki").memory_write!,
    background: legacy.engine.createBackgroundTools("taki").memory_write!,
    archive: legacy.engine.createTools("taki").memory_archive!,
    search: legacy.engine.createTools("taki").memory_search!,
    tidy: legacy.engine.tidy.createTools("taki").memory_set_disclosure!,
    block: legacy.engine.tidy.createTools("taki").block_rethink!,
  };
  const before = readFileSync(path);
  return { db, dbPath, dataDir, runtime, legacy, heldTools, entry, path, before, model, timeline };
}

type Fixture = ReturnType<typeof setup>;
const workspaceOf = (fixture: Fixture) => join(fixture.dataDir, "workspace");
async function prepared(fixture: Fixture, runner: LegacyMigrationRunner, runId: string) {
  const status = await runner.prepare({ runId, workspaceRoot: workspaceOf(fixture), previewId: runner.dryRun(workspaceOf(fixture)).reportId, owner: "test" });
  expect(status.status).toBe("ready");
  expect(runner.verify(runId).verified).toBe(true);
  return () => runner.activate({ runId, workspaceRoot: workspaceOf(fixture), timeoutMs: 1_000, transactionId: `tx-${runId}`, owner: "test" });
}
const options: ToolExecutionOptions<unknown> = { toolCallId: "held-tool", messages: [], context: undefined };
async function execute(tool: Tool, input: unknown) {
  if (!tool.execute) throw new Error("Expected executable legacy tool");
  return await tool.execute(input, options);
}

async function assertRetired(fixture: Fixture) {
  const { runtime, legacy, heldTools, path, entry } = fixture;
  const request = { characterId: "taki", type: "profile", content: "Refused after cutover", importance: 6 };
  expect(() => legacy.engine.writeEntry(request)).toThrow("MEMORY_AUTHORITY_FENCED");
  expect(() => legacy.writeMemory({ ...request, layer: request.type })).toThrow("MEMORY_AUTHORITY_FENCED");
  expect(() => legacy.engine.reconcile()).toThrow("MEMORY_AUTHORITY_FENCED");
  expect(() => legacy.engine.assemble({ characterId: "taki", currentMessage: "query" })).toThrow("MEMORY_AUTHORITY_FENCED");
  expect(() => legacy.engine.retention.archive(path)).toThrow("MEMORY_AUTHORITY_FENCED");
  expect(() => legacy.engine.retention.hardDelete(path)).toThrow("MEMORY_AUTHORITY_FENCED");
  expect(() => legacy.engine.tidy.listActive("taki")).toThrow("MEMORY_AUTHORITY_FENCED");
  await expect(legacy.tidy.maybeRun("taki")).rejects.toThrow("MEMORY_AUTHORITY_FENCED");
  await expect(legacy.tidy.runNow("taki")).rejects.toThrow("MEMORY_AUTHORITY_FENCED");
  await expect(legacy.maintenance.run("taki", "primary")).rejects.toThrow("MEMORY_AUTHORITY_FENCED");
  await expect(legacy.memoryFlush.prepareRetirement({ characterId: "taki", fromSeq: 1, throughSeq: 1, operationId: "retired-flush" }))
    .resolves.toEqual({ status: "retryable_failure", code: "MEMORY_AUTHORITY_FENCED" });
  for (const [tool, input] of [
    [heldTools.foreground, request], [heldTools.background, request],
    [heldTools.archive, { id: entry.id }], [heldTools.search, { query: "Synthetic" }],
    [heldTools.tidy, { id: entry.id, disclosure: "Refused disclosure" }],
    [heldTools.block, { id: "user-model", content: "Refused block" }],
  ] as const) {
    await expect(execute(tool, input)).resolves.toMatchObject({ ok: false, code: "MEMORY_AUTHORITY_FENCED" });
  }
  expect(() => runtime.fence.admitSync(() => "legacy")).toThrow("MEMORY_AUTHORITY_FENCED");
  expect(readFileSync(path)).toEqual(fixture.before);
  expect(readdirSync(join(fixture.dataDir, "workspace", "memory", "global", "profile"))).toHaveLength(1);
  expect(fixture.model.doGenerateCalls).toHaveLength(0);
}

describe("durable activation cannot restore legacy on runtime failure", () => {
  it("retires old references and exposes unavailable canonical runtime when construction fails after commit", async () => {
    const fixture = setup();
    const runner = await fixture.runtime.migrationRunner();
    const activate = await prepared(fixture, runner, "run-constructor");
    const failure = new Error("synthetic canonical constructor failure");
    vi.spyOn(canonicalSubsystem, "createCanonicalLocalSubsystem").mockImplementationOnce(() => { throw failure; });

    await expect(activate()).rejects.toBe(failure);

    expect(readMemoryAuthoritySelection(fixture.db).mode).toBe("canonical-local");
    expect(runner.status("run-constructor")).toMatchObject({ phase: "activated", status: "completed" });
    expect(fixture.runtime.selected.canonical).toBe(true);
    expect(fixture.runtime.selected.legacy).toBeNull();
    expect(fixture.runtime.snapshot().providerId).toBe("local");
    expect(() => fixture.runtime.memory.createTools("taki")).toThrow("MEMORY_INTEGRITY_ERROR");
    expect(() => fixture.runtime.writeMemory({ characterId: "taki", layer: "profile", content: "No fallback", importance: 6 }))
      .toThrow("MEMORY_INTEGRITY_ERROR");
    await expect(fixture.runtime.captureRun("taki")).rejects.toThrow("MEMORY_INTEGRITY_ERROR");
    await assertRetired(fixture);

    const oldFlush = vi.spyOn(fixture.legacy.memoryFlush, "prepareRetirement");
    for (let seq = 1; seq <= 10; seq += 1) {
      fixture.timeline.append({ characterId: "taki", role: "user", content: `Synthetic message ${seq}` });
    }
    await fixture.runtime.compaction.maybeRun("taki");
    expect(oldFlush).not.toHaveBeenCalled();
    expect(fixture.db.prepare("SELECT failure_code FROM conversation_compaction_operations").get()?.failure_code)
      .toBe("MEMORY_FLUSH_FAILED");
    expect(createSummaryRepo(fixture.db).get("taki")).toBeNull();
    expect(fixture.model.doGenerateCalls).toHaveLength(0);

    // Same-epoch explicit recovery: receipt proven, custody reconciled, construction only because the binding is unavailable.
    const epochId = readMemoryAuthoritySelection(fixture.db).epochId!;
    const epochs = () => fixture.db.prepare("SELECT count(*) AS n FROM canonical_memory_authority_epochs").get()?.n;
    const epochCount = epochs();
    expect(fixture.runtime.bindingSnapshot()).toMatchObject({ selection: "canonical-local", selectedEpochId: epochId,
      binding: { kind: "unavailable", epochId }, flush: "failing" });
    expect(() => fixture.runtime.recoverLocalBinding("another-epoch")).toThrow("MEMORY_AUTHORITY_MISMATCH");
    expect(fixture.runtime.recoverLocalBinding(epochId)).toEqual({ binding: "published", reconciledGroups: 0 });
    await fixture.runtime.captureRun("taki");
    expect(fixture.runtime.bindingSnapshot()).toMatchObject({ binding: { kind: "published", epochId }, flush: "available" });
    expect(Object.keys(fixture.runtime.memory.createTools("taki"))).not.toHaveLength(0);
    // A healthy binding still reconciles dead custody on explicit recovery, without reconstructing or re-activating.
    const dead = createPrimaryMemoryCustody({ db: fixture.db, bootId: "boot-dead" }).begin({ characterId: "taki", repo: fixture.timeline });
    const crashed = dead.repo.append({ characterId: "taki", role: "user", content: "crashed before finalize" });
    expect(fixture.runtime.recoverLocalBinding(epochId)).toEqual({ binding: "healthy", reconciledGroups: 1 });
    expect(fixture.db.prepare("SELECT state FROM primary_memory_groups WHERE group_id=:id").get({ id: dead.groupId })?.state).toBe("finalized");
    expect(fixture.db.prepare("SELECT authority_epoch_id FROM canonical_memory_primary_commits WHERE timeline_seq=:seq").get({ seq: crashed.seq })?.authority_epoch_id).toBe(epochId);
    expect(epochs()).toBe(epochCount);
    expect(fixture.db.prepare("SELECT count(*) AS n FROM memory_migration_activation_receipts").get()?.n).toBe(1);
    await assertRetired(fixture);

    const reopened = openDatabase({ path: fixture.dbPath, migrations: MIGRATIONS });
    try {
      expect(readMemoryAuthoritySelection(reopened).mode).toBe("canonical-local");
      expect(reopened.prepare("SELECT count(*) AS n FROM memory_migration_activation_receipts").get()?.n).toBe(1);
      expect(createCanonicalMemoryAuthorityRepo(reopened).activeEpoch().providerId).toBe("local");
    } finally { reopened.close(); }
  });

  it.each(["synchronous", "asynchronous"])("preserves committed marker and permanently fences tools after %s onActivated failure", async (mode) => {
    const fixture = setup();
    const failure = new Error("synthetic activation callback failure");
    const runner = createLegacyMigrationRunner({ db: fixture.db,
      destinationRoot: join(fixture.dataDir, "snapshots"), fence: fixture.runtime.fence,
      onActivated: mode === "synchronous" ? () => { throw failure; } : async () => { await Promise.resolve(); throw failure; } });
    const activate = await prepared(fixture, runner, `run-${mode}`);

    await expect(activate()).rejects.toBe(failure);
    expect(readMemoryAuthoritySelection(fixture.db).mode).toBe("canonical-local");
    expect(runner.status(`run-${mode}`)).toMatchObject({ phase: "activated", status: "completed" });
    await assertRetired(fixture);
  });

  it.each([1, 2])("retires after committed marker read failure even when %i read attempts fail", async (failures) => {
    const fixture = setup();
    const runner = await fixture.runtime.migrationRunner();
    const activate = await prepared(fixture, runner, "run-marker-read");
    const failure = new Error("synthetic post-commit marker read failure");
    const prepare = fixture.db.prepare.bind(fixture.db);
    const marker = "SELECT * FROM memory_authority_selection WHERE singleton=1";
    // A second WAL reader sees only committed rows, so failures are injected strictly after COMMIT: the activation
    // transaction's own integrity read must succeed for the marker to commit at all.
    const observer = new DatabaseSync(fixture.dbPath, { readOnly: true });
    const committed = () => observer.prepare("SELECT 1 FROM memory_migration_activation_receipts WHERE run_id='run-marker-read'").get() !== undefined;
    let remaining = failures;
    vi.spyOn(fixture.db, "prepare").mockImplementation((sql) => {
      if (sql === marker && remaining > 0 && committed()) {
        remaining -= 1;
        throw failure;
      }
      return prepare(sql);
    });

    try {
      await expect(activate()).rejects.toBe(failure);
      expect(fixture.db.prepare("SELECT mode FROM memory_authority_selection WHERE singleton=1").get()?.mode).toBe("canonical-local");
      expect(runner.status("run-marker-read")).toMatchObject({ phase: "activated", status: "completed" });
      await assertRetired(fixture);
      vi.restoreAllMocks();
      expect(readMemoryAuthoritySelection(fixture.db).mode).toBe("canonical-local");
    } finally { observer.close(); }
  });

  it("releases temporary quiescence when the activation transaction rolls back before commit", async () => {
    const fixture = setup();
    const runner = await fixture.runtime.migrationRunner();
    const activate = await prepared(fixture, runner, "run-rollback");
    fixture.db.exec(`CREATE TRIGGER fail_activation_receipt BEFORE INSERT ON memory_migration_activation_receipts
      BEGIN SELECT RAISE(ABORT, 'synthetic receipt failure'); END`);

    await expect(activate()).rejects.toThrow("synthetic receipt failure");
    expect(readMemoryAuthoritySelection(fixture.db).mode).toBe("legacy-markdown");
    expect(fixture.db.prepare("SELECT count(*) AS n FROM memory_migration_activation_receipts").get()?.n).toBe(0);
    expect(fixture.runtime.selected.canonical).toBe(false);
    expect(fixture.runtime.selected.legacy).toBe(fixture.legacy);
    await expect(execute(fixture.heldTools.foreground,
      { type: "profile", content: "Allowed after rollback", importance: 6 })).resolves.toMatchObject({ ok: true });
    expect(fixture.runtime.fence.admitSync(() => "legacy resumed")).toBe("legacy resumed");
  });
});

describe("durable activation binds a usable Local runtime", () => {
  async function recalled(runtime: Fixture["runtime"], query: string): Promise<string[]> {
    const result = await runtime.memory.createTools("taki").recall!.execute!({ query, scope: "both", limit: 8, maxTokens: 1024 }, options as never) as
      { ok: boolean; data?: { hits: Array<{ record: { unit: { text: string } } }> } };
    expect(result.ok).toBe(true);
    return (result.data?.hits ?? []).map((hit) => hit.record.unit.text);
  }

  it("recalls migrated and freshly retained memory through the published binding, and again after reopening", async () => {
    const fixture = setup();
    const runner = await fixture.runtime.migrationRunner();
    const activate = await prepared(fixture, runner, "run-usable");
    await expect(activate()).resolves.toMatchObject({ activated: true, mode: "canonical-local" });
    await fixture.runtime.captureRun("taki");
    expect(fixture.runtime.bindingSnapshot()).toMatchObject({ selection: "canonical-local", binding: { kind: "published" }, flush: "available" });
    await fixture.runtime.writeMemory({ characterId: "taki", layer: "profile", content: "Retained after cutover", importance: 6, origin: "observed" });
    expect((await recalled(fixture.runtime, "Synthetic source")).some((text) => text.includes("Synthetic source before cutover"))).toBe(true);
    expect((await recalled(fixture.runtime, "Retained after cutover")).some((text) => text.includes("Retained after cutover"))).toBe(true);
    await assertRetired(fixture);
    expect(fixture.model.doGenerateCalls).toHaveLength(0);
    await fixture.runtime.stop();

    // A fresh process composes from the committed marker alone: no activation, the same epoch, both memories still recallable.
    const reopened = openDatabase({ path: fixture.dbPath, migrations: MIGRATIONS });
    const runtime = composeMemoryRuntime({ db: reopened, dataDir: fixture.dataDir, promptDir: join(fixture.dataDir, "prompt"), model: fixture.model,
      timeline: createTimelineRepo(reopened), bootId: "boot-b", windowStart: () => 1, summaries: createSummaryRepo(reopened), estimatedTokens: () => 90,
      budget: () => 100, compact: { triggerRatio: 0.8, keepMessages: 3 }, env: {}, logger: createCaptureLogger().logger });
    try {
      expect(runtime.selected.canonical).toBe(true);
      expect(runtime.bindingSnapshot()).toMatchObject({ binding: { kind: "published", epochId: readMemoryAuthoritySelection(reopened).epochId }, flush: "available" });
      expect((await recalled(runtime, "Synthetic source")).some((text) => text.includes("Synthetic source before cutover"))).toBe(true);
      expect((await recalled(runtime, "Retained after cutover")).some((text) => text.includes("Retained after cutover"))).toBe(true);
      expect(reopened.prepare("SELECT count(*) AS n FROM memory_migration_activation_receipts").get()?.n).toBe(1);
    } finally {
      await runtime.stop();
      reopened.close();
    }
  });
});

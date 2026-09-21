import { afterEach, describe, expect, it } from "vitest";
import { readMemoryAuthoritySelection } from "./legacy-activation-repo.ts";
import { cleanupLegacyMigrationFixtures, createLegacyMigrationFixture, legacyEntry, PROFILE_ENTRY } from "./legacy-migration-fixture.ts";
import { createMemoryAuthorityFence } from "./memory-authority-fence.ts";

afterEach(cleanupLegacyMigrationFixtures);

const count = (db: { prepare: (sql: string) => { get: (params?: Record<string, string>) => Record<string, unknown> | undefined } }, sql: string, params?: Record<string, string>) =>
  Number(db.prepare(sql).get(params)?.n);

describe("legacy migration runner and fence", () => {
  it("dry-run produces a bounded report without ledger or snapshot writes", () => {
    const f = createLegacyMigrationFixture();
    const report = f.runner.dryRun(f.workspace);
    expect(report.sourceCount).toBe(1); expect(report.plannedOne).toBe(1);
    expect(count(f.db, "SELECT count(*) AS n FROM memory_migration_runs")).toBe(0);
    expect(count(f.db, "SELECT count(*) AS n FROM memory_authority_selection WHERE mode='legacy-markdown'")).toBe(1);
  });

  it("prepares, verifies and exposes exact source identity without changing it on resume", async () => {
    const f = createLegacyMigrationFixture();
    const prepared = await f.prepare();
    expect(prepared).toMatchObject({ runId: "run-1", status: "ready", sourceCount: 1, resolvedCount: 1, blockingCount: 0 });
    expect(f.runner.verify("run-1").verified).toBe(true);
    const source = f.db.prepare("SELECT source_id,normalized_hash FROM memory_migration_sources WHERE run_id='run-1'").get();
    expect(String(source?.source_id)).toMatch(/^sha256:/); expect(String(source?.normalized_hash)).toMatch(/^sha256:/);
    expect(f.runner.exceptions({ runId: "run-1", cursor: null, limit: 10 }).items).toHaveLength(0);
    expect(count(f.db, "SELECT count(*) AS n FROM canonical_memory_banks")).toBe(2);
    const resumed = await f.runner.resumePreparation({ runId: "run-1", owner: "test" });
    expect(resumed.status).toBe("ready");
    expect(f.db.prepare("SELECT source_id FROM memory_migration_sources WHERE run_id='run-1'").get()?.source_id).toBe(source?.source_id);
    expect(count(f.db, "SELECT count(*) AS n FROM canonical_memory_units")).toBe(1);
  });

  it("refuses a stale preview whose bytes no longer match the live workspace", async () => {
    const f = createLegacyMigrationFixture();
    const stale = f.previewId();
    f.write(PROFILE_ENTRY, legacyEntry("edited after preview"));
    await expect(f.prepare({ previewId: stale })).rejects.toThrow("SNAPSHOT_CHANGED");
    expect(count(f.db, "SELECT count(*) AS n FROM memory_migration_runs")).toBe(0);
    expect(count(f.db, "SELECT count(*) AS n FROM canonical_memory_authority_epochs")).toBe(0);
  });

  it("blocks activation when a staged canonical result is missing and retracts stale readiness", async () => {
    const f = createLegacyMigrationFixture();
    await f.prepare();
    f.db.exec("DELETE FROM canonical_memory_fts; DELETE FROM canonical_memory_policy; DELETE FROM canonical_memory_units");
    const verified = f.runner.verify("run-1");
    expect(verified.verified).toBe(false); expect(verified.blockingCount).toBeGreaterThan(0);
    expect(f.runner.status("run-1").status).toBe("ready");
    await expect(f.activate("run-1")).rejects.toThrow("MIGRATION_NOT_READY");
    expect(f.runner.status("run-1").status).toBe("running");
    expect(readMemoryAuthoritySelection(f.db).mode).toBe("legacy-markdown");
  });

  it("blocks verification when the candidate epoch carries an effect no source produced", async () => {
    const f = createLegacyMigrationFixture();
    await f.prepare();
    const epoch = String(f.db.prepare("SELECT epoch_id FROM memory_migration_runs WHERE run_id='run-1'").get()?.epoch_id);
    f.db.prepare(`INSERT INTO canonical_memory_operation_receipts (authority_epoch_id,request_id,operation,request_hash,result_json,created_at)
      VALUES (:epoch,'foreign-request','retain',:hash,'{}','2026-08-20T00:00:00.000Z')`).run({ epoch, hash: "f".repeat(64) });
    expect(f.runner.verify("run-1")).toMatchObject({ verified: false, blockingCount: 1, readinessDigest: null });
  });

  it("activates only after verification, persists the marker atomically and keeps the completed run immutable", async () => {
    const f = createLegacyMigrationFixture();
    await f.prepare();
    const activated = await f.activate("run-1");
    expect(activated).toMatchObject({ activated: true, mode: "canonical-local" });
    expect(readMemoryAuthoritySelection(f.db)).toMatchObject({ mode: "canonical-local", transactionId: "tx-run-1", epochId: activated.epochId });
    expect(f.runner.status("run-1")).toMatchObject({ phase: "activated", status: "completed" });
    f.db.exec("DELETE FROM canonical_memory_fts; DELETE FROM canonical_memory_policy; DELETE FROM canonical_memory_units");
    expect(f.runner.verify("run-1")).toMatchObject({ verified: true, blockingCount: 0 });
    expect(f.runner.status("run-1")).toMatchObject({ phase: "activated", status: "completed" });
    // The retired fence refuses a second activation before the runner can even inspect the completed run.
    await expect(f.activate("run-1")).rejects.toThrow("MEMORY_AUTHORITY_FENCED");
    expect(() => f.runner.exclude({ runId: "run-1", sourceId: "any", reason: "late", actor: "test" })).toThrow("MIGRATION_SOURCE_RESOLVED");
    expect(count(f.db, "SELECT count(*) AS n FROM memory_migration_activation_receipts")).toBe(1);
  });

  it("fence drains active work, rejects new admissions, and recovers after quiescence", async () => {
    const fence = createMemoryAuthorityFence(); let release: () => void = () => undefined; const held = new Promise<void>((resolve) => { release = resolve; });
    const active = fence.admit(() => held); const activation = fence.quiesce({ timeoutMs: 1000 }, async () => "activated"); release(); expect(await active).toBeUndefined(); expect(await activation).toBe("activated");
    await expect(fence.quiesce({ timeoutMs: 10 }, async () => { await Promise.resolve(); return "ok"; })).resolves.toBe("ok");
  });

  it("keeps legacy admissions retired after a successful activation transaction", async () => {
    const fence = createMemoryAuthorityFence(); await fence.quiesce({ timeoutMs: 100, retireOnSuccess: true }, async () => "committed");
    expect(() => fence.admitSync(() => "legacy")).toThrow("MEMORY_AUTHORITY_FENCED");
  });
});

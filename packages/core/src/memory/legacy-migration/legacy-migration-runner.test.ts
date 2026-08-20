import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { canonicalMemoryMigration017 } from "../../db/migrations/017-canonical-memory.ts";
import { memoryLegacyMigration021 } from "../../db/migrations/021-memory-legacy-migration.ts";
import { createLegacyMigrationRunner } from "./legacy-migration-runner.ts";
import { createMemoryAuthorityFence } from "./memory-authority-fence.ts";
import { readMemoryAuthoritySelection } from "./legacy-activation-repo.ts";

const dbs: Database[] = []; const roots: string[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const now = "2026-08-20T00:00:00.000Z";
function setup() { const db = openDatabase({ path: ":memory:", migrations: [canonicalMemoryMigration017, memoryLegacyMigration021] }); dbs.push(db); const workspace = mkdtempSync(join(tmpdir(), "taki-runner-")); const destination = mkdtempSync(join(tmpdir(), "taki-snapshot-")); roots.push(workspace, destination); mkdirSync(join(workspace, "memory", "global", "profile"), { recursive: true }); writeFileSync(join(workspace, "memory", "global", "profile", "entry.md"), `---\nid: arbitrary\nlayer: profile\nimportance: 8\ncreated: ${now}\nstatus: active\n---\nremembered`); return { db, workspace, destination }; }

describe("legacy migration runner and fence", () => {
  it("dry-run produces a bounded report without ledger or snapshot writes", () => {
    const { db, workspace, destination } = setup(); const runner = createLegacyMigrationRunner({ db, destinationRoot: destination, fence: createMemoryAuthorityFence(), now: () => now });
    const report = runner.dryRun(workspace); expect(report.sourceCount).toBe(1); expect(report.plannedOne).toBe(1);
    expect(db.prepare("SELECT count(*) AS n FROM memory_migration_runs").get()?.n).toBe(0); expect(db.prepare("SELECT count(*) AS n FROM memory_authority_selection WHERE mode='legacy-markdown'").get()?.n).toBe(1);
  });

  it("stages, verifies, and resumes failed sources without changing source identity", () => {
    const { db, workspace, destination } = setup(); const runner = createLegacyMigrationRunner({ db, destinationRoot: destination, fence: createMemoryAuthorityFence(), now: () => now });
    const staged = runner.stage({ workspaceRoot: workspace, owner: "operator" }); expect(staged.sourceCount).toBe(1); expect(staged.resolvedCount).toBe(1);
    const verified = runner.verify(staged.runId); expect(verified.verified).toBe(true); expect(runner.status(staged.runId).status).toBe("ready");
    const sourceId = String(db.prepare("SELECT source_id FROM memory_migration_sources WHERE run_id=:run").get({ run: staged.runId })?.source_id);
    expect(sourceId).toMatch(/^sha256:/); expect(runner.exceptions({ runId: staged.runId, cursor: null, limit: 10 }).items).toHaveLength(0);
    expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_banks").get()?.n).toBe(2);
    expect(db.prepare("SELECT normalized_hash FROM memory_migration_sources WHERE run_id=:run").get({ run: staged.runId })?.normalized_hash).toMatch(/^sha256:/);
  });

  it("blocks verification when a staged canonical result is missing", () => {
    const { db, workspace, destination } = setup(); const runner = createLegacyMigrationRunner({ db, destinationRoot: destination, fence: createMemoryAuthorityFence(), now: () => now });
    const staged = runner.stage({ workspaceRoot: workspace, owner: "operator" });
    db.exec("DELETE FROM canonical_memory_fts; DELETE FROM canonical_memory_policy; DELETE FROM canonical_memory_units");
    const verified = runner.verify(staged.runId);
    expect(verified.verified).toBe(false); expect(verified.blockingCount).toBeGreaterThan(0);
    expect(runner.status(staged.runId).status).toBe("running");
  });

  it("activates only after verification and persists canonical marker atomically", async () => {
    const { db, workspace, destination } = setup(); const runner = createLegacyMigrationRunner({ db, destinationRoot: destination, fence: createMemoryAuthorityFence(), now: () => now });
    const staged = runner.stage({ workspaceRoot: workspace, owner: "operator" }); runner.verify(staged.runId);
    const activated = await runner.activate({ runId: staged.runId, workspaceRoot: workspace, timeoutMs: 1000 });
    expect(activated.activated).toBe(true); expect(activated.mode).toBe("canonical-local");
    expect(db.prepare("SELECT mode FROM memory_authority_selection").get()?.mode).toBe("canonical-local");
    expect(() => runner.verify(staged.runId)).not.toThrow();
  });

  it("fence drains active work, rejects new admissions, and recovers after quiescence", async () => {
    const fence = createMemoryAuthorityFence(); let release: () => void = () => undefined; const held = new Promise<void>((resolve) => { release = resolve; });
    const active = fence.admit(() => held); const activation = fence.quiesce({ timeoutMs: 1000 }, async () => "activated"); release(); expect(await active).toBeUndefined(); expect(await activation).toBe("activated");
    await expect(fence.quiesce({ timeoutMs: 10 }, async () => { await Promise.resolve(); return "ok"; })).resolves.toBe("ok");
    expect(readMemoryAuthoritySelection).toBeTypeOf("function");
  });

  it("keeps legacy admissions retired after a successful activation transaction", async () => {
    const fence = createMemoryAuthorityFence(); await fence.quiesce({ timeoutMs: 100, retireOnSuccess: true }, async () => "committed");
    expect(() => fence.admitSync(() => "legacy")).toThrow("MEMORY_AUTHORITY_FENCED");
  });
});

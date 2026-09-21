import { afterEach, describe, expect, it } from "vitest";
import { cleanupLegacyMigrationFixtures, createLegacyMigrationFixture, legacyEntry, PROFILE_ENTRY, type LegacyMigrationFixture } from "./legacy-migration-fixture.ts";

afterEach(cleanupLegacyMigrationFixtures);

const SECOND_ENTRY = "memory/global/profile/second.md";
const entries = { [PROFILE_ENTRY]: legacyEntry("first"), [SECOND_ENTRY]: legacyEntry("second", { id: "second" }) };
const count = (f: LegacyMigrationFixture, table: string) => Number(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);

describe("legacy source staging", () => {
  it("commits each source atomically: a failed import leaves no partial rows and saves evidence after rollback", async () => {
    const f = createLegacyMigrationFixture({ entries });
    f.db.exec("CREATE TRIGGER fail_proof BEFORE INSERT ON memory_migration_source_proofs BEGIN SELECT RAISE(ABORT, 'synthetic proof failure'); END");
    const prepared = await f.prepare();
    expect(prepared).toMatchObject({ status: "running", sourceCount: 2, resolvedCount: 0, blockingCount: 2 });

    for (const table of ["canonical_memory_sources", "canonical_memory_units", "canonical_memory_operation_receipts", "memory_migration_results", "memory_migration_source_proofs"]) {
      expect(count(f, table), table).toBe(0);
    }
    const rows = f.db.prepare("SELECT disposition,diagnostic_code,canonical_source_id,operation_id,content_hash FROM memory_migration_sources WHERE run_id='run-1'").all();
    expect(rows).toEqual([
      { disposition: "failed", diagnostic_code: "INTEGRITY_MISMATCH", canonical_source_id: null, operation_id: null, content_hash: null },
      { disposition: "failed", diagnostic_code: "INTEGRITY_MISMATCH", canonical_source_id: null, operation_id: null, content_hash: null },
    ]);
    expect(f.db.prepare("SELECT count(*) AS n FROM memory_migration_attempts WHERE finished_at IS NOT NULL AND diagnostic_code='INTEGRITY_MISMATCH'").get()?.n).toBe(2);
    expect(f.runner.exceptions({ runId: "run-1", cursor: null, limit: 10 }).items.map((item) => item.code)).toEqual(["INTEGRITY_MISMATCH", "INTEGRITY_MISMATCH"]);

    f.db.exec("DROP TRIGGER fail_proof");
    const resumed = await f.runner.resumePreparation({ runId: "run-1", owner: "test" });
    expect(resumed).toMatchObject({ status: "ready", resolvedCount: 2, blockingCount: 0 });
    expect(count(f, "canonical_memory_units")).toBe(2);
    expect(count(f, "memory_migration_source_proofs")).toBe(2);
    expect(count(f, "memory_migration_attempts")).toBe(4);
    expect(f.runner.verify("run-1").verified).toBe(true);
  });

  it("records an unsupported source as a durable exception without treating it as excluded", async () => {
    const f = createLegacyMigrationFixture({ entries: { ...entries, [SECOND_ENTRY]: "---\nid: a\nid: b\n---\nx" } });
    const prepared = await f.prepare();
    expect(prepared).toMatchObject({ status: "running", sourceCount: 2, resolvedCount: 1, blockingCount: 1 });
    const page = f.runner.exceptions({ runId: "run-1", cursor: null, limit: 10 });
    expect(page.items).toEqual([{ sourceId: expect.stringMatching(/^sha256:/), code: "DUPLICATE_FRONTMATTER_KEY", relativePath: "entries/global/profile/second.md" }]);
    expect(page.nextCursor).toBeNull();
    expect(count(f, "memory_migration_exclusions")).toBe(0);
    expect(f.runner.verify("run-1")).toMatchObject({ verified: false, blockingCount: 1 });
    await expect(f.activate("run-1")).rejects.toThrow("MIGRATION_NOT_READY");
  });
});

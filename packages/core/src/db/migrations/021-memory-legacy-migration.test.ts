import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { createLegacyMigrationLedgerRepo } from "../../memory/legacy-migration/legacy-migration-ledger-repo.ts";
import { memoryLegacyMigration021 } from "./021-memory-legacy-migration.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
function open(): Database { const db = openDatabase({ path: ":memory:", migrations: [memoryLegacyMigration021] }); dbs.push(db); return db; }
const now = "2026-08-20T00:00:00.000Z";

describe("memoryLegacyMigration021", () => {
  it("installs a fail-closed legacy-default marker and durable ledger tables", () => {
    const db = open();
    expect(db.prepare("SELECT mode FROM memory_authority_selection WHERE singleton=1").get()?.mode).toBe("legacy-markdown");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='memory_migration_results'").get()?.name).toBe("memory_migration_results");
    expect(() => db.exec("DELETE FROM memory_authority_selection; INSERT INTO memory_authority_selection VALUES (1,'canonical-local',NULL,NULL,NULL,'x')")).toThrow();
  });

  it("records zero/one/many results and rejects stale lease owners", () => {
    const db = open(); const repo = createLegacyMigrationLedgerRepo(db);
    repo.createRun({ runId: "run", snapshotId: "snapshot", epochId: null, now });
    const lease1 = repo.acquireLease({ runId: "run", owner: "a", now, expiresAt: "2026-08-20T00:10:00.000Z" });
    repo.addSource({ runId: "run", sourceId: "s0", kind: "entry", relativePath: "entries/global/profile/a.md", rawSha256: "a".repeat(64), byteLength: 1, now });
    repo.setResults({ lease: lease1, sourceId: "s0", results: [], now: "2026-08-20T00:01:00.000Z" });
    expect(repo.source("run", "s0")?.disposition).toBe("converted-zero");
    const lease2 = repo.acquireLease({ runId: "run", owner: "b", now: "2026-08-20T00:11:00.000Z", expiresAt: "2026-08-20T00:20:00.000Z" });
    expect(lease2.fence).toBe(2);
    expect(() => repo.setResults({ lease: lease1, sourceId: "s0", results: [], now: "2026-08-20T00:12:00.000Z" })).toThrow("LEASE_LOST");
  });

  it("persists bounded attempts and source-scoped exclusions", () => {
    const db = open(); const repo = createLegacyMigrationLedgerRepo(db);
    repo.createRun({ runId: "run", snapshotId: "snap", epochId: null, now });
    const lease = repo.acquireLease({ runId: "run", owner: "operator", now, expiresAt: "2026-08-20T01:00:00.000Z" });
    repo.addSource({ runId: "run", sourceId: "source", kind: "block", relativePath: "blocks/global/user-card.md", rawSha256: "b".repeat(64), byteLength: 2, now });
    const attempt = repo.beginAttempt({ lease, sourceId: "source", phase: "normalize", now });
    repo.finishAttempt({ lease, sourceId: "source", attemptNo: attempt, now, diagnostic: { code: "UNKNOWN_BLOCK", detail: "x".repeat(800) } });
    repo.exclude({ lease, sourceId: "source", reason: "operator reviewed unsupported evidence", actor: "owner", now });
    expect(repo.source("run", "source")?.disposition).toBe("excluded");
    expect(String(db.prepare("SELECT diagnostic_detail FROM memory_migration_attempts").get()?.diagnostic_detail).length).toBe(512);
  });
});

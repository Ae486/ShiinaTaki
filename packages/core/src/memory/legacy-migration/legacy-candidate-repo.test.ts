import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import { readMemoryAuthoritySelection } from "./legacy-activation-repo.ts";
import { readMigrationRun } from "./legacy-candidate-repo.ts";
import { cleanupLegacyMigrationFixtures, createLegacyMigrationFixture, GLOBAL_BLOCK, legacyEntry, PROFILE_ENTRY, type LegacyMigrationFixture } from "./legacy-migration-fixture.ts";
import { createLegacyMigrationLedgerRepo } from "./legacy-migration-ledger-repo.ts";

afterEach(cleanupLegacyMigrationFixtures);

const SECOND_ENTRY = "memory/global/profile/second.md";
const twoEntries = { [PROFILE_ENTRY]: legacyEntry("first"), [SECOND_ENTRY]: legacyEntry("second", { id: "second" }) };
const sources = (f: LegacyMigrationFixture, runId: string) =>
  f.db.prepare("SELECT source_id,disposition,raw_sha256 FROM memory_migration_sources WHERE run_id=:run ORDER BY source_id").all({ run: runId });

describe("legacy candidate inventory", () => {
  it("registers the complete manifest inventory before any source is converted", async () => {
    const f = createLegacyMigrationFixture({ entries: twoEntries });
    await expect(f.prepare({ stopRequested: () => true })).rejects.toThrow("MIGRATION_INTERRUPTED");
    expect(sources(f, "run-1").map((row) => row.disposition)).toEqual(["pending", "pending"]);
    expect(f.db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()?.n).toBe(0);
    expect(f.db.prepare("SELECT lease_owner FROM memory_migration_runs WHERE run_id='run-1'").get()?.lease_owner).toBeNull();
  });

  it("resume fills an inventory that lost a manifest source and converts every source exactly once", async () => {
    const f = createLegacyMigrationFixture({ entries: twoEntries });
    await expect(f.prepare({ stopRequested: () => true })).rejects.toThrow("MIGRATION_INTERRUPTED");
    const lost = String(sources(f, "run-1")[0]?.source_id);
    f.db.prepare("DELETE FROM memory_migration_sources WHERE run_id='run-1' AND source_id=:source").run({ source: lost });
    expect(sources(f, "run-1")).toHaveLength(1);
    const resumed = await f.runner.resumePreparation({ runId: "run-1", owner: "test" });
    expect(resumed).toMatchObject({ status: "ready", sourceCount: 2, resolvedCount: 2, blockingCount: 0 });
    expect(sources(f, "run-1").map((row) => row.source_id)).toContain(lost);
    expect(f.db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()?.n).toBe(2);
    expect(f.db.prepare("SELECT count(*) AS n FROM memory_migration_attempts").get()?.n).toBe(2);
  });

  it("resume and verification reject an inventory row that contradicts the preserved manifest", async () => {
    const f = createLegacyMigrationFixture({ entries: twoEntries });
    await f.prepare();
    f.db.prepare("UPDATE memory_migration_sources SET raw_sha256=:hash WHERE run_id='run-1' AND source_id=:source")
      .run({ hash: "0".repeat(64), source: String(sources(f, "run-1")[0]?.source_id) });
    await expect(f.runner.resumePreparation({ runId: "run-1", owner: "test" })).rejects.toThrow("INTEGRITY_MISMATCH");
    expect(f.runner.verify("run-1")).toMatchObject({ verified: false, manifestDigest: null });
    await expect(f.activate("run-1")).rejects.toThrow("MIGRATION_NOT_READY");
    expect(readMemoryAuthoritySelection(f.db).mode).toBe("legacy-markdown");
  });

  it("resume refuses preserved snapshot evidence that was altered on disk", async () => {
    const f = createLegacyMigrationFixture();
    await expect(f.prepare({ stopRequested: () => true })).rejects.toThrow("MIGRATION_INTERRUPTED");
    const snapshotId = String(f.db.prepare("SELECT snapshot_id FROM memory_migration_runs WHERE run_id='run-1'").get()?.snapshot_id);
    writeFileSync(join(f.destination, snapshotId.replace(":", "-"), "entries", "global", "profile", "entry.md"), "tampered");
    await expect(f.runner.resumePreparation({ runId: "run-1", owner: "test" })).rejects.toThrow("INTEGRITY_MISMATCH");
    expect(sources(f, "run-1").map((row) => row.disposition)).toEqual(["pending"]);
    expect(f.db.prepare("SELECT lease_owner FROM memory_migration_runs WHERE run_id='run-1'").get()?.lease_owner).toBeNull();
  });
});

describe("legacy replacement candidate", () => {
  it("replaces a stale candidate in an isolated epoch and refuses every mutation against the superseded run", async () => {
    const f = createLegacyMigrationFixture();
    await f.prepare();
    const oldEpoch = String(readMigrationRun(f.db, "run-1")?.epoch_id);
    f.write(PROFILE_ENTRY, legacyEntry("changed after preparation"));
    await expect(f.prepare({ runId: "run-2" })).rejects.toThrow("MIGRATION_CANDIDATE_CONFLICT");
    await expect(f.prepare({ runId: "run-2", replaceRunId: "missing" })).rejects.toThrow("MIGRATION_CANDIDATE_CONFLICT");
    const replaced = await f.prepare({ runId: "run-2", replaceRunId: "run-1" });
    expect(replaced).toMatchObject({ runId: "run-2", status: "ready", resolvedCount: 1 });

    const newEpoch = String(readMigrationRun(f.db, "run-2")?.epoch_id);
    expect(newEpoch).not.toBe(oldEpoch);
    expect(readMigrationRun(f.db, "run-1")).toMatchObject({ status: "failed", superseded_by_run_id: "run-2" });
    expect(f.db.prepare("SELECT status FROM canonical_memory_authority_epochs WHERE epoch_id=:e").get({ e: oldEpoch })?.status).toBe("closed");
    expect(createCanonicalMemoryAuthorityRepo(f.db).activeEpoch().epochId).toBe(newEpoch);
    expect(f.db.prepare("SELECT count(*) AS n FROM canonical_memory_units WHERE authority_epoch_id=:e").get({ e: oldEpoch })?.n).toBe(1);
    expect(readMemoryAuthoritySelection(f.db).mode).toBe("legacy-markdown");

    await expect(f.runner.resumePreparation({ runId: "run-1", owner: "test" })).rejects.toThrow("MIGRATION_SUPERSEDED");
    expect(() => f.runner.exclude({ runId: "run-1", sourceId: "any", reason: "late", actor: "test" })).toThrow("MIGRATION_SUPERSEDED");
    await expect(f.activate("run-1")).rejects.toThrow("MIGRATION_SUPERSEDED");
    expect(() => f.runner.verify("run-1")).toThrow("MIGRATION_SUPERSEDED");
    expect(readMemoryAuthoritySelection(f.db).mode).toBe("legacy-markdown");

    const activated = await f.activate("run-2");
    expect(activated).toMatchObject({ activated: true, epochId: newEpoch });
    expect(f.db.prepare("SELECT count(*) AS n FROM memory_migration_activation_receipts").get()?.n).toBe(1);
  });

  it("refuses to replace a raw pre-S2a run whose Blocks were published globally", async () => {
    const f = createLegacyMigrationFixture({ entries: { [GLOBAL_BLOCK]: "Known user" } });
    const epoch = createCanonicalMemoryAuthorityRepo(f.db).initializeLocalAuthority(f.clock.now).epochId;
    const ledger = createLegacyMigrationLedgerRepo(f.db);
    ledger.createRun({ runId: "raw-run", snapshotId: "sha256:raw", epochId: epoch, now: f.clock.now });
    ledger.addSource({ runId: "raw-run", sourceId: "sha256:block", kind: "block", relativePath: "blocks/global/user-card.md", rawSha256: "a".repeat(64), byteLength: 4, now: f.clock.now });
    f.db.prepare("UPDATE memory_migration_sources SET disposition='converted-zero' WHERE run_id='raw-run'").run();
    await expect(f.prepare({ runId: "run-2", replaceRunId: "raw-run" })).rejects.toThrow("INTEGRITY_MISMATCH");
    expect(readMigrationRun(f.db, "raw-run")).toMatchObject({ status: "running", superseded_by_run_id: null });
    expect(f.db.prepare("SELECT count(*) AS n FROM memory_migration_runs").get()?.n).toBe(1);
  });
});

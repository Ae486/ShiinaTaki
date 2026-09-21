import { afterEach, describe, expect, it } from "vitest";
import { readMemoryAuthoritySelection } from "./legacy-activation-repo.ts";
import { cleanupLegacyMigrationFixtures, createLegacyMigrationFixture, legacyEntry, PROFILE_ENTRY, type LegacyMigrationFixture } from "./legacy-migration-fixture.ts";
import { createLegacyMigrationLedgerRepo } from "./legacy-migration-ledger-repo.ts";

afterEach(cleanupLegacyMigrationFixtures);

const BAD_ENTRY = "memory/global/profile/unsupported.md";
const entries = { [PROFILE_ENTRY]: legacyEntry("supported"), [BAD_ENTRY]: "---\nid: a\nid: b\n---\nx" };

async function preparedWithException() {
  const f = createLegacyMigrationFixture({ entries });
  expect(await f.prepare()).toMatchObject({ status: "running", blockingCount: 1 });
  const rows = f.db.prepare("SELECT source_id,disposition FROM memory_migration_sources WHERE run_id='run-1'").all();
  const bad = String(rows.find((row) => row.disposition === "failed")?.source_id);
  const good = String(rows.find((row) => row.disposition === "converted-one")?.source_id);
  return { f, bad, good };
}
const exclude = (f: LegacyMigrationFixture, sourceId: string, overrides: Partial<{ runId: string; reason: string; actor: string }> = {}) =>
  f.runner.exclude({ runId: "run-1", sourceId, reason: "unsupported frontmatter", actor: "owner-device", ...overrides });
const receipts = (f: LegacyMigrationFixture) => f.db.prepare("SELECT source_id,reason,operator_actor,snapshot_id FROM memory_migration_exclusions").all();

describe("legacy source exclusion", () => {
  it("records an explicit auditable exclusion, is idempotent on the exact receipt and invalidates readiness", async () => {
    const { f, bad } = await preparedWithException();
    const status = exclude(f, bad);
    expect(status).toMatchObject({ status: "running", resolvedCount: 2, blockingCount: 0 });
    expect(receipts(f)).toEqual([{ source_id: bad, reason: "unsupported frontmatter", operator_actor: "owner-device", snapshot_id: expect.stringMatching(/^sha256:/) }]);
    expect(exclude(f, bad)).toEqual(status);
    expect(receipts(f)).toHaveLength(1);
    expect(f.runner.exceptions({ runId: "run-1", cursor: null, limit: 10 }).items).toHaveLength(0);
    expect(f.db.prepare("SELECT readiness_digest,lease_owner FROM memory_migration_runs WHERE run_id='run-1'").get()).toEqual({ readiness_digest: null, lease_owner: null });

    expect((await f.runner.resumePreparation({ runId: "run-1", owner: "test" })).status).toBe("ready");
    expect(f.runner.verify("run-1").verified).toBe(true);
    f.db.prepare("UPDATE memory_migration_exclusions SET operator_actor='' WHERE source_id=:s").run({ s: bad });
    expect(f.runner.verify("run-1")).toMatchObject({ verified: false, blockingCount: 1 });
  });

  it("conflicts on a changed audit identity and refuses sources that already committed import effects", async () => {
    const { f, bad, good } = await preparedWithException();
    exclude(f, bad);
    expect(() => exclude(f, bad, { reason: "different reason" })).toThrow("MIGRATION_EXCLUSION_CONFLICT");
    expect(() => exclude(f, bad, { actor: "other-device" })).toThrow("MIGRATION_EXCLUSION_CONFLICT");
    expect(() => exclude(f, good)).toThrow("MIGRATION_SOURCE_RESOLVED");
    f.db.prepare("UPDATE memory_migration_sources SET disposition='failed' WHERE source_id=:s").run({ s: good });
    expect(() => exclude(f, good)).toThrow("INTEGRITY_MISMATCH");
    expect(() => exclude(f, "sha256:unknown")).toThrow("MIGRATION_NOT_FOUND");
    expect(() => exclude(f, bad, { runId: "unknown-run" })).toThrow("MIGRATION_NOT_FOUND");
    expect(receipts(f)).toHaveLength(1);
  });

  it("refuses while a producer lease is live and after the run completed", async () => {
    const { f, bad } = await preparedWithException();
    const ledger = createLegacyMigrationLedgerRepo(f.db);
    const lease = ledger.acquireLease({ runId: "run-1", owner: "producer", now: f.clock.now, expiresAt: "2026-08-20T01:00:00.000Z" });
    expect(() => exclude(f, bad)).toThrow("MIGRATION_BUSY");
    ledger.releaseLease({ lease, now: f.clock.now });
    exclude(f, bad);
    await f.runner.resumePreparation({ runId: "run-1", owner: "test" });
    await f.activate("run-1");
    expect(readMemoryAuthoritySelection(f.db).mode).toBe("canonical-local");
    expect(() => exclude(f, bad, { reason: "late" })).toThrow("MIGRATION_SOURCE_RESOLVED");
  });
});

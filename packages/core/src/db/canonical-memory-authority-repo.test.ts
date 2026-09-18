import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase } from "./sqlite.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createCanonicalMemoryRepo } from "./canonical-memory-repo.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("canonical authority repository", () => {
  it("persists one Local epoch across reopen-like reads and roundtrips banks", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); const repo = createCanonicalMemoryAuthorityRepo(db);
    const first = repo.initializeLocalAuthority("2026-08-19T00:00:00.000Z"); const second = repo.initializeLocalAuthority();
    expect(second.epochId).toBe(first.epochId); expect(second.providerLineageId).toBe(first.providerLineageId);
    const bank = repo.createBank({ authorityEpochId: first.epochId, bankId: "global", scope: { kind: "global", characterId: null }, name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {} });
    expect(repo.getBank(first.epochId, bank.bankId)?.scope.kind).toBe("global"); expect(() => repo.createBank(bank)).toThrow(); db.close();
  });
  it("persists the Local epoch and provider lineage across a real file reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-canonical-memory-")); const path = join(root, "workspace.db");
    try {
      const firstDb = openDatabase({ path, migrations: MIGRATIONS }); const first = createCanonicalMemoryAuthorityRepo(firstDb).initializeLocalAuthority("2026-08-19T00:00:00.000Z"); firstDb.close();
      const secondDb = openDatabase({ path, migrations: MIGRATIONS }); const second = createCanonicalMemoryAuthorityRepo(secondDb).initializeLocalAuthority(); secondDb.close();
      expect(second).toMatchObject({ epochId: first.epochId, providerLineageId: first.providerLineageId, providerId: "local", status: "active" });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("rejects stale epoch expectation", () => { const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); const repo = createCanonicalMemoryAuthorityRepo(db); repo.initializeLocalAuthority(); expect(() => repo.activeEpoch("stale")).toThrow(/MEMORY_AUTHORITY_MISMATCH/); db.close(); });
  it.each(["planned-switch", "emergency-takeover"])("accepts an already-active Local %s epoch without losing its fences", (reason) => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); const repo = createCanonicalMemoryAuthorityRepo(db);
    const previous = repo.initializeLocalAuthority("2026-08-19T00:00:00.000Z");
    const now = "2026-09-10T00:00:00.000Z";
    db.transaction(() => {
      db.prepare("UPDATE canonical_memory_authority_epochs SET status='closed',ended_at=:now WHERE epoch_id=:epoch")
        .run({ now, epoch: previous.epochId });
      db.prepare(`INSERT INTO canonical_memory_authority_epochs
        (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
        VALUES ('new-local','local','new-lineage','active',:predecessor,:now,NULL,:reason)`)
        .run({ predecessor: previous.epochId, now, reason });
      db.prepare("UPDATE canonical_memory_authority_state SET active_epoch_id='new-local',updated_at=:now WHERE singleton=1").run({ now });
    });
    expect(repo.activeEpoch("new-local")).toMatchObject({ epochId: "new-local", providerId: "local", status: "active", reason });
    expect(repo.initializeLocalAuthority()).toEqual(repo.activeEpoch("new-local"));
    expect(() => repo.activeEpoch(previous.epochId)).toThrow(/MEMORY_AUTHORITY_MISMATCH/);
    expect(repo.createBank({ authorityEpochId: "new-local", bankId: "global", scope: { kind: "global", characterId: null },
      name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {} }).bankId).toBe("global");
    db.close();
  });
  it("still refuses a foreign provider through Local-only entry points", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); const repo = createCanonicalMemoryAuthorityRepo(db);
    const epoch = repo.initializeLocalAuthority();
    db.prepare("UPDATE canonical_memory_authority_epochs SET provider_id='hindsight' WHERE epoch_id=:epoch").run({ epoch: epoch.epochId });
    expect(repo.authorityEpoch().providerId).toBe("hindsight");
    expect(() => repo.activeEpoch()).toThrow(/MEMORY_INTEGRITY_ERROR/);
    expect(() => repo.initializeLocalAuthority()).toThrow(/MEMORY_INTEGRITY_ERROR/);
    db.close();
  });
  it("roundtrips derived payloads and constrains lineage self-edges", () => { const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); const authority = createCanonicalMemoryAuthorityRepo(db); const epoch = authority.initializeLocalAuthority(); authority.createBank({ authorityEpochId: epoch.epochId, bankId: "global", scope: { kind: "global", characterId: null }, name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {} }); const records = createCanonicalMemoryRepo(db); const derived = { authorityEpochId: epoch.epochId, bankId: "global", objectRevision: 1, payload: { kind: "directive" as const, bankId: "global", directiveId: "d", name: "rule", content: "be kind", priority: 1, isActive: true, tags: [], createdAt: "2026-08-19T00:00:00.000Z", updatedAt: "2026-08-19T00:00:00.000Z" } }; records.saveDerived(derived); expect(records.getDerived({ epochId: epoch.epochId, bankId: "global", kind: "directive", objectId: "d" })?.payload.kind).toBe("directive"); expect(() => records.addLineage({ epochId: epoch.epochId, bankId: "global", memoryId: "m", sourceMemoryId: "m" })).toThrow(); db.close(); });
});

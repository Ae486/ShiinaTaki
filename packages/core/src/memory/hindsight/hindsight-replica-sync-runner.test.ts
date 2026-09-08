import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  MemoryReplicaScheduleConfigSchema, type CanonicalMemoryRecord, type HindsightConnectionProjection,
  type HindsightJournalPage, type HindsightLogicalSnapshotMetadata, type HindsightLogicalSnapshotPage,
  type HindsightLogicalSnapshotRecord, type MemoryReplicaBank, type MemoryReplicaLease, type MemoryReplicaRunKind,
} from "@taki/shared";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import { createHindsightReplicaSyncRepo } from "../../db/hindsight-replica-sync-repo.ts";
import { createHindsightReplicaSchedulerRepo } from "../../db/hindsight-replica-scheduler-repo.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { canonicalJson } from "../legacy-migration/legacy-identities.ts";
import { createIntlSegmenterTokenizer } from "../search-tokenizer.ts";
import { createHindsightClient, type HindsightTransportResponse } from "./hindsight-client.ts";
import { createHindsightReplicaScheduler, type HindsightReplicaScheduler } from "./hindsight-replica-scheduler.ts";
import { createHindsightReplicaSyncRunner } from "./hindsight-replica-sync-runner.ts";
import type { HindsightReplicaProjection } from "./hindsight-replica-projection.ts";
import { snapshotManifestHash } from "./hindsight-snapshot-validator.ts";

const at = "2026-09-06T00:00:00.000Z";
const lineage = "11111111-1111-4111-8111-111111111111";
const generation = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const authority = "verified-hindsight-epoch";
const globalBank: MemoryReplicaBank = { bankId: "global", scope: "global", characterId: null };
const characterBank: MemoryReplicaBank = { bankId: "character", scope: "character", characterId: "taki" };
const roots: string[] = []; const dbs: Database[] = []; const schedulers: HindsightReplicaScheduler[] = [];
afterEach(async () => {
  for (const scheduler of schedulers.splice(0)) await scheduler.stop();
  for (const db of dbs.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-b5-runner-")) throw new Error("unsafe fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});

describe("B5 admitted client/repository runner", () => {
  it("catches up every complete journal page and preserves full canonical policy and source payloads", async () => {
    const f = fixture();
    f.journals.set("global:8", journal("global", 8, { records: [memory("global", "m1", { revision: 2, text: "更新咖啡计划" })], current: 10 }));
    f.journals.set("global:9", journal("global", 9, { records: [memory("global", "m2", { revision: 2, text: "新的中文记录" })], current: 10 }));
    const result = await f.execute("incremental");
    expect(result).toMatchObject({ observedCursor: 10, checkpoint: { endCursor: 10, snapshotCursor: 8 } });
    expect(f.calls.filter((path) => path.includes("/changes?"))).toEqual([
      "/ext/taki-memory/banks/global/changes?after_cursor=8&limit=500",
      "/ext/taki-memory/banks/global/changes?after_cursor=9&limit=500",
    ]);
    expect(f.repo.record({ bankId: "global", memoryId: "m1" })).toEqual(canonical("global", "m1", { revision: 2, text: "更新咖啡计划" }));
    expect(f.repo.logicalRecord({ bankId: "global", objectKind: "document", objectId: "doc" })?.payload)
      .toMatchObject({ kind: "document", value: { retainedText: "retained source", provenance: provenance("global") } });
    expect(f.repo.search({ bankId: "global", query: "更新咖啡", limit: 5 })).toHaveLength(1);
  });

  it("populates a cold cache once and transfers no unchanged record pages after SQLite reopen", async () => {
    const f = fixture(); await f.execute("full");
    expect(f.pageReads).toHaveLength(4);
    expect(cacheCount(f.db)).toBe(4);
    expect(f.repo.cachedSnapshotRecord({ bankId: "global", providerLineageId: lineage, bankGeneration: other,
      pageHash: f.lastSnapshot().pages[0]!.contentHash })).toBeUndefined();
    const checkpoint = f.repo.checkpoint("global"); f.closeAndReopen(); f.advance(2 * 60 * 60_000);
    f.remote.get("global")!.records.reverse();
    expect(f.repo.checkpoint("global")).toEqual(checkpoint);
    expect(f.repo.record({ bankId: "global", memoryId: "m1" })?.unit.metadata).toEqual({ numeric_value: 1, source_query: "opaque" });
    f.pageReads.length = 0;
    await f.execute("full"); expect(f.pageReads).toEqual([]);
    expect(cacheCount(f.db)).toBe(4);
    expect(f.repo.search({ bankId: "global", query: "咖啡", limit: 5 })).toHaveLength(1);
  });

  it("repairs only divergent canonical rows and FTS from trusted cache evidence without recopying unchanged records", async () => {
    const f = fixture(); await f.execute("full"); f.pageReads.length = 0;
    f.db.exec(`UPDATE hindsight_replica_sync_records SET record_json=json_set(record_json,'$.payload.value.unit.text','corrupt')
      WHERE bank_id='global' AND object_kind='memory_unit' AND object_id='m1';
      DELETE FROM hindsight_replica_sync_fts WHERE bank_id='global' AND object_id='m2';
      INSERT INTO hindsight_replica_sync_fts (bank_id,object_id,text,context,disclosure,search_terms)
      VALUES ('global','orphan','orphan',NULL,NULL,'orphan');
      CREATE TABLE repair_inserts (object_kind TEXT, object_id TEXT);
      CREATE TRIGGER track_repair AFTER INSERT ON hindsight_replica_sync_records
      BEGIN INSERT INTO repair_inserts VALUES (NEW.object_kind, NEW.object_id); END;`);
    await f.execute("full");
    expect(f.pageReads).toEqual([]);
    expect(f.db.prepare("SELECT * FROM repair_inserts").all()).toEqual([{ object_kind: "memory_unit", object_id: "m1" }]);
    expect(f.repo.record({ bankId: "global", memoryId: "m1" })?.unit.text).toBe("咖啡计划");
    expect(f.repo.search({ bankId: "global", query: "中文记录", limit: 5 })).toHaveLength(1);
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_replica_sync_fts WHERE object_id='orphan'").get()?.n).toBe(0);
  });

  it.each(["record_json", "record_hash", "object_revision", "operation"] as const)("repairs malformed canonical %s from verified cache evidence", async (field) => {
    const f = fixture(); await f.execute("full"); f.pageReads.length = 0;
    const corrupt = { record_json: "{}", record_hash: "0".repeat(64), object_revision: 99, operation: "tombstone" };
    f.db.prepare(`UPDATE hindsight_replica_sync_records SET ${field}=:value WHERE bank_id='global' AND object_kind='memory_unit' AND object_id='m1'`)
      .run({ value: corrupt[field] });
    expect(() => f.repo.record({ bankId: "global", memoryId: "m1" })).toThrow();
    await f.execute("full");
    expect(f.repo.record({ bankId: "global", memoryId: "m1" })).toEqual(canonical("global", "m1", { revision: 1, text: "咖啡计划" }));
    expect(f.pageReads).toEqual([]);
  });

  it.each(["duplicate", "missing_bank"] as const)("rejects a complete snapshot with %s objects before publication", async (invalid) => {
    const f = fixture(); const before = durableState(f.db); const remote = f.remote.get("global")!;
    if (invalid === "duplicate") remote.records.push(memory("global", "m1", { revision: 2, text: "duplicate identity" }));
    else remote.records = remote.records.filter((record) => record.objectKind !== "bank");
    await expect(f.execute("full")).rejects.toThrow("HINDSIGHT_REPLICA_INTEGRITY_ERROR");
    expect(durableState(f.db)).toEqual(before);
  });

  it("downloads only changed records and preserves invalidation plus derived object payloads", async () => {
    const f = fixture(); await f.execute("full"); f.pageReads.length = 0;
    const remote = f.remote.get("global")!;
    const invalid = memory("global", "m1", { revision: 2, text: "旧的咖啡计划" });
    if (invalid.payload.kind !== "memory_unit") throw new Error("fixture kind");
    invalid.payload.value = { ...invalid.payload.value, state: "invalidated", invalidatedAt: at, invalidationReason: "retired" };
    remote.records = remote.records.filter((record) => record.objectId !== "m1").concat(invalid, derived("global"));
    remote.cursor = 10;
    await f.execute("full");
    expect(f.pageReads.sort()).toEqual(["global:directive:directive", "global:memory_unit:m1", "global:mental_model:mental"]);
    expect(f.repo.record({ bankId: "global", memoryId: "m1" })).toBeUndefined();
    expect(f.repo.record({ bankId: "global", memoryId: "m1", includeInvalidated: true })?.unit.invalidationReason).toBe("retired");
    expect(f.repo.search({ bankId: "global", query: "咖啡", limit: 5 })).toEqual([]);
    f.closeAndReopen();
    expect(f.repo.logicalRecord({ bankId: "global", objectKind: "mental_model", objectId: "mental" })?.payload)
      .toMatchObject({ kind: "mental_model", value: { payload: { structuredContent: { source_memory_ids: ["m2"] }, trigger: { source_query: "opaque" } } } });
    expect(f.repo.logicalRecord({ bankId: "global", objectKind: "directive", objectId: "directive" })?.payload)
      .toMatchObject({ kind: "directive", value: { payload: { isActive: false, priority: 2 } } });
  });

  it("prunes obsolete cache data and tombstones by logical kind while preserving same-ID memory FTS", async () => {
    const f = fixture(); const remote = f.remote.get("global")!;
    const source = sourceRecord("global", "m1"); remote.records.push(source);
    await f.execute("full"); expect(cacheCount(f.db)).toBe(5);
    f.journals.set("global:8", tombstoneJournal("document", "m1", 8));
    await f.execute("incremental");
    expect(f.db.prepare("SELECT object_kind FROM hindsight_replica_sync_snapshot_cache WHERE object_id='m1'").all())
      .toEqual([{ object_kind: "memory_unit" }]);
    expect(f.repo.search({ bankId: "global", query: "咖啡", limit: 5 })).toHaveLength(1);
    remote.records = remote.records.filter((record) => record.objectKind !== "document" || record.objectId !== "m1"); remote.cursor = 9;
    f.pageReads.length = 0; await f.execute("full"); expect(f.pageReads).toEqual([]);
    expect(f.repo.logicalRecord({ bankId: "global", objectKind: "document", objectId: "m1", includeTombstones: true })).toBeUndefined();
    expect(cacheCount(f.db)).toBe(4);
    f.journals.set("global:9", tombstoneJournal("memory_unit", "m1", 9));
    await f.execute("incremental");
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_replica_sync_snapshot_cache WHERE object_id='m1'").get()?.n).toBe(0);
    expect(f.repo.record({ bankId: "global", memoryId: "m1" })).toBeUndefined();
    expect(f.repo.search({ bankId: "global", query: "咖啡", limit: 5 })).toEqual([]);
  });

  it("refetches corrupt cached content instead of trusting a copied provider page hash", async () => {
    const f = fixture(); await f.execute("full"); f.pageReads.length = 0;
    f.db.exec("UPDATE hindsight_replica_sync_snapshot_cache SET record_json=json_set(record_json,'$.payload.value.text','corrupt') WHERE object_kind='memory_unit' AND object_id='m1'");
    await f.execute("full");
    expect(f.pageReads).toEqual(["global:memory_unit:m1"]);
    expect(f.repo.record({ bankId: "global", memoryId: "m1" })?.unit.text).toBe("咖啡计划");
    f.pageReads.length = 0; await f.execute("full"); expect(f.pageReads).toEqual([]);
  });

  it("refetches a cache record whose provider page hash was corrupted to a newer manifest hash", async () => {
    const f = fixture(); await f.execute("full"); f.pageReads.length = 0;
    const remote = f.remote.get("global")!;
    remote.records[2] = memory("global", "m1", { revision: 2, text: "authoritative update" }); remote.cursor = 9;
    const pageHash = capture("global", remote, { now: at, pageSize: 1 }).pages[2]!.contentHash;
    f.db.prepare("UPDATE hindsight_replica_sync_snapshot_cache SET page_hash=:hash WHERE object_kind='memory_unit' AND object_id='m1'")
      .run({ hash: pageHash });
    await f.execute("full");
    expect(f.pageReads).toEqual(["global:memory_unit:m1"]);
    expect(f.repo.record({ bankId: "global", memoryId: "m1" })?.unit).toMatchObject({ text: "authoritative update", revision: 2 });
  });

  it.each(["provider_lineage_id", "bank_generation"] as const)("rejects cache evidence with a corrupted %s binding", async (field) => {
    const f = fixture(); await f.execute("full");
    const pageHash = f.lastSnapshot().pages[2]!.contentHash;
    f.db.prepare(`UPDATE hindsight_replica_sync_snapshot_cache SET ${field}=:value WHERE object_kind='memory_unit' AND object_id='m1'`)
      .run({ value: other });
    expect(f.repo.cachedSnapshotRecord({ bankId: "global", providerLineageId: field === "provider_lineage_id" ? other : lineage,
      bankGeneration: field === "bank_generation" ? other : generation, pageHash })).toBeUndefined();
  });

  it.each([null, 17, new Uint8Array([55, 56])])("repairs an FTS orphan with a malformed stored ID %s", async (objectId) => {
    const f = fixture(); await f.execute("full"); f.pageReads.length = 0;
    f.db.prepare(`INSERT INTO hindsight_replica_sync_fts (bank_id,object_id,text,context,disclosure,search_terms)
      VALUES ('global',:id,'corrupt orphan',NULL,NULL,'corrupt orphan')`).run({ id: objectId });
    await f.execute("full");
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_replica_sync_fts WHERE bank_id='global'").get()?.n).toBe(2);
    expect(f.pageReads).toEqual([]);
    expect(f.repo.search({ bankId: "global", query: "咖啡", limit: 5 })).toHaveLength(1);
  });

  it("does not commit a journal page received after the captured run deadline", async () => {
    const f = fixture(); await f.execute("full"); const before = durableState(f.db);
    f.journals.set("global:8", journal("global", 8, { records: [memory("global", "m1", { revision: 2, text: "too late" })], current: 9 }));
    f.hook = (url, response) => { if (url.pathname.endsWith("/changes")) f.advance(60_000); return response; };
    await expect(f.execute("incremental")).rejects.toThrow("HINDSIGHT_DEADLINE_EXCEEDED");
    expect(durableState(f.db)).toEqual(before);
  });

  it.each([false, true])("retains committed journal pages when later reset recovery fails=%s", async (failSnapshot) => {
    const f = fixture(); await f.execute("full"); const beforeAuthority = authorityState(f.db);
    const accepted = memory("global", "m1", { revision: 2, text: "accepted journal page" });
    const remote = f.remote.get("global")!; remote.records[2] = accepted; remote.cursor = 10;
    f.journals.set("global:8", journal("global", 8, { records: [accepted], current: 10 }));
    f.hook = (url, response) => {
      if (url.pathname.endsWith("/changes") && url.searchParams.get("after_cursor") === "9") return { status: 409, body: "reset" };
      if (failSnapshot && url.pathname.endsWith("/snapshots")) return { status: 401, body: "private auth detail" };
      return response;
    };
    const scheduler = f.scheduler(); scheduler.start(); scheduler.requestManual("global"); await scheduler.tick();
    expect(scheduler.status()[0]).toMatchObject({ mode: failSnapshot ? "failed" : "idle",
      fullReconciliationState: failSnapshot ? "failed" : "succeeded", checkpoint: { endCursor: failSnapshot ? 9 : 10 } });
    expect(f.repo.record({ bankId: "global", memoryId: "m1" })?.unit.text).toBe("accepted journal page");
    expect(f.repo.search({ bankId: "global", query: "accepted", limit: 5 })).toHaveLength(1);
    expect(authorityState(f.db)).toEqual(beforeAuthority);
  });

  it.each(["cursor", "generation", "lineage"] as const)("rebuilds a %s reset from a verified new snapshot without changing Authority", async (reason) => {
    const f = fixture(); await f.execute("full");
    const beforeAuthority = authorityState(f.db); const old = f.repo.checkpoint("global")!;
    const remote = f.remote.get("global")!; remote.cursor = 1;
    remote.records = [bankRecord("global"), sourceRecord("global"), memory("global", "new", { revision: 1, text: "新的快照" })];
    if (reason === "generation") {
      remote.generation = other;
      f.journals.set("global:8", { ...journal("global", 8, { records: [], current: 8 }), bankGeneration: other });
    } else if (reason === "lineage") remote.lineage = other;
    else f.hook = (url, response) => url.pathname.endsWith("/changes") ? { status: 409, body: "private reset detail" } : response;
    const scheduler = f.scheduler(); scheduler.start(); scheduler.requestManual("global"); await scheduler.tick();
    expect(scheduler.status()[0]).toMatchObject({ mode: "idle", fullReconciliationState: "succeeded", lastFullReconciliationAt: at, checkpoint: { endCursor: 1 } });
    const current = f.repo.checkpoint("global")!;
    expect(current.replicaEpochId).not.toBe(old.replicaEpochId);
    expect(current.authorityEpochId).toBe(old.authorityEpochId);
    expect(f.repo.record({ bankId: "global", memoryId: "m1" })).toBeUndefined();
    expect(f.repo.search({ bankId: "global", query: "快照", limit: 5 })).toHaveLength(1);
    expect(cacheCount(f.db)).toBe(3);
    expect(authorityState(f.db)).toEqual(beforeAuthority);
  });

  it("handles a generation reset discovered by a periodic full reconciliation", async () => {
    const f = fixture(); const remote = f.remote.get("global")!; remote.generation = other; remote.cursor = 0;
    await f.execute("full");
    expect(f.repo.checkpoint("global")).toMatchObject({ bankGeneration: other, endCursor: 0, authorityEpochId: authority });
  });

  it.each(["auth", "page_hash", "missing_page", "expired", "oversize_page", "oversize_manifest", "deadline"] as const)(
    "preserves the complete last-good replica and cache on %s failure", async (failure) => {
      const f = fixture(); await f.execute("full");
      const before = durableState(f.db); const remote = f.remote.get("global")!;
      remote.records[2] = memory("global", "m1", { revision: 2, text: "must never publish" }); remote.cursor = 9;
      f.hook = (url, response) => {
        const page = url.pathname.includes("/pages/"); const metadata = url.pathname.endsWith("/snapshots");
        if (failure === "auth" && page) return { status: 401, body: "private auth detail" };
        if (failure === "missing_page" && page) return { status: 404, body: "private page detail" };
        if (failure === "page_hash" && page) return { ...response, body: response.body.replace(/"content_sha256":"[a-f0-9]+"/, '"content_sha256":"' + "0".repeat(64) + '"') };
        if ((failure === "oversize_page" && page) || (failure === "oversize_manifest" && metadata)) return { ...response, body: response.body + " ".repeat(512 * 1024) };
        if (failure === "expired" && page) return { status: 410, body: "expired" };
        if (failure === "deadline" && page) f.advance(60_000);
        return response;
      };
      await expect(f.execute("full")).rejects.toThrow();
      expect(durableState(f.db)).toEqual(before);
      expect(f.repo.record({ bankId: "global", memoryId: "m1" })?.unit.text).toBe("咖啡计划");
      expect(f.repo.search({ bankId: "global", query: "咖啡", limit: 5 })).toHaveLength(1);
    });

  it("rolls back divergent payloads, FTS, cache pruning, and the checkpoint together", async () => {
    const f = fixture(); await f.execute("full"); const before = durableState(f.db);
    const remote = f.remote.get("global")!;
    remote.records = remote.records.filter((record) => record.objectId !== "m2");
    remote.records[2] = memory("global", "m1", { revision: 2, text: "must roll back" }); remote.cursor = 10;
    f.db.exec("CREATE TRIGGER fail_reconcile BEFORE UPDATE ON hindsight_replica_sync_checkpoints BEGIN SELECT RAISE(ABORT, 'injected checkpoint fault'); END;");
    await expect(f.execute("full")).rejects.toThrow("injected checkpoint fault");
    expect(durableState(f.db)).toEqual(before);
    f.db.exec("DROP TRIGGER fail_reconcile"); await f.execute("full");
    expect(f.repo.record({ bankId: "global", memoryId: "m2" })).toBeUndefined();
    expect(f.repo.checkpoint("global")?.endCursor).toBe(10);
  });

  it("refuses missing trusted policy and source bindings without publishing the snapshot", async () => {
    for (const missing of ["source", "memory"] as const) {
      const f = fixture(); const before = durableState(f.db);
      const projection = { ...trustedProjection, [missing]: () => ({}) } as HindsightReplicaProjection;
      await expect(f.execute("full", projection)).rejects.toThrow();
      expect(durableState(f.db)).toEqual(before);
    }
  });

  it.each(["full", "incremental"] as const)("refuses Bank scope rebinding during an admitted %s run", async (kind) => {
    const f = fixture(); const before = durableState(f.db); let rebound = false;
    const projection: HindsightReplicaProjection = { ...trustedProjection,
      bankScope: () => rebound ? { kind: "character", characterId: "another-character" } : { kind: "global", characterId: null } };
    f.journals.set("global:8", journal("global", 8, { records: [{ ...bankRecord("global"), objectRevision: 2 }], current: 9 }));
    f.hook = (url, response) => {
      if (url.pathname.endsWith("/snapshots") || url.pathname.endsWith("/changes")) rebound = true;
      return response;
    };
    await expect(f.execute(kind, projection)).rejects.toThrow("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH");
    expect(durableState(f.db)).toEqual(before);
  });

  it.each(["run", "rebuild"] as const)("fences snapshot publication against an Authority change during %s", async (method) => {
    const f = fixture(); setFixtureAuthority(f.db, { epochId: authority, providerId: "hindsight", providerLineageId: lineage });
    const before = durableState(f.db); const remote = f.remote.get("global")!;
    remote.records[2] = memory("global", "m1", { revision: 2, text: "old authority snapshot" }); remote.cursor = 9;
    f.hook = (url, response) => {
      if (url.pathname.endsWith("/pages/3")) setFixtureAuthority(f.db, {
        epochId: "successor-epoch", providerId: "local", providerLineageId: "successor-lineage",
      });
      return response;
    };
    const lease = f.repo.leases.acquire({ bankId: "global", ownerId: "recovery", durationMs: 61_000 });
    const runner = createHindsightReplicaSyncRunner({ client: f.client, repo: f.repo,
      projection: trustedProjection, connection, secretMarker: "offline-marker", now: () => at });
    const input = { bank: globalBank, run: { lease, kind: "full" as const, trigger: "manual" as const,
      predecessor: f.repo.checkpoint("global")! }, signal: new AbortController().signal,
      expectedAuthority: { epochId: authority, providerLineageId: lineage } };
    try { await expect(runner[method](input)).rejects.toThrow("HINDSIGHT_PENDING_AUTHORITY_MISMATCH"); }
    finally { releaseFixtureLease(f.repo, lease); }
    expect(durableState(f.db)).toEqual({ ...before, authority: authorityState(f.db) });
    expect(authorityState(f.db).receipts).toEqual(before.authority.receipts);
    expect(createCanonicalMemoryAuthorityRepo(f.db).authorityEpoch().epochId).toBe("successor-epoch");
  });

  it.each(["incremental", "full"] as const)("rolls back %s payload, FTS, cache and checkpoint if Authority changes inside publication", async (kind) => {
    const f = fixture(); setFixtureAuthority(f.db, { epochId: authority, providerId: "hindsight", providerLineageId: lineage });
    const before = durableState(f.db); const added = memory("global", "new", { revision: 1, text: "must roll back" });
    f.journals.set("global:8", journal("global", 8, { records: [added], current: 9 }));
    f.remote.get("global")!.records.push(added); f.remote.get("global")!.cursor = 9;
    f.db.exec(`CREATE TRIGGER change_authority_inside_publication AFTER INSERT ON hindsight_replica_sync_records
      WHEN NEW.object_id='new' BEGIN UPDATE canonical_memory_authority_epochs SET provider_lineage_id='${other}'
      WHERE epoch_id='${authority}'; END;`);
    const lease = f.repo.leases.acquire({ bankId: "global", ownerId: "recovery", durationMs: 61_000 });
    const runner = createHindsightReplicaSyncRunner({ client: f.client, repo: f.repo,
      projection: trustedProjection, connection, secretMarker: "offline-marker", now: () => at });
    try {
      await expect(runner.run({ bank: globalBank, run: { lease, kind, trigger: "manual", predecessor: f.repo.checkpoint("global")! },
        signal: new AbortController().signal, expectedAuthority: { epochId: authority, providerLineageId: lineage } }))
        .rejects.toThrow("HINDSIGHT_PENDING_AUTHORITY_MISMATCH");
    } finally { releaseFixtureLease(f.repo, lease); }
    expect(durableState(f.db)).toEqual(before);
  });

  it("refuses an unsupported compatibility manifest before reading data-plane endpoints", async () => {
    const f = fixture(); const before = durableState(f.db);
    f.hook = (url, response) => url.pathname === "/ext/taki-memory/version"
      ? { ...response, body: response.body.replace("taki-memory-hindsight-0.9.0-batch0-v2", "unaccepted-build") } : response;
    await expect(f.execute("full")).rejects.toThrow("HINDSIGHT_EXTENSION_UNSUPPORTED");
    expect(f.calls.some((path) => path.includes("/snapshots") || path.includes("/changes"))).toBe(false);
    expect(durableState(f.db)).toEqual(before);
  });

  it.each(["stop", "timeout"] as const)("cancels an in-flight real client response on %s and rejects late publication", async (reason) => {
    const f = fixture(); const before = durableState(f.db);
    const reached = deferred<void>(); const resume = deferred<HindsightTransportResponse>();
    let held: HindsightTransportResponse | undefined;
    f.hook = async (url, response) => {
      if (url.pathname.endsWith("/pages/3")) { held = response; reached.resolve(); return resume.promise; }
      return response;
    };
    const scheduler = f.scheduler(false, reason === "timeout" ? 20 : undefined); scheduler.start(); scheduler.requestManual("global", "full");
    const active = scheduler.tick(); await reached.promise;
    expect(durableState(f.db)).toEqual(before);
    if (reason === "stop") await scheduler.stop();
    else await active;
    expect(scheduler.status()[0]).toMatchObject({ mode: "failed", errorCode: reason === "stop" ? "HINDSIGHT_CANCELLED" : "HINDSIGHT_TIMEOUT" });
    resume.resolve(held!); await active; await Promise.resolve(); await Promise.resolve();
    expect(durableState(f.db)).toEqual(before);
  });

  it("uses independent real HTTP journal/checkpoint paths for all configured Banks", async () => {
    const f = fixture([globalBank, characterBank]);
    f.journals.set("character:8", journal("character", 8, { records: [memory("character", "m1", { revision: 2, text: "Character memory" })], current: 9 }));
    f.hook = (url, response) => url.pathname === "/ext/taki-memory/banks/global/changes" ? { status: 401, body: "private auth detail" } : response;
    const scheduler = f.scheduler(true); scheduler.start(); await scheduler.tick();
    expect(scheduler.status("global")[0]).toMatchObject({ mode: "failed", checkpoint: { endCursor: 8 } });
    expect(scheduler.status("character")[0]).toMatchObject({ mode: "idle", checkpoint: { endCursor: 9 } });
    expect(f.repo.record({ bankId: "character", memoryId: "m1" })?.unit.text).toBe("Character memory");
    expect(f.repo.record({ bankId: "global", memoryId: "m1" })?.unit.text).toBe("咖啡计划");
  });
});

interface RemoteBank { lineage: string; generation: string; cursor: number; records: HindsightLogicalSnapshotRecord[] }
interface Snapshot { metadata: HindsightLogicalSnapshotMetadata; pages: HindsightLogicalSnapshotPage[] }
type ResponseHook = (url: URL, response: HindsightTransportResponse) => HindsightTransportResponse | Promise<HindsightTransportResponse>;

function fixture(banks = [globalBank]) {
  const root = mkdtempSync(join(tmpdir(), "taki-b5-runner-")); roots.push(root);
  const path = join(root, "workspace.db"); let time = at;
  const now = () => time;
  let db = open(path); let repo = replica(db, now);
  const remote = new Map<string, RemoteBank>(); const snapshots = new Map<string, Snapshot>();
  const journals = new Map<string, HindsightJournalPage>(); const calls: string[] = []; const pageReads: string[] = [];
  for (const bank of banks) {
    const state = { lineage, generation, cursor: 8, records: [bankRecord(bank.bankId), sourceRecord(bank.bankId),
      memory(bank.bankId, "m1", { revision: 1, text: "咖啡计划" }), memory(bank.bankId, "m2", { revision: 1, text: "中文记录" })] };
    remote.set(bank.bankId, state);
    const snapshot = capture(bank.bankId, state, { now: time, pageSize: 4 });
    const lease = repo.leases.acquire({ bankId: bank.bankId, ownerId: "bootstrap", durationMs: 60_000 });
    repo.seedVerifiedSnapshot({ ...snapshot, authorityEpochId: authority, expectedProviderLineageId: lineage,
      expectedBankGeneration: generation, expectedCheckpoint: null, lease }); repo.leases.release(lease);
  }
  createCanonicalMemoryAuthorityRepo(db).initializeLocalAuthority(at);
  const control = { hook: ((_url, response) => response) as ResponseHook };
  const client = createHindsightClient({ endpoint: "http://127.0.0.1:8888", resolveApiKey: () => "offline-test-key",
    transport: async (rawUrl, init) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer offline-test-key" });
      const url = new URL(rawUrl); calls.push(url.pathname + url.search);
      let response: HindsightTransportResponse;
      if (url.pathname === "/health") response = json({ status: "healthy", database: "connected" });
      else if (url.pathname === "/version") response = json({ api_version: "0.9.0" });
      else if (url.pathname === "/ext/taki-memory/version") response = json(compatibility(remote.values().next().value?.lineage ?? lineage));
      else response = dataResponse({ url, init, remote, snapshots, journals, pageReads, now });
      return control.hook(url, response);
    } });
  const runner = (projection = trustedProjection) => createHindsightReplicaSyncRunner({ client,
    repo: projection === trustedProjection ? repo : replica(db, now, projection), projection,
    connection, secretMarker: "offline-marker", now });
  return {
    get db() { return db; }, get repo() { return repo; }, client, remote, journals, calls, pageReads,
    get hook() { return control.hook; }, set hook(value: ResponseHook) { control.hook = value; },
    advance: (ms: number) => { time = new Date(Date.parse(time) + ms).toISOString(); },
    closeAndReopen: () => { db.close(); db = open(path); repo = replica(db, now); },
    lastSnapshot: () => [...snapshots.values()].at(-1)!,
    execute: async (kind: MemoryReplicaRunKind, projection = trustedProjection) => {
      const lease = repo.leases.acquire({ bankId: "global", ownerId: "manual", durationMs: 120_000 });
      const run = { lease, kind, trigger: "manual" as const, predecessor: repo.checkpoint("global") ?? null };
      try { return await runner(projection).run({ bank: globalBank, run, signal: new AbortController().signal }); }
      finally { releaseFixtureLease(repo, lease); }
    },
    scheduler: (automatic = false, runTimeoutMs?: number) => {
      const schedule = createHindsightReplicaSchedulerRepo(db, now);
      for (const bank of banks) schedule.ensureBank({ bank, config: MemoryReplicaScheduleConfigSchema.parse({ automatic }) });
      const scheduler = createHindsightReplicaScheduler({ repo: schedule, replica: repo, banks, runner: runner(), ownerId: "scheduled", runTimeoutMs });
      schedulers.push(scheduler); return scheduler;
    },
  };
}

function dataResponse(input: { url: URL; init?: RequestInit; remote: Map<string, RemoteBank>; snapshots: Map<string, Snapshot>;
  journals: Map<string, HindsightJournalPage>; pageReads: string[]; now: () => string }): HindsightTransportResponse {
  const parts = input.url.pathname.split("/"); const bankId = decodeURIComponent(parts[4]!);
  const remote = input.remote.get(bankId); if (!remote) throw new Error("fixture Bank missing");
  if (parts[5] === "changes") {
    const after = Number(input.url.searchParams.get("after_cursor"));
    return json(wireJournal(input.journals.get(`${bankId}:${after}`) ?? journal(bankId, after, { records: [], current: after })));
  }
  if (parts[5] !== "snapshots") throw new Error("unexpected offline request");
  if (input.init?.method === "POST") {
    expect(JSON.parse(String(input.init.body))).toEqual({ page_size: 1, ttl_seconds: 3600 });
    const snapshot = capture(bankId, remote, { now: input.now(), pageSize: 1 }); input.snapshots.set(snapshot.metadata.snapshotId, snapshot);
    return json(wireMetadata(snapshot.metadata));
  }
  const snapshot = input.snapshots.get(parts[6]!); if (!snapshot) return { status: 404, body: "missing" };
  if (parts[7] !== "pages") return json(wireMetadata(snapshot.metadata));
  const page = snapshot.pages[Number(parts[8])]; if (!page) return { status: 404, body: "missing" };
  input.pageReads.push(`${bankId}:${page.records[0]!.objectKind}:${page.records[0]!.objectId}`);
  return json({ snapshot_id: page.snapshotId, page_number: page.pageNumber, total_pages: page.totalPages,
    record_count: page.recordCount, content_sha256: page.contentHash, records: page.records.map(wireRecord) });
}

function open(path: string) { const db = openDatabase({ path, migrations: MIGRATIONS }); dbs.push(db); return db; }
function setFixtureAuthority(db: Database, value: { epochId: string; providerId: string; providerLineageId: string }) {
  const previous = createCanonicalMemoryAuthorityRepo(db).authorityEpoch();
  db.transaction(() => {
    db.prepare("UPDATE canonical_memory_authority_epochs SET status='closed',ended_at=:at WHERE epoch_id=:epoch")
      .run({ at, epoch: previous.epochId });
    db.prepare(`INSERT INTO canonical_memory_authority_epochs
      (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
      VALUES (:epochId,:providerId,:providerLineageId,'active',:previous,:at,NULL,'planned-switch')`)
      .run({ ...value, previous: previous.epochId, at });
    db.prepare("UPDATE canonical_memory_authority_state SET active_epoch_id=:epoch,updated_at=:at WHERE singleton=1")
      .run({ epoch: value.epochId, at });
  });
}
function replica(db: Database, now: () => string, projection = trustedProjection) { return createHindsightReplicaSyncRepo({ db, now,
  projection, tokenizer: createIntlSegmenterTokenizer({ stoplist: true }) }); }
function releaseFixtureLease(repo: ReturnType<typeof createHindsightReplicaSyncRepo>, lease: MemoryReplicaLease): void {
  try { repo.leases.release(lease); }
  catch (error) { if (!(error instanceof Error) || error.message !== "HINDSIGHT_REPLICA_LEASE_LOST") throw error; }
}
function cacheCount(db: Database) { return Number(db.prepare("SELECT count(*) AS n FROM hindsight_replica_sync_snapshot_cache").get()?.n); }
function authorityState(db: Database) {
  return { selection: db.prepare("SELECT * FROM memory_authority_selection").all(),
    epochs: db.prepare("SELECT * FROM canonical_memory_authority_epochs").all(), receipts: db.prepare("SELECT * FROM hindsight_authority_activation_receipts").all() };
}
function durableState(db: Database) {
  return { authority: authorityState(db), records: db.prepare("SELECT * FROM hindsight_replica_sync_records ORDER BY bank_id,object_kind,object_id").all(),
    fts: db.prepare("SELECT bank_id,object_id,text,context,disclosure,search_terms FROM hindsight_replica_sync_fts ORDER BY bank_id,object_id").all(),
    checkpoint: db.prepare("SELECT * FROM hindsight_replica_sync_checkpoints ORDER BY bank_id").all(),
    cache: db.prepare("SELECT * FROM hindsight_replica_sync_snapshot_cache ORDER BY bank_id,page_hash").all() };
}

function capture(bankId: string, remote: RemoteBank, input: { now: string; pageSize: number }): Snapshot {
  const { now, pageSize } = input;
  const records = structuredClone(remote.records); const snapshotId = randomUUID();
  const groups = Array.from({ length: Math.ceil(records.length / pageSize) }, (_, index) => records.slice(index * pageSize, (index + 1) * pageSize));
  const pages = groups.map((group, pageNumber) => ({ snapshotId, pageNumber, totalPages: groups.length, recordCount: group.length,
    contentHash: createHash("sha256").update(providerJson(group.map(wireRecord))).digest("hex"), records: group }));
  const count = (kind: string) => records.filter((record) => record.objectKind === kind).length;
  const invalidated = records.filter((record) => record.payload.kind === "memory_unit" && record.payload.value.state === "invalidated").length;
  const metadata: HindsightLogicalSnapshotMetadata = { snapshotId, createdAt: now, expiresAt: new Date(Date.parse(now) + 3600_000).toISOString(),
    manifest: { schemaVersion: 1, bankId, providerLineage: remote.lineage, bankGeneration: remote.generation,
      endCursor: remote.cursor, pageSize, totalPages: pages.length, totalRecords: records.length,
      counts: { bank: count("bank"), document: count("document"), memoryUnit: { valid: count("memory_unit") - invalidated, invalidated },
        mentalModel: count("mental_model"), directive: count("directive"), total: records.length },
      pageHashes: pages.map((page) => page.contentHash), manifestDigest: "0".repeat(64) } };
  metadata.manifest.manifestDigest = snapshotManifestHash(metadata); return { metadata, pages };
}
function wireMetadata(value: HindsightLogicalSnapshotMetadata) {
  const m = value.manifest;
  return { snapshot_id: value.snapshotId, created_at: value.createdAt, expires_at: value.expiresAt,
    manifest: { schema_version: 1, bank_id: m.bankId, provider_lineage: m.providerLineage, bank_generation: m.bankGeneration,
      end_cursor: m.endCursor, page_size: m.pageSize, total_pages: m.totalPages, total_records: m.totalRecords,
      counts: { bank: m.counts.bank, document: m.counts.document, memory_unit: m.counts.memoryUnit,
        mental_model: m.counts.mentalModel, directive: m.counts.directive, total: m.counts.total }, page_hashes: m.pageHashes, sha256: m.manifestDigest } };
}
function wireRecord(record: HindsightLogicalSnapshotRecord) {
  return { object_kind: record.objectKind, object_id: record.objectId, object_revision: record.objectRevision, payload: snake(record.payload.value) };
}
function snake(value: object) { return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), item])); }
function providerJson(value: unknown): string { return canonicalJson(value).replaceAll('"numeric_value":1', '"numeric_value":1.0'); }
function json(value: unknown): HindsightTransportResponse { return { status: 200, body: providerJson(value) }; }

function journal(bankId: string, after: number, input: { records: HindsightLogicalSnapshotRecord[]; current: number }): HindsightJournalPage {
  const { records, current } = input;
  const batchId = randomUUID();
  return { bankId, providerLineageId: lineage, bankGeneration: generation, predecessorCursor: after,
    nextCursor: after + records.length, currentCursor: current, minimumAvailableCursor: 0, hasMore: current > after + records.length,
    changes: records.map((record, index) => ({ ...record, providerLineageId: lineage, bankGeneration: generation,
      operation: "upsert", cursor: after + index + 1, batchId, batchSize: records.length, batchIndex: index, recordedAt: at })) };
}
function tombstoneJournal(kind: "memory_unit" | "document", id: string, after: number): HindsightJournalPage {
  const result = journal("global", after, { records: [], current: after + 1 }); result.nextCursor = after + 1; result.hasMore = false;
  result.changes = [{ providerLineageId: lineage, bankGeneration: generation, objectKind: kind, objectId: id,
    objectRevision: after + 1, payload: null, operation: "tombstone", cursor: after + 1, batchId: randomUUID(), batchSize: 1, batchIndex: 0, recordedAt: at }];
  return result;
}
function wireJournal(page: HindsightJournalPage) {
  return { provider_lineage: page.providerLineageId, bank_generation: page.bankGeneration, from_cursor: page.predecessorCursor,
    next_cursor: page.nextCursor, current_cursor: page.currentCursor, minimum_available_cursor: page.minimumAvailableCursor, has_more: page.hasMore,
    changes: page.changes.map((change) => ({ object_kind: change.objectKind, object_id: change.objectId, object_revision: change.objectRevision,
      payload: change.payload ? snake(change.payload.value) : null, operation: change.operation, provider_lineage: change.providerLineageId,
      bank_generation: change.bankGeneration, cursor: change.cursor, batch_id: change.batchId, batch_index: change.batchIndex,
      batch_size: change.batchSize, recorded_at: change.recordedAt })) };
}

function provenance(bankId: string) { return { actor: "user" as const, origin: "explicit-user" as const,
  characterId: bankId === "global" ? null : "taki", timelineFromSeq: 1, timelineToSeq: 2, capturedAt: at, sanitized: true as const, sourceRef: "fixture-source" }; }
function canonical(bankId: string, memoryId: string, input: { revision: number; text: string }): CanonicalMemoryRecord {
  const { revision, text } = input;
  return { unit: { authorityEpochId: authority, bankId, memoryId, documentId: "doc", chunkId: null, text, context: "fixture context",
    factType: "experience", state: "valid", revision, tags: ["taki-layer:episodes"], metadata: { numeric_value: 1, source_query: "opaque" },
    entities: [], sourceMemoryIds: [], observationScopes: null, eventDate: null, occurredStart: null, occurredEnd: null, mentionedAt: at,
    createdAt: at, updatedAt: at, editedAt: null, consolidatedAt: null, consolidationFailedAt: null, invalidationReason: null, invalidatedAt: null, proofCount: 1 },
  policy: { authorityEpochId: authority, bankId, memoryId, layerId: "episodes", importance: 7, visibility: "retrieved", disclosure: "fixture disclosure",
    origin: "self", emotionalWeight: null, retention: { kind: "permanent" }, policyVersion: 1, updatedAt: at }, provenance: provenance(bankId) };
}
function memory(bankId: string, id: string, input: { revision: number; text: string }): HindsightLogicalSnapshotRecord {
  const { authorityEpochId: _epoch, ...value } = canonical(bankId, id, input).unit; void _epoch;
  return { objectKind: "memory_unit", objectId: id, objectRevision: input.revision, payload: { kind: "memory_unit", value } };
}
function bankRecord(bankId: string): HindsightLogicalSnapshotRecord {
  return { objectKind: "bank", objectId: bankId, objectRevision: 1, payload: { kind: "bank", value: {
    bankId, name: "Fixture", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {}, createdAt: at, updatedAt: at } } };
}
function sourceRecord(bankId: string, id = "doc"): HindsightLogicalSnapshotRecord {
  return { objectKind: "document", objectId: id, objectRevision: 1, payload: { kind: "document", value: {
    documentId: id, bankId, contentHash: "a".repeat(64), tags: [], metadata: {}, observationScopes: null, createdAt: at, updatedAt: at } } };
}
function derived(bankId: string): HindsightLogicalSnapshotRecord[] {
  return [{ objectKind: "mental_model", objectId: "mental", objectRevision: 1, payload: { kind: "mental_model", value: {
    mentalModelId: "mental", bankId, subtype: "mental_model", name: "fixture model", sourceQuery: "fixture query", content: "fixture content",
    tags: [], maxTokens: 128, trigger: { source_query: "opaque" }, lastRefreshedAt: at, createdAt: at, reflectResponse: null,
    structuredContent: { source_memory_ids: ["m2"] } } } },
  { objectKind: "directive", objectId: "directive", objectRevision: 1, payload: { kind: "directive", value: {
    directiveId: "directive", bankId, name: "fixture directive", content: "fixture content", priority: 2, isActive: false, tags: [], createdAt: at, updatedAt: at } } }];
}
const trustedProjection: HindsightReplicaProjection = {
  bankScope: (bankId) => bankId === "global" ? { kind: "global", characterId: null } : { kind: "character", characterId: "taki" },
  source: (record) => ({ retainedText: "retained source", context: null, provenance: provenance(record.payload.value.bankId) }),
  memory: (record) => ({ policy: canonical(record.payload.value.bankId, record.objectId, { revision: record.objectRevision, text: "unused" }).policy,
    provenance: provenance(record.payload.value.bankId) }),
};
const connection: HindsightConnectionProjection = { enabled: true, deploymentMode: "existing-instance", endpoint: "http://127.0.0.1:8888",
  apiKeySecretRef: "memory.hindsight.connection.api-key", requestTimeoutMs: 1000, setupTimeoutMs: 5000, desiredTemplateRevision: "taki-bank-v1",
  model: { defaultProvider: null, defaultModel: null, retainModel: null, reflectModel: null, consolidationModel: null,
    embeddingProvider: null, embeddingModel: null, rerankerProvider: null, rerankerModel: null } };
function compatibility(providerLineage: string) {
  const support = { state: "supported", reason: "all_contracts_available" }; const contract = { version: "1.0.0", support };
  return { base_api_version: "0.9.0", compatibility_version: "1.0.0", source_identity: { upstream_commit: "offline", compatibility_build: "taki-memory-hindsight-0.9.0-batch0-v2" },
    provider: { lineage: providerLineage, database_dialect: "postgresql", storage_mode: "sql_rows" }, support,
    journal: { schema_version: 1, retention_mode: "operator_managed_cursor_floor", cursor_reset_supported: true },
    snapshot: { schema_version: 1, default_page_size: 500, max_page_size: 1000, default_ttl_seconds: 3600, max_ttl_seconds: 86400 },
    contracts: { change_journal: contract, conditional_mutation: contract, logical_snapshot: contract, additive_observation_instructions: contract, controlled_layer_projection: contract } };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}

import { afterEach, describe, expect, it } from "vitest";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createCanonicalIngestionSourceRepo } from "./canonical-ingestion-source-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { createPrimaryMemoryCustody, type PrimaryMemoryCustody } from "./primary-memory-custody-repo.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { createTimelineRepo, type TimelineRepo } from "./timeline-repo.ts";
import { cleanupLegacyMigrationFixtures, createLegacyMigrationFixture } from "../memory/legacy-migration/legacy-migration-fixture.ts";

const NOW = "2026-09-22T00:00:00.000Z";
const opened: Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); cleanupLegacyMigrationFixtures(); });

function memory(): { db: Database; timeline: TimelineRepo } {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); opened.push(db);
  return { db, timeline: createTimelineRepo(db) };
}
function custodyOf(db: Database, bootId = "boot-a", onFailure?: PrimaryMemoryCustodyFailure): PrimaryMemoryCustody {
  return createPrimaryMemoryCustody({ db, bootId, now: () => NOW, onFailure });
}
type PrimaryMemoryCustodyFailure = (input: { groupId: string; code: string }) => void;
const group = (db: Database, id: string) => db.prepare("SELECT * FROM primary_memory_groups WHERE group_id=:id").get({ id })!;
const members = (db: Database, id: string) => db.prepare("SELECT timeline_seq FROM primary_memory_members WHERE group_id=:id ORDER BY timeline_seq").all({ id }).map((row) => Number(row.timeline_seq));
const witnesses = (db: Database, epoch?: string) => db.prepare(`SELECT timeline_seq,committed_through_seq,authority_epoch_id FROM canonical_memory_primary_commits
  ${epoch ? "WHERE authority_epoch_id=:epoch" : ""} ORDER BY timeline_seq`).all(epoch ? { epoch } : undefined);
const user = (content: string) => ({ characterId: "taki", role: "user" as const, content });
const assistant = (content: string) => ({ characterId: "taki", role: "assistant" as const, content });

describe("trusted primary group custody", () => {
  it("registers exact members with each append, refuses foreign characters and closes late appends", () => {
    const { db, timeline } = memory();
    const session = custodyOf(db).begin({ characterId: "taki", runId: "run-x", repo: timeline });
    const first = session.repo.append(user("hello"));
    expect(() => session.repo.append({ characterId: "other", role: "user", content: "spoof" })).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    timeline.append(assistant("autonomous speech outside the group"));
    const reply = session.repo.append(assistant("reply"));
    expect(members(db, session.groupId)).toEqual([first.seq, reply.seq]);
    expect(group(db, session.groupId)).toMatchObject({ state: "open", run_id: "run-x", creator_boot_id: "boot-a", assigned_epoch_id: null });
    session.finalize();
    expect(group(db, session.groupId)).toMatchObject({ state: "finalized", finalized_through_seq: reply.seq, producer_settled: 1 });
    // A finalized Legacy group with no epoch keeps its exact members but writes no Local witness.
    expect(members(db, session.groupId)).toEqual([first.seq, reply.seq]);
    expect(witnesses(db)).toEqual([]);
    expect(() => session.repo.append(assistant("late"))).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    expect(timeline.latestAscending("taki", 10)).toHaveLength(3);
  });

  it("closes a zero-member terminal group as closed-empty and finalizes user-only outcomes", () => {
    const { db, timeline } = memory();
    const custody = custodyOf(db);
    const empty = custody.begin({ characterId: "taki", repo: timeline });
    empty.finalize();
    expect(group(db, empty.groupId)).toMatchObject({ state: "closed-empty", finalized_through_seq: null });
    const userOnly = custody.begin({ characterId: "taki", repo: timeline });
    const row = userOnly.repo.append(user("terminal failure after this"));
    userOnly.finalize();
    expect(group(db, userOnly.groupId)).toMatchObject({ state: "finalized", finalized_through_seq: row.seq });
    userOnly.finalize();
    expect(group(db, userOnly.groupId).state).toBe("finalized");
  });

  it("retracts a silent user-only cancellation atomically and refuses retracting a group with a reply", () => {
    const { db, timeline } = memory();
    const custody = custodyOf(db);
    const session = custody.begin({ characterId: "taki", repo: timeline });
    const row = session.repo.append(user("cancel me"));
    session.repo.deleteEntry("taki", row.seq);
    expect(group(db, session.groupId).state).toBe("retracted");
    expect(members(db, session.groupId)).toEqual([]);
    expect(timeline.latestAscending("taki", 10)).toEqual([]);
    session.finalize();
    expect(group(db, session.groupId).state).toBe("retracted");
    const replied = custody.begin({ characterId: "taki", repo: timeline });
    const again = replied.repo.append(user("kept")); replied.repo.append(assistant("answered"));
    expect(() => replied.repo.deleteEntry("taki", again.seq)).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    expect(timeline.latestAscending("taki", 10)).toHaveLength(2);
    expect(members(db, replied.groupId)).toHaveLength(2);
  });

  it("reconciles only dead-boot or settled groups and blocks recovery on membership corruption", () => {
    const { db, timeline } = memory();
    const bootA = custodyOf(db);
    const running = bootA.begin({ characterId: "taki", repo: timeline }); running.repo.append(user("still streaming"));
    expect(bootA.status()).toEqual({ openGroups: 1, recoverableGroups: 0 });
    expect(bootA.reconcile()).toBe(0);
    const bootB = custodyOf(db, "boot-b");
    expect(bootB.status()).toEqual({ openGroups: 1, recoverableGroups: 1 });
    expect(bootB.reconcile()).toBe(1);
    expect(group(db, running.groupId).state).toBe("finalized");
    const failures: string[] = [];
    const corrupted = custodyOf(db, "boot-b", (failure) => failures.push(failure.code)).begin({ characterId: "taki", repo: timeline });
    const row = corrupted.repo.append(user("original"));
    db.prepare("UPDATE timeline_messages SET content='tampered' WHERE seq=:seq").run({ seq: row.seq });
    corrupted.finalize();
    expect(failures).toEqual(["MEMORY_INGESTION_SOURCE_UNPROVEN"]);
    expect(group(db, corrupted.groupId)).toMatchObject({ state: "open", producer_settled: 1 });
    expect(bootB.status()).toEqual({ openGroups: 1, recoverableGroups: 1 });
    expect(() => bootB.reconcile()).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    expect(group(db, corrupted.groupId).state).toBe("open");
  });

  it("adopts an in-flight group at first candidate publication and witnesses the pre-baseline member on finalize", async () => {
    const fixture = createLegacyMigrationFixture();
    const timeline = createTimelineRepo(fixture.db);
    const session = custodyOf(fixture.db).begin({ characterId: "taki", runId: "chat-run", repo: timeline });
    const first = session.repo.append(user("appended before prepare"));
    expect((await fixture.prepare()).status).toBe("ready");
    const epoch = String(fixture.db.prepare("SELECT epoch_id FROM memory_migration_runs WHERE run_id='run-1'").get()!.epoch_id);
    expect(group(fixture.db, session.groupId)).toMatchObject({ assigned_epoch_id: epoch, original_epoch_id: epoch, state: "open" });
    const sources = createCanonicalIngestionSourceRepo(fixture.db);
    expect(sources.eligibilityStartSeq({ epochId: epoch, characterId: "taki" })).toBe(first.seq + 1);
    const reply = session.repo.append(assistant("finished after prepare"));
    session.finalize();
    expect(witnesses(fixture.db, epoch)).toEqual([
      { timeline_seq: first.seq, committed_through_seq: reply.seq, authority_epoch_id: epoch },
      { timeline_seq: reply.seq, committed_through_seq: reply.seq, authority_epoch_id: epoch }]);
    // The complete-group callback stays an idempotent notification over the same exact rows.
    sources.recordPrimaryCommitted({ characterId: "taki", entries: [first, reply], runId: "chat-run", epochId: epoch });
    expect(witnesses(fixture.db, epoch)).toHaveLength(2);
    // Groups opened after publication attach to the candidate before their first append; a finalized pre-boundary group stays unassigned.
    const later = custodyOf(fixture.db).begin({ characterId: "taki", repo: timeline });
    expect(group(fixture.db, later.groupId).assigned_epoch_id).toBe(epoch);
  });

  it("relocates open and finalized-but-unconsumed groups on replacement and refuses once consumption is proven", async () => {
    const fixture = createLegacyMigrationFixture();
    const timeline = createTimelineRepo(fixture.db);
    const custody = custodyOf(fixture.db);
    expect((await fixture.prepare()).status).toBe("ready");
    const previous = String(fixture.db.prepare("SELECT epoch_id FROM memory_migration_runs WHERE run_id='run-1'").get()!.epoch_id);
    const finalized = custody.begin({ characterId: "taki", repo: timeline });
    const row = finalized.repo.append(user("finalized under run-1")); finalized.repo.append(assistant("reply")); finalized.finalize();
    const open = custody.begin({ characterId: "taki", repo: timeline }); open.repo.append(user("still open under run-1"));
    const preBoundary = fixture.db.prepare("SELECT count(*) AS n FROM primary_memory_groups WHERE assigned_epoch_id IS NULL").get()!.n;
    fixture.clock.now = "2026-08-20T00:10:00.000Z";
    expect((await fixture.prepare({ runId: "run-2", replaceRunId: "run-1" })).status).toBe("ready");
    const next = String(fixture.db.prepare("SELECT epoch_id FROM memory_migration_runs WHERE run_id='run-2'").get()!.epoch_id);
    expect(next).not.toBe(previous);
    expect(group(fixture.db, finalized.groupId)).toMatchObject({ assigned_epoch_id: next, original_epoch_id: previous, state: "finalized" });
    expect(group(fixture.db, open.groupId)).toMatchObject({ assigned_epoch_id: next, original_epoch_id: previous, state: "open" });
    expect(witnesses(fixture.db, previous)).toEqual([]);
    expect(witnesses(fixture.db, next).map((w) => w.timeline_seq)).toEqual([row.seq, row.seq + 1]);
    const sources = createCanonicalIngestionSourceRepo(fixture.db);
    expect(sources.eligibilityStartSeq({ epochId: next, characterId: "taki" })).toBe(1);
    expect(fixture.db.prepare("SELECT count(*) AS n FROM primary_memory_groups WHERE assigned_epoch_id IS NULL").get()!.n).toBe(preBoundary);
    // A late finalize after relocation writes into the current assignment, never the superseded epoch.
    const late = open.repo.append(assistant("late reply")); open.finalize();
    expect(witnesses(fixture.db, next).map((w) => w.timeline_seq)).toContain(late.seq);
    expect(witnesses(fixture.db, previous)).toEqual([]);
    fixture.db.prepare("UPDATE canonical_memory_primary_commits SET ingestion_span_id='consumed' WHERE timeline_seq=:seq").run({ seq: row.seq });
    fixture.clock.now = "2026-08-20T00:20:00.000Z";
    await expect(fixture.prepare({ runId: "run-3", replaceRunId: "run-2" })).rejects.toThrow("MIGRATION_CANDIDATE_CONFLICT");
    expect(group(fixture.db, finalized.groupId).assigned_epoch_id).toBe(next);
  });

  it("makes source flush refuse retirement of unfinalized members below the baseline and assistant-only gaps", () => {
    const { db, timeline } = memory();
    const custody = custodyOf(db);
    const early = custody.begin({ characterId: "taki", repo: timeline });
    const first = early.repo.append(user("before any baseline"));
    const epoch = createCanonicalMemoryAuthorityRepo(db).initializeLocalAuthority(NOW).epochId;
    db.prepare(`UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,verified_snapshot_id='s',activation_transaction_id='t' WHERE singleton=1`).run({ epoch });
    const sources = createCanonicalIngestionSourceRepo(db);
    sources.initializeBaseline({ epochId: epoch, characterId: "taki", throughSeq: first.seq, now: NOW });
    const scope = { epochId: epoch, characterId: "taki" };
    expect(() => sources.advanceCoverage({ ...scope, throughSeq: first.seq, now: NOW })).toThrow("MEMORY_INGESTION_INCOMPLETE");
    early.finalize();
    expect(sources.advanceCoverage({ ...scope, throughSeq: first.seq, now: NOW })).toBe(0);
    const gap = custody.begin({ characterId: "taki", repo: timeline });
    const only = gap.repo.append(assistant("assistant-only member"));
    expect(() => sources.advanceCoverage({ ...scope, throughSeq: only.seq, now: NOW })).toThrow("MEMORY_INGESTION_INCOMPLETE");
  });
});

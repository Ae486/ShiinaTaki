import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRunReference } from "../memory/memory-capability-snapshot.ts";
import { LOCAL_MEMORY_CAPABILITIES } from "../memory/local-memory-provider.ts";
import { primaryEntryDigest } from "../memory/canonical-ingestion-source.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createPrimaryConversationSourceRepo } from "./primary-conversation-source-repo.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { createTimelineRepo, type AppendInput } from "./timeline-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
const user = { characterId: "taki", role: "user", content: "Remember I cannot eat peanuts." } as const;
const responses: AppendInput[] = [
  { characterId: "taki", role: "assistant", content: "actual partial response" },
  { characterId: "taki", role: "tool", content: "actual tool result", parts: [
    { type: "tool-result", toolCallId: "call", toolName: "lookup", output: { type: "text", value: "found" } },
  ] },
  { characterId: "taki", role: "assistant", content: "I will keep that constraint." },
];
function fixture(path = ":memory:") {
  const db = openDatabase({ path, migrations: MIGRATIONS }); cleanup.push(() => db.close());
  const timeline = createTimelineRepo(db); const repo = createPrimaryConversationSourceRepo({ db, timeline });
  return { db, timeline, repo };
}
function filePath() {
  const root = mkdtempSync(join(tmpdir(), "taki-primary-source-")); cleanup.push(() => rmTempDir(root)); return join(root, "state.db");
}
function memoryReference() {
  return createMemoryRunReference({ providerId: "local", contractVersion: 1, capabilities: LOCAL_MEMORY_CAPABILITIES,
    authorityEpochId: "captured-epoch", providerLineageId: "captured-lineage" });
}
function state(db: Database, sourceId: string) {
  return db.prepare("SELECT state FROM primary_conversation_sources WHERE source_id=:source").get({ source: sourceId })?.state;
}

describe("atomic primary source lifecycle", () => {
  it("captures a provider-independent identity, retains exact rows and rejects duplicate/conflicting tails", () => {
    const { db, repo, timeline } = fixture(); const memory = memoryReference();
    const opened = repo.begin({ user, runId: "original-run", memory });
    expect(repo.listUnbound({ characterId: "taki", memory })).toEqual([]);
    const committed = repo.retain({ sourceId: opened.sourceId, rows: responses });
    expect(committed.committed).toBe(true);
    const source = repo.readRetained(opened.sourceId);
    expect(source).toMatchObject({ ...opened, runId: "original-run", memory, throughSeq: committed.entries.at(-1)?.seq });
    expect(source.entries).toEqual([opened.userEntry, ...committed.entries]);
    expect(repo.retain({ sourceId: opened.sourceId, rows: responses })).toEqual({ ...committed, committed: false });
    expect(() => repo.retain({ sourceId: opened.sourceId, rows: responses.slice(0, 1) })).toThrow("PRIMARY_SOURCE_CONFLICT");
    expect(() => repo.retract(opened.sourceId)).toThrow("PRIMARY_SOURCE_CONFLICT");
    expect(timeline.latestAscending("taki", 20)).toEqual(source.entries);
    expect(db.prepare("SELECT * FROM canonical_memory_authority_state").all()).toEqual([]);
  });

  it("retracts the user and preserves an immutable source tombstone across reopen", () => {
    const path = filePath(); const first = fixture(path); const opened = first.repo.begin({ user });
    expect(first.repo.retract(opened.sourceId)).toEqual({ userEntry: opened.userEntry, committed: true });
    first.db.close(); const next = fixture(path);
    expect(next.repo.retract(opened.sourceId)).toEqual({ userEntry: undefined, committed: false });
    expect(next.timeline.latestAscending("taki", 20)).toEqual([]);
    expect(state(next.db, opened.sourceId)).toBe("retracted");
    expect(() => next.repo.retain({ sourceId: opened.sourceId, rows: responses })).toThrow("PRIMARY_SOURCE_CONFLICT");
    expect(() => next.db.exec("DELETE FROM primary_conversation_sources")).toThrow("PRIMARY_SOURCE_IMMUTABLE");
    expect(next.repo.recoverOpen()).toEqual({ retainedSourceIds: [], unresolvedSourceIds: [] });
  });

  it.each(["source", "link"])("rolls back begin when the %s write fails", (cut) => {
    const { db, repo, timeline } = fixture();
    db.exec(cut === "source"
      ? "CREATE TRIGGER fail_source BEFORE INSERT ON primary_conversation_sources BEGIN SELECT RAISE(ABORT,'cut'); END"
      : "CREATE TRIGGER fail_link BEFORE UPDATE OF primary_source_id ON timeline_messages BEGIN SELECT RAISE(ABORT,'cut'); END");
    expect(() => repo.begin({ user })).toThrow("cut");
    expect(timeline.latestAscending("taki", 20)).toEqual([]);
    expect(db.prepare("SELECT * FROM primary_conversation_sources").all()).toEqual([]);
  });

  it.each(["row", "seal"])("reopens after a failed %s write with only the actual input retained", (cut) => {
    const path = filePath(); const first = fixture(path); const opened = first.repo.begin({ user });
    first.db.exec(cut === "row"
      ? "CREATE TRIGGER fail_response BEFORE INSERT ON timeline_messages WHEN NEW.role='tool' BEGIN SELECT RAISE(ABORT,'cut'); END"
      : "CREATE TRIGGER fail_response BEFORE UPDATE ON primary_conversation_sources BEGIN SELECT RAISE(ABORT,'cut'); END");
    expect(() => first.repo.retain({ sourceId: opened.sourceId, rows: responses })).toThrow("cut");
    expect(first.timeline.latestAscending("taki", 20)).toEqual([opened.userEntry]);
    expect(state(first.db, opened.sourceId)).toBe("open");
    first.db.exec("DROP TRIGGER fail_response"); first.db.close();
    const next = fixture(path);
    expect(next.repo.recoverOpen()).toEqual({ retainedSourceIds: [opened.sourceId], unresolvedSourceIds: [] });
    expect(next.repo.readRetained(opened.sourceId).entries).toEqual([opened.userEntry]);
    expect(next.repo.recoverOpen()).toEqual({ retainedSourceIds: [], unresolvedSourceIds: [] });
    expect(next.db.prepare("SELECT * FROM runs").all()).toEqual([]);
  });

  it("reopens committed retained rows and duplicate input without appending", () => {
    const path = filePath(); const first = fixture(path); const opened = first.repo.begin({ user });
    first.repo.retain({ sourceId: opened.sourceId, rows: responses });
    const before = first.repo.readRetained(opened.sourceId); first.db.close(); const next = fixture(path);
    expect(next.repo.readRetained(opened.sourceId)).toEqual(before);
    expect(next.repo.retain({ sourceId: opened.sourceId, rows: responses }).committed).toBe(false);
    expect(next.repo.readRetained(opened.sourceId)).toEqual(before);
  });

  it("rolls back retraction and outer retention without publishing or losing the user", () => {
    const { db, repo, timeline } = fixture(); const opened = repo.begin({ user }); let published = false;
    db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON timeline_messages BEGIN SELECT RAISE(ABORT,'cut'); END");
    expect(() => repo.retract(opened.sourceId)).toThrow("cut");
    expect(state(db, opened.sourceId)).toBe("open");
    expect(() => db.transaction(() => {
      repo.retain({ sourceId: opened.sourceId, rows: responses });
      db.afterCommit(() => { published = true; }); throw new Error("outer cut");
    })).toThrow("outer cut");
    expect(published).toBe(false); expect(state(db, opened.sourceId)).toBe("open");
    expect(timeline.latestAscending("taki", 20)).toEqual([opened.userEntry]);
  });
});

describe("source integrity and selection", () => {
  it("refuses closed-source append/rebind/delete and detects a changed or omitted middle row", () => {
    const { db, repo, timeline } = fixture(); const opened = repo.begin({ user });
    const retained = repo.retain({ sourceId: opened.sourceId, rows: responses }); const middle = retained.entries[1]!;
    const ordinary = timeline.append({ ...user, role: "assistant", content: "unrelated" });
    expect(() => db.prepare("UPDATE timeline_messages SET primary_source_id=:source WHERE seq=:seq")
      .run({ source: opened.sourceId, seq: ordinary.seq })).toThrow("PRIMARY_SOURCE_MEMBERSHIP");
    expect(() => db.prepare("UPDATE timeline_messages SET primary_source_id=NULL WHERE seq=:seq").run({ seq: middle.seq }))
      .toThrow("PRIMARY_SOURCE_MEMBERSHIP");
    expect(() => timeline.deleteEntry("taki", middle.seq)).toThrow("PRIMARY_SOURCE_MEMBERSHIP");
    db.prepare("UPDATE timeline_messages SET content='tampered' WHERE seq=:seq").run({ seq: middle.seq });
    expect(() => repo.readRetained(opened.sourceId)).toThrow("PRIMARY_SOURCE_UNPROVEN");
    db.prepare("UPDATE timeline_messages SET content=:content WHERE seq=:seq").run({ content: middle.content, seq: middle.seq });
    db.exec("DROP TRIGGER timeline_primary_source_delete"); timeline.deleteEntry("taki", middle.seq);
    expect(() => repo.readRetained(opened.sourceId)).toThrow("PRIMARY_SOURCE_UNPROVEN");
    expect(() => repo.retain({ sourceId: opened.sourceId, rows: responses })).toThrow("PRIMARY_SOURCE_UNPROVEN");
  });

  it("isolates corrupt/missing/extra open members while recovering a later input", () => {
    const path = filePath(); const first = fixture(path);
    const changed = first.repo.begin({ user }); const missing = first.repo.begin({ user });
    const extra = first.repo.begin({ user }); const valid = first.repo.begin({ user });
    first.db.prepare("UPDATE timeline_messages SET content='changed' WHERE seq=:seq").run({ seq: changed.userEntry.seq });
    first.db.exec("DROP TRIGGER timeline_primary_source_delete"); first.timeline.deleteEntry("taki", missing.userEntry.seq);
    const unexpected = first.timeline.append(responses[0]!);
    first.db.prepare("UPDATE timeline_messages SET primary_source_id=:source WHERE seq=:seq")
      .run({ source: extra.sourceId, seq: unexpected.seq });
    first.db.close(); const next = fixture(path);
    expect(next.repo.recoverOpen()).toEqual({ retainedSourceIds: [valid.sourceId],
      unresolvedSourceIds: [changed.sourceId, missing.sourceId, extra.sourceId] });
    expect(next.repo.readRetained(valid.sourceId).entries).toEqual([valid.userEntry]);
    expect(next.repo.recoverOpen().unresolvedSourceIds).toEqual([changed.sourceId, missing.sourceId, extra.sourceId]);
  });

  it("selects only exact captured scope and excludes either provider's existing occurrence", () => {
    const { db, repo } = fixture(); const memory = memoryReference();
    const opened = Array.from({ length: 3 }, () => repo.begin({ user, memory }));
    for (const source of opened) repo.retain({ sourceId: source.sourceId, rows: [] });
    const absent = repo.begin({ user, runId: "missing-snapshot" }); repo.retain({ sourceId: absent.sourceId, rows: [] });
    expect(repo.listUnbound({ characterId: "taki", memory, limit: 1 })).toEqual([opened[0]!.sourceId]);
    const changedCapabilities = { ...memory, capabilityDigest: "0".repeat(64), capabilities: { ...memory.capabilities, reflect: false } };
    expect(repo.listUnbound({ characterId: "taki", memory: changedCapabilities })).toEqual(opened.map((source) => source.sourceId));
    expect(repo.listUnbound({ characterId: "taki", memory: { ...memory, authorityEpochId: "another" } })).toEqual([]);
    expect(repo.listUnbound({ characterId: "taki", memory: { ...memory, providerLineageId: "another" } })).toEqual([]);
    expect(repo.listUnbound({ characterId: "other", memory })).toEqual([]);
    const epoch = createCanonicalMemoryAuthorityRepo(db).initializeLocalAuthority();
    for (const [index, table] of ["canonical_memory_primary_commits", "hindsight_ingestion_primary_commits"].entries()) {
      const entry = opened[index]!.userEntry;
      db.prepare(`INSERT INTO ${table}
        (timeline_seq,character_id,entry_id,entry_digest,run_id,committed_at,committed_through_seq,authority_epoch_id)
        VALUES (:seq,'taki',:id,:digest,NULL,:at,:seq,:epoch)`)
        .run({ seq: entry.seq, id: entry.id, digest: primaryEntryDigest(entry), at: entry.createdAt, epoch: epoch.epochId });
    }
    expect(repo.listUnbound({ characterId: "taki", memory })).toEqual([opened[2]!.sourceId]);
  });

  it("captures selected Local authority without a Run and refuses a missing local marker before the user write", () => {
    const { db, repo, timeline } = fixture(); const epoch = createCanonicalMemoryAuthorityRepo(db).initializeLocalAuthority();
    db.prepare(`UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,
      verified_snapshot_id='verified',activation_transaction_id='activation' WHERE singleton=1`).run({ epoch: epoch.epochId });
    const opened = repo.begin({ user }); repo.retain({ sourceId: opened.sourceId, rows: [] });
    const identity = { providerId: "local", authorityEpochId: epoch.epochId, providerLineageId: epoch.providerLineageId };
    expect(repo.readRetained(opened.sourceId).memory).toEqual(identity);
    expect(repo.listUnbound({ characterId: "taki", memory: identity })).toEqual([opened.sourceId]);
    db.exec("DELETE FROM memory_authority_selection");
    expect(() => repo.begin({ user })).toThrow("PRIMARY_SOURCE_MEMORY_IDENTITY_UNPROVEN");
    expect(timeline.latestAscending("taki", 20)).toEqual([opened.userEntry]);
  });
});

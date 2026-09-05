import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { createSummaryRepo } from "./summary-repo.ts";
import { createCompactionOperationRepo, type BeginCompactionInput, type CompactionLease } from "./compaction-operation-repo.ts";
import { rmTempDir } from "../testing/rm-temp.ts";

const dbs: Database[] = [];
const roots: string[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const root of roots.splice(0)) rmTempDir(root);
});

const NOW = "2026-08-30T00:00:00.000Z";
const LATER = "2026-08-30T00:10:00.000Z";
const DIGEST = "a".repeat(64);

function open(path = ":memory:") {
  const db = openDatabase({ path, migrations: MIGRATIONS });
  dbs.push(db);
  return { db, repo: createCompactionOperationRepo(db), summaries: createSummaryRepo(db) };
}

function input(overrides: Partial<BeginCompactionInput> = {}): BeginCompactionInput {
  return {
    operationId: "compact:" + "b".repeat(64), characterId: "taki", reason: "pressure",
    selectedFromSeq: 1, selectedThroughSeq: 6, capturedTailSeq: 10,
    expectedSummaryRevision: 0, expectedSummaryThrough: 0, sourceDigest: DIGEST,
    beforeTokens: 90, provider: "mock-provider", modelId: "mock-model", owner: "generation-a",
    now: NOW, expiresAt: LATER, ...overrides,
  };
}

function startedLease(result: ReturnType<ReturnType<typeof open>["repo"]["begin"]>): CompactionLease {
  if (result.status !== "started") throw new Error("expected started operation");
  return result.lease;
}

describe("CompactionOperationRepo", () => {
  it("owns one durable open lease per Character and keeps other Characters isolated", () => {
    const f = open();
    const first = f.repo.begin(input());
    const duplicate = f.repo.begin(input({ operationId: "compact:" + "c".repeat(64), owner: "generation-b" }));
    const other = f.repo.begin(input({ operationId: "compact:" + "d".repeat(64), characterId: "yui" }));

    expect(first.status).toBe("started");
    expect(duplicate).toMatchObject({ status: "active", operation: { characterId: "taki" } });
    expect(other.status).toBe("started");
    expect(f.repo.events(input().operationId).map((event) => event.kind)).toEqual(["started"]);
  });

  it("reuses the same operation identity across failed retries with a higher fence and attempt ordinal", () => {
    const f = open();
    const lease1 = startedLease(f.repo.begin(input()));
    expect(f.repo.fail({ lease: lease1, code: "SUMMARY_GENERATION_FAILED", now: "2026-08-30T00:01:00.000Z" })).toBe(true);

    const lease2 = startedLease(f.repo.begin(input({ owner: "generation-b", capturedTailSeq: 11,
      now: "2026-08-30T00:02:00.000Z",
      expiresAt: "2026-08-30T00:12:00.000Z" })));

    expect(lease2).toMatchObject({ operationId: lease1.operationId, attemptNo: 2, fence: 2 });
    expect(f.repo.get(lease2.operationId)?.capturedTailSeq).toBe(11);
    expect(f.repo.events(lease1.operationId).map((event) => [event.attemptNo, event.kind])).toEqual([
      [1, "started"], [1, "failed"], [2, "started"],
    ]);
    expect(f.repo.commitSummary({ lease: lease1, text: "stale", sourceDigest: DIGEST,
      now: "2026-08-30T00:03:00.000Z" })).toBe("stale");
    expect(f.repo.recordSummaryGenerated({ lease: lease1, outputChars: 5,
      now: "2026-08-30T00:03:00.000Z" })).toBe(false);
  });

  it("rejects discontinuous ranges and conflicting reuse of a stable operation identity", () => {
    const f = open();
    expect(() => f.repo.begin(input({ selectedFromSeq: 2 }))).toThrow();
    expect(f.db.prepare("SELECT count(*) AS count FROM conversation_compaction_operations").get()?.count).toBe(0);

    const lease = startedLease(f.repo.begin(input()));
    expect(() => f.repo.begin(input({ selectedThroughSeq: 7, capturedTailSeq: 11 })))
      .toThrow("COMPACTION_OPERATION_ID_CONFLICT");
    expect(f.repo.commitSummary({ lease, text: "committed", sourceDigest: DIGEST,
      now: "2026-08-30T00:01:00.000Z" })).toBe("committed");
    expect(() => f.repo.begin(input({ selectedThroughSeq: 7, capturedTailSeq: 11,
      now: "2026-08-30T00:02:00.000Z", expiresAt: "2026-08-30T00:12:00.000Z" })))
      .toThrow("COMPACTION_OPERATION_ID_CONFLICT");
  });

  it("commits summary replacement and terminal success evidence atomically with exact duplicate idempotency", () => {
    const f = open();
    let lease = startedLease(f.repo.begin(input()));
    lease = f.repo.recordFlush({ lease, status: "success", writes: 2, now: "2026-08-30T00:01:00.000Z",
      expiresAt: "2026-08-30T00:11:00.000Z" })!;
    expect(f.repo.recordSummaryGenerated({ lease, outputChars: 12, now: "2026-08-30T00:02:00.000Z" })).toBe(true);

    expect(f.repo.commitSummary({ lease, text: "durable summary", sourceDigest: DIGEST,
      now: "2026-08-30T00:03:00.000Z" })).toBe("committed");
    expect(f.repo.commitSummary({ lease, text: "must not replace", sourceDigest: DIGEST,
      now: "2026-08-30T00:04:00.000Z" })).toBe("duplicate");

    expect(f.summaries.getCheckpoint("taki")).toEqual({
      throughSeq: 6, text: "durable summary", revision: 1, lastOperationId: lease.operationId,
      sourceFromSeq: 1, sourceThroughSeq: 6, sourceDigest: DIGEST, capturedTailSeq: 10,
    });
    expect(f.repo.events(lease.operationId).map((event) => event.kind)).toEqual([
      "started", "flush_completed", "summary_generated", "committed",
    ]);
  });

  it("rolls back the summary when immutable terminal evidence cannot be appended", () => {
    const f = open();
    const lease = startedLease(f.repo.begin(input()));
    f.db.exec(`CREATE TRIGGER reject_compaction_commit BEFORE INSERT ON conversation_compaction_events
      WHEN NEW.kind='committed' BEGIN SELECT RAISE(ABORT, 'evidence unavailable'); END;`);

    expect(() => f.repo.commitSummary({ lease, text: "must roll back", sourceDigest: DIGEST,
      now: "2026-08-30T00:01:00.000Z" })).toThrow("evidence unavailable");

    expect(f.summaries.get("taki")).toBeNull();
    expect(f.repo.get(lease.operationId)?.state).toBe("open");
    expect(f.repo.events(lease.operationId).map((event) => event.kind)).toEqual(["started"]);
  });

  it("rejects a competing summary revision without advancing the captured checkpoint", () => {
    const f = open();
    const lease = startedLease(f.repo.begin(input()));
    f.summaries.upsert({ characterId: "taki", throughSeq: 2, text: "newer authority" });

    expect(f.repo.commitSummary({ lease, text: "stale generated text", sourceDigest: DIGEST,
      now: "2026-08-30T00:01:00.000Z" })).toBe("conflict");
    expect(f.summaries.get("taki")).toEqual({ throughSeq: 2, text: "newer authority" });
    expect(f.repo.get(lease.operationId)).toMatchObject({ state: "failed", failureCode: "SUMMARY_CONFLICT" });
    expect(f.repo.get(lease.operationId)).toMatchObject({ updatedAt: "2026-08-30T00:01:00.000Z", terminalAt: "2026-08-30T00:01:00.000Z" });
  });

  it("persists cancellation before abort and never turns it into a checkpoint", () => {
    const f = open();
    const lease = startedLease(f.repo.begin(input()));

    expect(f.repo.cancelActive({ characterId: "taki", now: "2026-08-30T00:01:00.000Z" })).toEqual({
      operationId: lease.operationId,
    });
    expect(f.repo.commitSummary({ lease, text: "late", sourceDigest: DIGEST,
      now: "2026-08-30T00:02:00.000Z" })).toBe("stale");
    expect(f.summaries.get("taki")).toBeNull();
    expect(f.repo.get(lease.operationId)?.state).toBe("cancelled");
  });

  it("reconciles only expired open work after reopen and remains idempotent across terminal states", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-compaction-reopen-")); roots.push(root);
    const path = join(root, "taki.db");
    const first = open(path);
    startedLease(first.repo.begin(input({ operationId: "compact:" + "1".repeat(64), characterId: "taki",
      expiresAt: "2026-08-30T00:05:00.000Z" })));
    const openLease = startedLease(first.repo.begin(input({ operationId: "compact:" + "2".repeat(64), characterId: "yui",
      expiresAt: "2026-08-30T01:00:00.000Z" })));
    const failed = startedLease(first.repo.begin(input({ operationId: "compact:" + "3".repeat(64), characterId: "moca" })));
    first.repo.fail({ lease: failed, code: "SUMMARY_EMPTY", now: "2026-08-30T00:01:00.000Z" });
    const cancelled = startedLease(first.repo.begin(input({ operationId: "compact:" + "4".repeat(64), characterId: "rimi" })));
    first.repo.cancelActive({ characterId: "rimi", now: "2026-08-30T00:01:00.000Z" });
    const committed = startedLease(first.repo.begin(input({ operationId: "compact:" + "5".repeat(64), characterId: "sayo" })));
    first.repo.commitSummary({ lease: committed, text: "committed", sourceDigest: DIGEST,
      now: "2026-08-30T00:01:00.000Z" });
    first.db.close(); dbs.splice(dbs.indexOf(first.db), 1);

    const reopened = open(path);
    expect(reopened.repo.reconcileExpired("2026-08-30T00:06:00.000Z")).toBe(1);
    expect(reopened.repo.reconcileExpired("2026-08-30T00:06:00.000Z")).toBe(0);
    expect(reopened.repo.active("yui")?.operationId).toBe(openLease.operationId);
    expect(reopened.repo.get(failed.operationId)?.state).toBe("failed");
    expect(reopened.repo.get(cancelled.operationId)?.state).toBe("cancelled");
    expect(reopened.repo.get(committed.operationId)?.state).toBe("committed");
    expect(reopened.repo.events("compact:" + "1".repeat(64)).map((event) => event.kind)).toEqual(["started", "abandoned"]);
  });

  it("bounds every persisted field and stores no content-bearing failure evidence", () => {
    const f = open();
    expect(() => f.repo.begin(input({ provider: "x".repeat(101) }))).toThrow();
    expect(f.db.prepare("SELECT count(*) AS count FROM conversation_compaction_operations").get()?.count).toBe(0);

    const lease = startedLease(f.repo.begin(input()));
    f.repo.fail({ lease, code: "MEMORY_FLUSH_FAILED", now: "2026-08-30T00:01:00.000Z" });
    const durable = JSON.stringify({ operation: f.repo.get(lease.operationId), events: f.repo.events(lease.operationId) });
    expect(durable).not.toContain("prompt");
    expect(durable).not.toContain("secret");
    expect(durable).not.toContain("authorization");
    expect(durable).not.toContain("tool payload");
  });
});

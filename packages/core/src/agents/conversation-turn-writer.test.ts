import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineCommittedSchema, type TimelineCommitted } from "@taki/shared";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createPrimaryConversationSourceRepo } from "../db/primary-conversation-source-repo.ts";
import { createConversationStore } from "./conversation-store.ts";
import type { TurnCommitInput } from "./conversation-turn-writer.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  const repo = createTimelineRepo(db);
  const commits: TimelineCommitted[] = [];
  const visibleCounts: number[] = [];
  const appended = vi.fn(() => visibleCounts.push(repo.latestAscending("taki", 20).length));
  const store = createConversationStore({ repo, onAppend: appended, onCommit: (batch) => commits.push(TimelineCommittedSchema.parse(batch)) });
  const input: TurnCommitInput = {
    characterId: "taki", messages: [{ role: "assistant", content: "A" }, { role: "assistant", content: "B" }],
    presentation: { messageId: "message", activitySeq: 3,
      references: (row, index) => [{ kind: "text", itemId: String(index), order: index, start: 0, end: row.content.length }] },
  };
  return { db, repo, commits, appended, visibleCounts, store, input };
}

describe("atomic conversation turn writer", () => {
  it("publishes source begin/retention/retraction only after the outer commit and suppresses duplicates", () => {
    const f = fixture(); const sources = createPrimaryConversationSourceRepo({ db: f.db, timeline: f.repo });
    const onAppend = vi.fn(); const onCommit = vi.fn(); const onRemove = vi.fn();
    const store = createConversationStore({ repo: f.repo,
      primarySources: { repo: sources, afterCommit: (notify) => f.db.afterCommit(notify) }, onAppend, onCommit, onRemove });
    expect(() => f.db.transaction(() => {
      store.beginPrimary({ characterId: "taki", text: "rolled back" });
      expect(onAppend).not.toHaveBeenCalled(); throw new Error("outer rollback");
    })).toThrow("outer rollback");
    expect(onAppend).not.toHaveBeenCalled(); expect(f.repo.latestSeq("taki")).toBe(0);
    const opened = store.beginPrimary({ characterId: "taki", text: "actual input" });
    onAppend.mockClear();
    expect(() => f.db.transaction(() => {
      store.commitTurn({ ...f.input, primarySourceId: opened.sourceId });
      expect(onAppend).not.toHaveBeenCalled(); expect(onCommit).not.toHaveBeenCalled(); throw new Error("outer rollback");
    })).toThrow("outer rollback");
    expect(onAppend).not.toHaveBeenCalled(); expect(onCommit).not.toHaveBeenCalled();
    const result = store.commitTurn({ ...f.input, primarySourceId: opened.sourceId });
    expect(result).toHaveLength(2); expect(onAppend).toHaveBeenCalledTimes(2); expect(onCommit).toHaveBeenCalledTimes(1);
    expect(store.commitTurn({ ...f.input, primarySourceId: opened.sourceId })).toEqual(result);
    expect(onAppend).toHaveBeenCalledTimes(2); expect(onCommit).toHaveBeenCalledTimes(1);
    const cancelled = store.beginPrimary({ characterId: "taki", text: "cancel" });
    f.db.transaction(() => { store.retractPrimary(cancelled.sourceId!); expect(onRemove).not.toHaveBeenCalled(); });
    expect(onRemove).toHaveBeenCalledExactlyOnceWith({ characterId: "taki", seq: cancelled.userEntry.seq });
    store.retractPrimary(cancelled.sourceId!); expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("commits the whole validated batch before any legacy append or commit observer", () => {
    const f = fixture();
    f.store.commitTurn(f.input);
    expect(f.appended).toHaveBeenCalledTimes(2);
    expect(f.visibleCounts).toEqual([2, 2]);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]?.entries.map((row) => row.presentation?.entryIndex)).toEqual([0, 1]);
    expect(f.commits[0]?.entries.map((row) => row.content)).toEqual(["A", "B"]);
    expect(f.store.history("taki")).toEqual([{ role: "assistant", content: "A" }, { role: "assistant", content: "B" }]);
  });

  it("rolls back an insert failure with zero partial rows and zero notifications", () => {
    const f = fixture();
    f.db.exec("CREATE TRIGGER fail_second BEFORE INSERT ON timeline_messages WHEN NEW.content = 'B' BEGIN SELECT RAISE(ABORT,'fixture insert failure'); END;");
    expect(() => f.store.commitTurn(f.input)).toThrow("fixture insert failure");
    expect(f.repo.latestAscending("taki", 20)).toEqual([]);
    expect(f.appended).not.toHaveBeenCalled();
    expect(f.commits).toEqual([]);
  });

  it("validates every canonical input before the first write and still permits an empty committed batch", () => {
    const f = fixture();
    expect(() => f.repo.appendBatch([{ characterId: "taki", role: "assistant", content: "A" },
      { characterId: "taki", role: "assistant", content: null } as never])).toThrow();
    expect(f.repo.latestSeq("taki")).toBe(0);
    f.store.commitTurn({ ...f.input, messages: [] });
    expect(f.commits).toEqual([{ characterId: "taki", messageId: "message", activitySeq: 3, entries: [] }]);
    expect(f.repo.latestSeq("taki")).toBe(0);
  });

  it("omits corrupt optional DB metadata without changing replay or canonical output", () => {
    const f = fixture();
    f.store.commitTurn(f.input);
    const replay = JSON.stringify(f.store.history("taki"));
    const entries = f.commits[0]!.entries;
    for (const corruption of ["json", "header", "references"] as const) {
      for (const entry of entries) {
        const header = entry.presentation!;
        const presentation = corruption === "json" ? "invalid JSON" : JSON.stringify(corruption === "header"
          ? { ...header, entryIndex: header.entryCount }
          : { ...header, references: [{ kind: "text", itemId: "bad", order: 0, start: 0, end: 999 }] });
        f.db.prepare("UPDATE timeline_messages SET presentation = :presentation WHERE seq = :seq").run({ presentation, seq: entry.seq });
      }
      const read = f.repo.latestAscending("taki", 20);
      expect(read.map((row) => row.presentation)).toEqual(corruption === "references"
        ? entries.map((entry) => ({ ...entry.presentation, references: [] })) : [undefined, undefined]);
      expect(read.map((row) => [row.content, row.parts])).toEqual(entries.map((row) => [row.content, row.parts]));
      expect(JSON.stringify(f.store.history("taki"))).toBe(replay);
    }
  });

  it("isolates observer failures and keeps a prepared name snapshot across all rows", () => {
    const f = fixture();
    const names = { route: "captured" };
    const commits: TimelineCommitted[] = [];
    const store = createConversationStore({ repo: f.repo, onAppend: () => { names.route = "new"; throw new Error("closed observer"); },
      onCommit: (batch) => commits.push(batch) });
    store.commitTurn({ ...f.input, toolDisplayNames: names, messages: [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "call", toolName: "route", input: { secret: "raw" } }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "call", toolName: "route", output: { type: "json", value: { value: "business" } } }] },
    ], presentation: { messageId: "message", activitySeq: 3,
      references: () => [{ kind: "tool", itemId: "invocation", order: 0, partIndex: 0, outcome: "completed" }] } });
    expect(commits).toHaveLength(1);
    expect(f.repo.latestAscending("taki", 20).map((row) => row.parts?.[0])).toMatchObject([
      { displayName: "captured" }, { displayName: "captured", output: { value: { value: "business" } } },
    ]);
    expect(JSON.stringify(f.repo.latestAscending("taki", 20))).not.toContain("secret");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryAutoRepo, type MemoryAutoRepo } from "./memory-auto-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";

let db: Database;
let repo: MemoryAutoRepo;

beforeEach(() => {
  db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  repo = createMemoryAutoRepo(db);
});

afterEach(() => {
  db.close();
});

describe("createMemoryAutoRepo (T1)", () => {
  it("returns zero watermarks for a character with no state row", () => {
    expect(repo.get("taki")).toEqual({ lastEpisodicSeq: 0, lastFlushSeq: 0, lastTidyAt: null });
  });

  it("upserts each watermark independently without clobbering the other", () => {
    repo.setEpisodic("taki", 20);
    expect(repo.get("taki")).toEqual({ lastEpisodicSeq: 20, lastFlushSeq: 0, lastTidyAt: null });

    repo.setFlush("taki", 5);
    expect(repo.get("taki")).toEqual({ lastEpisodicSeq: 20, lastFlushSeq: 5, lastTidyAt: null });

    repo.setEpisodic("taki", 40); // second update on an existing row
    expect(repo.get("taki")).toEqual({ lastEpisodicSeq: 40, lastFlushSeq: 5, lastTidyAt: null });
  });

  it("keeps each character's watermarks isolated", () => {
    repo.setEpisodic("taki", 20);
    repo.setFlush("yui", 3);

    expect(repo.get("taki")).toEqual({ lastEpisodicSeq: 20, lastFlushSeq: 0, lastTidyAt: null });
    expect(repo.get("yui")).toEqual({ lastEpisodicSeq: 0, lastFlushSeq: 3, lastTidyAt: null });
  });
});

describe("tidy watermark (T5 batch 4)", () => {
  it("starts null and advances without touching the seq watermarks", () => {
    repo.setEpisodic("taki", 20);
    expect(repo.get("taki").lastTidyAt).toBeNull(); // null = never tidied, the writes-since-mark baseline

    repo.setTidy("taki", "2026-07-30T09:00:00.000Z");
    expect(repo.get("taki")).toEqual({
      lastEpisodicSeq: 20,
      lastFlushSeq: 0,
      lastTidyAt: "2026-07-30T09:00:00.000Z",
    });
  });

  it("creates the row on a first tidy and stays per-character", () => {
    repo.setTidy("taki", "2026-07-30T09:00:00.000Z");
    repo.setTidy("taki", "2026-07-30T21:00:00.000Z"); // a later pass overwrites the mark

    expect(repo.get("taki").lastTidyAt).toBe("2026-07-30T21:00:00.000Z");
    expect(repo.get("yui").lastTidyAt).toBeNull();
  });
});

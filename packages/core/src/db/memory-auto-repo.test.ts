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
    expect(repo.get("taki")).toEqual({ lastEpisodicSeq: 0, lastFlushSeq: 0 });
  });

  it("upserts each watermark independently without clobbering the other", () => {
    repo.setEpisodic("taki", 20);
    expect(repo.get("taki")).toEqual({ lastEpisodicSeq: 20, lastFlushSeq: 0 });

    repo.setFlush("taki", 5);
    expect(repo.get("taki")).toEqual({ lastEpisodicSeq: 20, lastFlushSeq: 5 });

    repo.setEpisodic("taki", 40); // second update on an existing row
    expect(repo.get("taki")).toEqual({ lastEpisodicSeq: 40, lastFlushSeq: 5 });
  });

  it("keeps each character's watermarks isolated", () => {
    repo.setEpisodic("taki", 20);
    repo.setFlush("yui", 3);

    expect(repo.get("taki")).toEqual({ lastEpisodicSeq: 20, lastFlushSeq: 0 });
    expect(repo.get("yui")).toEqual({ lastEpisodicSeq: 0, lastFlushSeq: 3 });
  });
});

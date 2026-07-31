import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryRepo, type MemoryRepo, type MemoryUpsert } from "./memory-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";

let db: Database;
let repo: MemoryRepo;

beforeEach(() => {
  db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  repo = createMemoryRepo(db);
});

afterEach(() => {
  db.close();
});

const MARK = "2026-07-20T00:00:00.000Z";
const BEFORE = "2026-07-10T00:00:00.000Z";
const AFTER = "2026-07-25T00:00:00.000Z";
const NOW = "2026-07-30T00:00:00.000Z";

function put(over: Partial<MemoryUpsert> & { path: string }): void {
  repo.upsert({
    id: over.path,
    layer: "episodes",
    characterId: "taki",
    importance: 5,
    status: "active",
    createdAt: BEFORE,
    updatedAt: null,
    origin: "self",
    expiresAt: null,
    contentHash: "hash",
    disclosure: "",
    content: "记忆内容",
    searchTerms: "记忆 内容",
    ...over,
  });
}

describe("countActiveSince (tidy write-count trigger)", () => {
  it("counts everything in scope when the character has never been tidied (since null)", () => {
    put({ path: "a.md", createdAt: BEFORE });
    put({ path: "b.md", createdAt: AFTER });

    expect(repo.countActiveSince({ characterId: "taki", since: null, now: NOW })).toBe(2);
  });

  it("counts writes after the mark and ignores untouched older rows", () => {
    put({ path: "old.md", createdAt: BEFORE });
    put({ path: "new.md", createdAt: AFTER });

    expect(repo.countActiveSince({ characterId: "taki", since: MARK, now: NOW })).toBe(1);
  });

  it("counts a row REINFORCED after the mark even though it was created before it (R9)", () => {
    // A reinforced store is a changed store: the anchor is COALESCE(updated_at, created_at), not the birth date.
    put({ path: "reinforced.md", createdAt: BEFORE, updatedAt: AFTER });

    expect(repo.countActiveSince({ characterId: "taki", since: MARK, now: NOW })).toBe(1);
  });

  it("counts globals but not another character's rows", () => {
    put({ path: "global.md", characterId: null, layer: "profile", createdAt: AFTER });
    put({ path: "mine.md", createdAt: AFTER });
    put({ path: "theirs.md", characterId: "yui", createdAt: AFTER });

    expect(repo.countActiveSince({ characterId: "taki", since: MARK, now: NOW })).toBe(2);
  });

  it("ignores archived and expired rows", () => {
    put({ path: "archived.md", createdAt: AFTER, status: "archived" });
    put({ path: "expired.md", createdAt: AFTER, expiresAt: "2026-07-28T00:00:00.000Z" });
    put({ path: "live.md", createdAt: AFTER, expiresAt: "2026-08-30T00:00:00.000Z" });

    expect(repo.countActiveSince({ characterId: "taki", since: MARK, now: NOW })).toBe(1);
  });
});

describe("listActiveInLayer (retention candidates)", () => {
  it("returns policy metadata for the layer's active rows only", () => {
    put({ path: "ep.md", layer: "episodes", importance: 3, createdAt: BEFORE, updatedAt: AFTER });
    put({ path: "other.md", layer: "profile", characterId: null });
    put({ path: "gone.md", layer: "episodes", status: "archived" });

    expect(repo.listActiveInLayer("episodes")).toEqual([
      {
        path: "ep.md",
        layer: "episodes",
        importance: 3,
        createdAt: BEFORE,
        updatedAt: AFTER,
        expiresAt: null,
      },
    ]);
  });

  it("INCLUDES already-expired rows — finding them is the expiring policy's whole job", () => {
    put({ path: "expired.md", layer: "intentions", expiresAt: "2026-07-01T00:00:00.000Z" });

    expect(repo.listActiveInLayer("intentions").map((row) => row.path)).toEqual(["expired.md"]);
  });

  it("spans characters (retention is store-wide, not a per-turn recall scope)", () => {
    put({ path: "taki.md", layer: "activity", characterId: null });
    put({ path: "yui.md", layer: "activity", characterId: null });

    expect(repo.listActiveInLayer("activity")).toHaveLength(2);
  });
});

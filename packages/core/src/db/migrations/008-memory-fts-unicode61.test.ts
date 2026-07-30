import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { memoryMigration002 } from "./002-memory.ts";
import { memoryOriginMigration006 } from "./006-memory-origin.ts";
import { memoryFtsUnicode61Migration008 } from "./008-memory-fts-unicode61.ts";

const UP_TO_007 = [memoryMigration002, memoryOriginMigration006];
const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function open(): Database {
  const db = openDatabase({ path: ":memory:", migrations: [] });
  dbs.push(db);
  return db;
}

// A store as it existed before this migration: a metadata row plus its trigram-indexed FTS row.
function seedTrigramIndexedEntry(db: Database): void {
  db.prepare(
    "INSERT INTO memory_entries (path, id, layer, character_id, importance, status, created_at, expires_at, content_hash) " +
      "VALUES (:path, :id, :layer, :c, :imp, :st, :created, NULL, :hash)",
  ).run({
    path: "/m/0001-ramen.md",
    id: "0001-ramen",
    layer: "episodes",
    c: "taki",
    imp: 5,
    st: "active",
    created: "2026-07-01T00:00:00.000Z",
    hash: "a".repeat(64),
  });
  db.prepare("INSERT INTO memory_fts (path, disclosure, content) VALUES (:path, :d, :c)").run({
    path: "/m/0001-ramen.md",
    d: "",
    c: "吃了豚骨拉面",
  });
}

describe("memoryFtsUnicode61Migration008", () => {
  it("rebuilds memory_fts with the search_terms column and the unicode61 tokenizer", () => {
    const db = open();
    runMigrations(db, UP_TO_007);
    seedTrigramIndexedEntry(db);

    runMigrations(db, [...UP_TO_007, memoryFtsUnicode61Migration008]);

    const ddl = String(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'memory_fts'").get()?.sql);
    expect(ddl).toContain("search_terms");
    expect(ddl).toContain("tokenize='unicode61'");
    expect(ddl).not.toContain("trigram");
  });

  it("makes a 2-char CJK word MATCHable, which is the whole reason for the retokenize", () => {
    const before = open();
    runMigrations(before, UP_TO_007);
    before.prepare("INSERT INTO memory_fts (path, disclosure, content) VALUES ('/m/a.md', '', '吃了豚骨拉面')").run();
    // RED, on the table this migration replaces: a 2-char token produces zero trigrams, so the MATCH is unsatisfiable
    // and recall for 拉面/电影 could only come from an unranked LIKE scan.
    expect(before.prepare("SELECT path FROM memory_fts WHERE memory_fts MATCH '\"拉面\"'").all()).toHaveLength(0);

    const after = open();
    runMigrations(after, [...UP_TO_007, memoryFtsUnicode61Migration008]);
    after
      .prepare("INSERT INTO memory_fts (path, disclosure, content, search_terms) VALUES ('/m/a.md', '', :c, :s)")
      .run({ c: "吃了豚骨拉面", s: "吃了 豚 骨 拉面" });
    expect(after.prepare("SELECT path FROM memory_fts WHERE memory_fts MATCH '\"拉面\"'").all()).toHaveLength(1);
  });

  it("bridges the natural-language question class that trigram windows could not (ra §A.1)", () => {
    const content = "记住：用户对香菜过敏";
    // The pre-T5 query builder's output for 我对什么过敏: overlapping 3-char windows of the raw question.
    const trigramQuery = ['"我对什"', '"对什么"', '"什么过"', '"么过敏"'].join(" OR ");
    // The post-migration query builder's output: segmented words, function words dropped.
    const segmentedQuery = ['"对"', '"过敏"'].join(" OR ");

    const before = open();
    runMigrations(before, UP_TO_007);
    before.prepare("INSERT INTO memory_fts (path, disclosure, content) VALUES ('/m/a.md', '', :c)").run({ c: content });
    // RED: none of the question's windows aligns with any window of the stored prose (…用户对香菜过敏 gives 对香菜,
    // 香菜过, 菜过敏), so the entry is unreachable from the question that should surface it.
    expect(
      before.prepare("SELECT path FROM memory_fts WHERE memory_fts MATCH :q").all({ q: trigramQuery }),
    ).toHaveLength(0);

    const after = open();
    runMigrations(after, [...UP_TO_007, memoryFtsUnicode61Migration008]);
    after
      .prepare("INSERT INTO memory_fts (path, disclosure, content, search_terms) VALUES ('/m/a.md', '', :c, :s)")
      .run({ c: content, s: "记住 用户 对 香菜 过敏" });
    expect(
      after.prepare("SELECT path FROM memory_fts WHERE memory_fts MATCH :q").all({ q: segmentedQuery }),
    ).toHaveLength(1);
  });

  it("blanks content_hash so the next boot reconcile refills search_terms from the files", () => {
    const db = open();
    runMigrations(db, UP_TO_007);
    seedTrigramIndexedEntry(db);

    runMigrations(db, [...UP_TO_007, memoryFtsUnicode61Migration008]);

    // The FTS rows are gone with the dropped table, and "" can never equal a sha256 — so the reconciler re-reads
    // every markdown file (which is truth) and segments it, rather than the migration guessing terms in SQL.
    expect(db.prepare("SELECT content_hash FROM memory_entries").get()).toMatchObject({ content_hash: "" });
    expect(db.prepare("SELECT count(*) AS n FROM memory_fts").get()).toMatchObject({ n: 0 });
  });

  it("keeps every metadata row (the derived index is rebuildable; the metadata is not re-derivable mid-migration)", () => {
    const db = open();
    runMigrations(db, UP_TO_007);
    seedTrigramIndexedEntry(db);

    runMigrations(db, [...UP_TO_007, memoryFtsUnicode61Migration008]);

    expect(db.prepare("SELECT path, id, layer, character_id, importance, origin FROM memory_entries").get()).toEqual({
      path: "/m/0001-ramen.md",
      id: "0001-ramen",
      layer: "episodes",
      character_id: "taki",
      importance: 5,
      origin: "self",
    });
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createMemoryFixture, type MemoryFixture } from "../testing/memory-fixture.ts";

const NOW = "2026-07-10T12:00:00.000Z";
const fixtures: MemoryFixture[] = [];
function fresh(dbPath?: string): MemoryFixture {
  const f = createMemoryFixture({ dbPath });
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

describe("indexer reconciliation (T6)", () => {
  it("builds a fresh index from files (store writes files only until reconcile)", () => {
    const f = fresh();
    f.store.write({ layer: "relationship", characterId: "taki", content: "吃了豚骨拉面", importance: 8 });
    f.store.write({ layer: "profile", content: "喜欢看电影", importance: 9 });
    expect(f.repo.listHashes()).toHaveLength(0); // nothing indexed yet

    const stats = f.reconcile();
    expect(stats).toMatchObject({ upserted: 2, deleted: 0, total: 2 });
    expect(f.repo.search({ match: '"拉面"', characterId: "taki", now: NOW, limit: 10 })).toHaveLength(1);
  });

  it("re-indexes a changed file and drops an orphaned row", () => {
    const f = fresh();
    const a = f.store.write({ layer: "relationship", characterId: "taki", content: "旧约定内容", importance: 7 });
    const b = f.store.write({ layer: "episodes", characterId: "taki", content: "一次对话记录", importance: 4 });
    f.reconcile();

    // Archive a (rewrites the file -> new hash); delete b's file entirely.
    f.store.archiveAtPath(a.filePath);
    rmSync(b.filePath);
    const stats = f.reconcile();

    expect(stats).toMatchObject({ upserted: 1, deleted: 1, total: 1 });
    // Archived entry is excluded from active search; deleted file's row is gone.
    expect(f.repo.search({ match: '"约定"', characterId: "taki", now: NOW, limit: 10 })).toHaveLength(0);
    expect(f.repo.listHashes()).toHaveLength(1);
  });

  it("excludes expired intentions from active listing/search", () => {
    const f = fresh();
    f.store.write({
      layer: "intentions",
      characterId: "taki",
      content: "想约她周末出去",
      importance: 5,
      disclosure: "周末",
      expires: "2020-01-01T00:00:00.000Z", // already expired
    });
    f.reconcile();
    const active = f.repo.listActiveByLayers({ characterId: "taki", layers: ["intentions"], now: NOW });
    expect(active).toHaveLength(0);
  });

  it("reports a hand-broken file as invalid and still indexes the valid ones (boot never crashes)", () => {
    const f = fresh();
    f.store.write({ layer: "relationship", characterId: "taki", content: "吃了豚骨拉面", importance: 8 });
    writeFileSync(join(f.root, "broken.md"), "no frontmatter here");

    const stats = f.reconcile();
    expect(stats).toMatchObject({ upserted: 1, deleted: 0, total: 1 });
    expect(stats.invalid).toHaveLength(1);
    expect(stats.invalid[0]).toContain("broken.md");
    expect(f.repo.search({ match: '"拉面"', characterId: "taki", now: NOW, limit: 10 })).toHaveLength(1);
  });
});

describe("rebuild-equivalence — delete DB, reindex from files, identical retrieval (T7, AC 2/11)", () => {
  it("produces byte-identical search rows after a full rebuild", () => {
    const f = fresh();
    f.store.write({ layer: "relationship", characterId: "taki", content: "答应一起去吃豚骨拉面", importance: 10 });
    f.store.write({ layer: "episodes", characterId: "taki", content: "聊到了拉面店的位置", importance: 4 });
    f.store.write({ layer: "profile", content: "最爱豚骨拉面", importance: 9 });
    f.reconcile();

    const query = { match: '"拉面"', characterId: "taki", now: NOW, limit: 10 } as const;
    const before = f.repo.search(query);
    expect(before.length).toBeGreaterThan(1);

    f.reopenDb(); // "delete the DB" — fresh empty index
    expect(f.repo.search(query)).toHaveLength(0);

    const stats = f.reconcile();
    expect(stats.upserted).toBe(3);
    const after = f.repo.search(query);
    expect(after).toEqual(before); // identical rows AND identical bm25 order
  });

  it("gives a blank-hash reconcile (the migration-008 path) the same rows as incremental indexing", () => {
    const f = fresh();
    f.store.write({ layer: "profile", characterId: "taki", content: "记住：用户对香菜过敏", importance: 8, disclosure: "过敏,饮食" });
    f.store.write({ layer: "episodes", characterId: "taki", content: "今天用VSCode写了TypeScript代码", importance: 4 });
    f.store.write({ layer: "relationship", characterId: "taki", content: "答应周五一起看电影", importance: 10 });
    f.reconcile();

    const queries = ['"过敏"', '"vscode"', '"电影"', '"拉面"'];
    const incremental = queries.map((match) => f.repo.search({ match, characterId: "taki", now: NOW, limit: 10 }));
    const terms = f.db.prepare("SELECT path, search_terms FROM memory_fts ORDER BY path").all();

    // Exactly what migration 008 does: keep the metadata rows, blank the hashes, let the boot reconcile refill the
    // index from the files. It must land on the same rows as the incremental write path, or a migrated store and a
    // freshly written one would retrieve differently.
    f.db.prepare("UPDATE memory_entries SET content_hash = ''").run();
    expect(f.reconcile().upserted).toBe(3);

    expect(queries.map((match) => f.repo.search({ match, characterId: "taki", now: NOW, limit: 10 }))).toEqual(
      incremental,
    );
    expect(f.db.prepare("SELECT path, search_terms FROM memory_fts ORDER BY path").all()).toEqual(terms);
  });
});

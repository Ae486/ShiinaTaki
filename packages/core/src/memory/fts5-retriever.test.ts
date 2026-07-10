import { afterEach, describe, expect, it } from "vitest";
import type { MemoryUpsert } from "../db/memory-repo.ts";
import { createMemoryFixture, type MemoryFixture } from "../testing/memory-fixture.ts";
import { createFts5Retriever } from "./fts5-retriever.ts";

const fixtures: MemoryFixture[] = [];
function fresh(): MemoryFixture {
  const f = createMemoryFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

// Minimal crafted index row (for deterministic ranking tests that need controlled created_at).
function craft(over: Partial<MemoryUpsert> & Pick<MemoryUpsert, "path" | "id" | "content">): MemoryUpsert {
  return {
    layer: "profile",
    characterId: null,
    importance: 5,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    contentHash: over.path,
    disclosure: "",
    ...over,
  };
}

describe("FTS5 retriever (T8)", () => {
  it("finds a CJK memory via a >= 3-char trigram MATCH", () => {
    const f = fresh();
    f.store.write({ layer: "relationship", characterId: "taki", content: "吃了豚骨拉面", importance: 8 });
    f.reconcile();
    const hits = createFts5Retriever(f.repo).retrieve({ text: "豚骨拉", characterId: "taki", limit: 10 });
    expect(hits.map((h) => h.content)).toEqual(["吃了豚骨拉面"]);
  });

  it("finds a common 2-char CJK word via the LIKE fallback", () => {
    const f = fresh();
    f.store.write({ layer: "relationship", characterId: "taki", content: "吃了豚骨拉面", importance: 8 });
    f.reconcile();
    // "拉面" is 2 chars — MATCH returns nothing; the retriever must take the LIKE path.
    const hits = createFts5Retriever(f.repo).retrieve({ text: "拉面", characterId: "taki", limit: 10 });
    expect(hits.map((h) => h.content)).toEqual(["吃了豚骨拉面"]);
  });

  it("orders by importance then recency on the LIKE path", () => {
    const f = fresh();
    f.repo.upsert(craft({ path: "/m/a.md", id: "0001-a", content: "喜欢拉面甲", importance: 5, createdAt: "2026-01-01T00:00:00.000Z" }));
    f.repo.upsert(craft({ path: "/m/b.md", id: "0002-b", content: "喜欢拉面乙", importance: 5, createdAt: "2026-06-01T00:00:00.000Z" }));
    f.repo.upsert(craft({ path: "/m/c.md", id: "0003-c", content: "喜欢拉面丙", importance: 9, createdAt: "2026-03-01T00:00:00.000Z" }));

    const hits = createFts5Retriever(f.repo).retrieve({ text: "拉面", characterId: "taki", limit: 10 });
    // importance 9 first; then equal-importance pair newest-first (b before a).
    expect(hits.map((h) => h.id)).toEqual(["0003-c", "0002-b", "0001-a"]);
  });

  it("ranks a content hit above a disclosure-only hit (bm25 weights offset for the UNINDEXED path column)", () => {
    const f = fresh();
    // The disclosure-only row gets HIGHER importance: if the bm25 weights were misaligned (or zeroed by an
    // off-by-one over the UNINDEXED col 0), the importance tiebreaker would invert this order.
    f.repo.upsert(craft({ path: "/m/c.md", id: "0001-c", content: "记得一起看电影这件事", importance: 5 }));
    f.repo.upsert(craft({ path: "/m/d.md", id: "0002-d", content: "完全无关的正文内容啊", importance: 9, disclosure: "看电影" }));
    // Filler rows keep the matched trigram rare (IDF > 0) — with 2 of 4 rows matching, bm25 degenerates to 0.
    for (let i = 0; i < 10; i += 1) {
      f.repo.upsert(craft({ path: `/m/f${i}.md`, id: `100${i}-f`, content: `填充条目第${i}条毫不相干`, importance: 1 }));
    }

    const hits = createFts5Retriever(f.repo).retrieve({ text: "想看电影", characterId: "taki", limit: 10 });
    expect(hits.map((h) => h.id)).toEqual(["0001-c", "0002-d"]);
  });

  it("applies the disclosure keyword gate", () => {
    const f = fresh();
    f.store.write({
      layer: "episodes",
      characterId: "taki",
      content: "周末喜欢去钓鱼的地方",
      importance: 4,
      disclosure: "钓鱼",
    });
    f.reconcile();
    const retriever = createFts5Retriever(f.repo);
    // Query hits the content trigram but lacks the disclosure keyword -> gated out.
    expect(retriever.retrieve({ text: "周末喜欢去", characterId: "taki", limit: 10 })).toHaveLength(0);
    // Query contains the disclosure keyword -> surfaces.
    expect(retriever.retrieve({ text: "去钓鱼", characterId: "taki", limit: 10 })).toHaveLength(1);
  });

  it("restricts to the requested layers", () => {
    const f = fresh();
    f.store.write({ layer: "episodes", characterId: "taki", content: "聊到豚骨拉面", importance: 4 });
    f.store.write({ layer: "relationship", characterId: "taki", content: "约定吃豚骨拉面", importance: 10 });
    f.reconcile();
    const hits = createFts5Retriever(f.repo).retrieve({ text: "豚骨拉", characterId: "taki", layers: ["episodes"], limit: 10 });
    expect(hits.map((h) => h.layer)).toEqual(["episodes"]);
  });

  it("isolates per-character memory (only own character + globals)", () => {
    const f = fresh();
    f.store.write({ layer: "relationship", characterId: "taki", content: "taki的豚骨拉面约定", importance: 10 });
    f.store.write({ layer: "relationship", characterId: "yui", content: "yui的豚骨拉面约定", importance: 10 });
    f.reconcile();
    const hits = createFts5Retriever(f.repo).retrieve({ text: "豚骨拉", characterId: "taki", limit: 10 });
    expect(hits.map((h) => h.content)).toEqual(["taki的豚骨拉面约定"]);
  });
});

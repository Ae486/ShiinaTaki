import { afterEach, describe, expect, it } from "vitest";
import type { MemoryUpsert } from "../db/memory-repo.ts";
import { createMemoryFixture, type MemoryFixture } from "../testing/memory-fixture.ts";
import { disclosureMatches } from "./disclosure-gate.ts";
import { createFts5Retriever } from "./fts5-retriever.ts";
import type { Retriever } from "./retriever.ts";

const fixtures: MemoryFixture[] = [];
function fresh(): MemoryFixture {
  const f = createMemoryFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

function retriever(f: MemoryFixture): Retriever {
  return createFts5Retriever({ repo: f.repo, tokenizer: f.tokenizer });
}

// Minimal crafted index row (for ranking tests that need a controlled created_at). search_terms is segmented through
// the fixture's own tokenizer, so a crafted row is indexed exactly the way a written one is.
function craft(
  f: MemoryFixture,
  over: Partial<MemoryUpsert> & Pick<MemoryUpsert, "path" | "id" | "content">,
): MemoryUpsert {
  const row = {
    layer: "profile",
    characterId: null,
    importance: 5,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: null,
    origin: "self",
    expiresAt: null,
    contentHash: over.path,
    disclosure: "",
    searchTerms: "",
    ...over,
  };
  return { ...row, searchTerms: f.tokenizer.tokenize(`${row.disclosure} ${row.content}`).join(" ") };
}

describe("FTS5 retriever (T8, retokenized in T5 batch 3)", () => {
  it("finds a CJK memory by a whole segmented word", () => {
    const f = fresh();
    f.store.write({ layer: "relationship", characterId: "taki", content: "吃了豚骨拉面", importance: 8 });
    f.reconcile();
    const hits = retriever(f).retrieve({ text: "豚骨拉面", characterId: "taki", limit: 10 });
    expect(hits.map((h) => h.content)).toEqual(["吃了豚骨拉面"]);
  });

  it("finds a common 2-char CJK word through MATCH rather than the LIKE scan (ra requirement b)", () => {
    const f = fresh();
    f.store.write({ layer: "relationship", characterId: "taki", content: "吃了豚骨拉面", importance: 8 });
    f.store.write({ layer: "episodes", characterId: "taki", content: "答应周五一起看电影", importance: 4 });
    f.reconcile();

    // Under trigram both queries produced zero trigrams and fell through to an UNRANKED substring scan.
    expect(retriever(f).retrieve({ text: "拉面", characterId: "taki", limit: 10 }).map((h) => h.content)).toEqual([
      "吃了豚骨拉面",
    ]);
    expect(retriever(f).retrieve({ text: "电影", characterId: "taki", limit: 10 }).map((h) => h.content)).toEqual([
      "答应周五一起看电影",
    ]);
    // Proof the hit came from MATCH, not LIKE: a bare character is a token that matches no stored token, whereas a
    // substring scan for 拉 would still return the ramen row.
    expect(retriever(f).retrieve({ text: "拉", characterId: "taki", limit: 10 })).toHaveLength(0);
  });

  it("bridges a natural-language question to the fact's own vocabulary (ra requirement c)", () => {
    const f = fresh();
    f.store.write({
      layer: "profile",
      characterId: "taki",
      content: "记住：用户对香菜过敏",
      importance: 8,
      disclosure: "当用户问起过敏源或者饮食禁忌时",
    });
    f.store.write({ layer: "profile", characterId: "taki", content: "用户最近在读三体这本小说", importance: 5 });
    f.store.write({ layer: "profile", characterId: "taki", content: "用户讨厌开会，说那是浪费时间", importance: 5 });
    f.reconcile();

    // The exact class trigram missed: a question's 3-char windows never align with the stored prose's.
    const cases = [
      ["我对什么过敏", "记住：用户对香菜过敏"],
      ["我在读什么书", "用户最近在读三体这本小说"],
      ["我讨厌什么", "用户讨厌开会，说那是浪费时间"],
    ] as const;
    for (const [question, expected] of cases) {
      expect(retriever(f).retrieve({ text: question, characterId: "taki", limit: 10 })[0]?.content, question).toBe(
        expected,
      );
    }
  });

  it("matches a mixed CJK+ASCII token, case-folded", () => {
    const f = fresh();
    f.store.write({ layer: "episodes", characterId: "taki", content: "今天用VSCode写了TypeScript代码", importance: 4 });
    f.reconcile();
    // unicode61 glues that whole sentence into ONE token; the segmented terms are what keep VSCode addressable.
    expect(retriever(f).retrieve({ text: "VSCode", characterId: "taki", limit: 10 })).toHaveLength(1);
    expect(retriever(f).retrieve({ text: "vscode", characterId: "taki", limit: 10 })).toHaveLength(1);
  });

  it("ranks a row whose disclosure carries the query vocabulary above an incidental content mention", () => {
    const f = fresh();
    // The T5-R12 inversion case. With the pre-T5 weights (content on top) the row that merely MENTIONS the word wins
    // over the row that WROTE it as a recall trigger — exactly backwards when she only gets one search.
    f.repo.upsert(
      craft(f, { path: "/m/t.md", id: "0001-t", disclosure: "约定,拉面", content: "那天我们聊了很久也走了很远的路啊" }),
    );
    f.repo.upsert(craft(f, { path: "/m/m.md", id: "0002-m", content: "he said ramen 拉面 was fine and we moved on" }));
    for (let i = 0; i < 12; i += 1) {
      f.repo.upsert(craft(f, { path: `/m/f${i}.md`, id: `100${i}-f`, content: `无关的填充条目第${i}条内容随便写点` }));
    }

    expect(retriever(f).retrieve({ text: "拉面", characterId: "taki", limit: 10 }).map((h) => h.id)).toEqual([
      "0001-t",
      "0002-m",
    ]);
  });

  it("returns an entry that HAS a disclosure for a query the disclosure does not contain (Q2: the AND gate is gone)", () => {
    const f = fresh();
    f.store.write({
      layer: "episodes",
      characterId: "taki",
      content: "周末喜欢去钓鱼的地方",
      importance: 4,
      disclosure: "钓鱼",
    });
    f.reconcile();

    // RED proof, using the gate itself: `disclosureMatches` still exists (the intention gate consumes it), and it
    // says NO for this pair — so the old post-filter dropped this row. Writing a trigger made an entry harder to
    // reach than leaving it blank, which is exactly backwards.
    expect(disclosureMatches("钓鱼", "周末的地方")).toBe(false);
    expect(retriever(f).retrieve({ text: "周末的地方", characterId: "taki", limit: 10 })).toHaveLength(1);
    // A query that does carry the trigger still works — removing the gate cost nothing.
    expect(retriever(f).retrieve({ text: "去钓鱼", characterId: "taki", limit: 10 })).toHaveLength(1);
  });

  it("orders by importance then recency, and returns nothing when the fallback finds no substring", () => {
    const f = fresh();
    f.repo.upsert(craft(f, { path: "/m/a.md", id: "0001-a", content: "喜欢拉面甲", createdAt: "2026-01-01T00:00:00.000Z" }));
    f.repo.upsert(craft(f, { path: "/m/b.md", id: "0002-b", content: "喜欢拉面乙", createdAt: "2026-06-01T00:00:00.000Z" }));
    f.repo.upsert(
      craft(f, { path: "/m/c.md", id: "0003-c", content: "喜欢拉面丙", importance: 9, createdAt: "2026-03-01T00:00:00.000Z" }),
    );

    // Equal bm25 (all three share the same two terms) falls through to importance then recency.
    expect(retriever(f).retrieve({ text: "喜欢拉面", characterId: "taki", limit: 10 }).map((h) => h.id)).toEqual([
      "0003-c",
      "0002-b",
      "0001-a",
    ]);
    // A pure-stopword query degenerates to the LIKE path, which finds no such substring here.
    expect(retriever(f).retrieve({ text: "的了是", characterId: "taki", limit: 10 })).toHaveLength(0);
  });

  it("orders the LIKE fallback by importance then recency (the degenerate scan has no relevance term)", () => {
    const f = fresh();
    f.repo.upsert(craft(f, { path: "/m/a.md", id: "0001-a", content: "他说的了是甲案", createdAt: "2026-01-01T00:00:00.000Z" }));
    f.repo.upsert(craft(f, { path: "/m/b.md", id: "0002-b", content: "他说的了是乙案", createdAt: "2026-06-01T00:00:00.000Z" }));
    f.repo.upsert(
      craft(f, { path: "/m/c.md", id: "0003-c", content: "他说的了是丙案", importance: 9, createdAt: "2026-03-01T00:00:00.000Z" }),
    );

    // 的了是 is pure stopwords -> the LIKE scan, whose only ordering IS importance then recency.
    expect(retriever(f).retrieve({ text: "的了是", characterId: "taki", limit: 10 }).map((h) => h.id)).toEqual([
      "0003-c",
      "0002-b",
      "0001-a",
    ]);
  });

  it("restricts to the requested layers", () => {
    const f = fresh();
    f.store.write({ layer: "episodes", characterId: "taki", content: "聊到豚骨拉面", importance: 4 });
    f.store.write({ layer: "relationship", characterId: "taki", content: "约定吃豚骨拉面", importance: 10 });
    f.reconcile();
    const hits = retriever(f).retrieve({ text: "豚骨拉面", characterId: "taki", layers: ["episodes"], limit: 10 });
    expect(hits.map((h) => h.layer)).toEqual(["episodes"]);
  });

  it("isolates per-character memory (only own character + globals)", () => {
    const f = fresh();
    f.store.write({ layer: "relationship", characterId: "taki", content: "taki的豚骨拉面约定", importance: 10 });
    f.store.write({ layer: "relationship", characterId: "yui", content: "yui的豚骨拉面约定", importance: 10 });
    f.reconcile();
    const hits = retriever(f).retrieve({ text: "豚骨拉面", characterId: "taki", limit: 10 });
    expect(hits.map((h) => h.content)).toEqual(["taki的豚骨拉面约定"]);
  });

  it("carries disclosure and origin on every ranked entry (the shape the search tool renders)", () => {
    const f = fresh();
    f.store.write({
      layer: "episodes",
      characterId: "taki",
      content: "屏幕上是一个报错页面",
      importance: 4,
      disclosure: "用户问我看到了什么",
      origin: "observed",
    });
    f.reconcile();
    expect(retriever(f).retrieve({ text: "报错", characterId: "taki", limit: 10 })[0]).toMatchObject({
      disclosure: "用户问我看到了什么",
      origin: "observed",
    });
  });
});

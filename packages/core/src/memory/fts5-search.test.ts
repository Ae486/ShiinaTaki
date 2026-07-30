import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Bm25Weights } from "../config/memory-config.ts";
import { createMemoryFixture, type MemoryFixture } from "../testing/memory-fixture.ts";
import { createFts5Retriever } from "./fts5-retriever.ts";
import type { Retriever } from "./retriever.ts";

/**
 * The A/B regression net for the tokenizer migration. Corpus and queries are drawn from
 * `research/ra-retrieval-stack.md` §A.1 (the natural-language question class every trigram query missed) and §B.2
 * (the segmentation probe's content sentences). Its job is to lock those classes green: rank@1 was 17/25 under
 * trigram and 24/25 after the migration, and every trigram miss was a question.
 */
const CORPUS: { id: string; content: string; disclosure?: string; layer?: string }[] = [
  { id: "ramen", content: "吃了豚骨拉面，汤头很浓", disclosure: "拉面,吃的" },
  { id: "movie", content: "答应周五一起看电影", disclosure: "约定,电影", layer: "relationship" },
  { id: "editor", content: "今天用VSCode写了TypeScript代码", disclosure: "用户问我用什么编辑器" },
  { id: "name", content: "用户的名字是pleia", disclosure: "用户问自己叫什么名字" },
  { id: "allergy", content: "记住：用户对香菜过敏", disclosure: "当用户问起过敏源或者饮食禁忌时" },
  { id: "night", content: "用户喜欢在深夜写代码，不喜欢被打断" },
  { id: "project", content: "用户正在开发一个叫TakiAgent的桌面宠物项目", disclosure: "用户问起自己在做什么项目" },
  { id: "shop", content: "拉面店在秋叶原车站附近", disclosure: "用户问那家拉面店在哪里" },
  { id: "spicy", content: "用户不吃辣，也不吃折耳根", disclosure: "用户问自己不吃什么" },
  { id: "book", content: "用户最近在读三体这本小说", disclosure: "用户问自己在读什么书" },
  { id: "meetings", content: "用户讨厌开会，说那是浪费时间", disclosure: "用户问自己讨厌什么" },
  { id: "game", content: "用户最近在玩空洞骑士", disclosure: "用户问自己玩什么游戏" },
  { id: "f1", content: "今天天气不错，出门散了个步" },
  { id: "f2", content: "楼下新开了一家便利店" },
  { id: "f3", content: "昨晚睡得很晚，早上有点困" },
  { id: "f4", content: "聊到了小时候养过的一只猫" },
  { id: "f5", content: "讨论了一下窗帘的颜色" },
  { id: "f6", content: "路过公园的时候看见有人放风筝" },
  { id: "f7", content: "帮忙修好了坏掉的台灯" },
  { id: "f8", content: "一起吐槽了最近的新闻" },
];

// query -> the corpus id(s) that are a correct rank-1 answer. The six 什么-questions are ra §A.1's verbatim misses.
const QUERIES: { query: string; want: string[]; note?: string }[] = [
  { query: "拉面", want: ["ramen", "shop"], note: "2-char CJK (ra requirement b)" },
  { query: "电影", want: ["movie"], note: "2-char CJK" },
  { query: "豚骨拉面", want: ["ramen"] },
  { query: "我对什么过敏", want: ["allergy"], note: "ra §A.1 trigram miss" },
  { query: "我在做什么项目", want: ["project"], note: "ra §A.1 trigram miss" },
  { query: "我不吃什么", want: ["spicy"], note: "ra §A.1 trigram miss" },
  { query: "我在读什么书", want: ["book"], note: "ra §A.1 trigram miss" },
  { query: "我讨厌什么", want: ["meetings"], note: "ra §A.1 trigram miss" },
  { query: "我玩什么游戏", want: ["game"], note: "ra §A.1 trigram miss" },
  { query: "用户叫什么名字", want: ["name"] },
  { query: "我用什么编辑器", want: ["editor"] },
  { query: "桌面宠物项目", want: ["project"] },
  { query: "还记得上次说的电影吗", want: ["movie"] },
  { query: "VSCode", want: ["editor"], note: "mixed CJK+ASCII" },
  { query: "vscode", want: ["editor"], note: "case-fold" },
];

const fixtures: MemoryFixture[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

function seeded(opts: Parameters<typeof createMemoryFixture>[0] = {}): { f: MemoryFixture; retriever: Retriever } {
  const f = createMemoryFixture(opts);
  for (const row of CORPUS) {
    f.store.write({
      layer: row.layer ?? "profile",
      characterId: "taki",
      content: row.content,
      importance: 5,
      disclosure: row.disclosure,
    });
  }
  f.reconcile();
  return { f, retriever: createFts5Retriever({ repo: f.repo, tokenizer: f.tokenizer }) };
}

// The corpus ids are not the entry ids (the store allocates those), so match on content.
function topId(retriever: Retriever, query: string): string | undefined {
  const [hit] = retriever.retrieve({ text: query, characterId: "taki", limit: 3 });
  return CORPUS.find((row) => row.content === hit?.content)?.id;
}

describe("retrieval A/B regression net (ra §A.1/§B.2 corpus)", () => {
  // One seeded corpus for the whole net (20 file writes), torn down after the block rather than after each case.
  let net: { f: MemoryFixture; retriever: Retriever };
  beforeAll(() => {
    net = seeded();
  });
  afterAll(() => {
    net.f.cleanup();
  });

  for (const { query, want, note } of QUERIES) {
    it(`ranks the right memory first for ${query}${note ? ` — ${note}` : ""}`, () => {
      expect(want).toContain(topId(net.retriever, query));
    });
  }

  it("answers every query in the net (no silent empty result set)", () => {
    for (const { query } of QUERIES) {
      expect(net.retriever.retrieve({ text: query, characterId: "taki", limit: 3 }).length, query).toBeGreaterThan(0);
    }
  });
});

describe("retrieval knobs are config, not constants (T5-R13 + the D53 seam)", () => {
  // A length-matched pair: both rows carry the query term once in `search_terms`, so the ONLY difference is which
  // other column also matches — the trigger row's `disclosure`, or the mention row's `content`.
  const TRIGGER = { disclosure: "拉面", content: "那天我们聊了很久也走了很远的路啊" };
  const MENTION = { disclosure: "", content: "ramen 拉面 was fine and we moved on" };

  function rankPair(weights: Bm25Weights): string[] {
    const f = createMemoryFixture({ weights });
    fixtures.push(f);
    for (const row of [TRIGGER, MENTION]) {
      f.store.write({ layer: "profile", characterId: "taki", content: row.content, importance: 5, disclosure: row.disclosure });
    }
    for (let i = 0; i < 12; i += 1) {
      f.store.write({ layer: "profile", characterId: "taki", content: `无关的填充条目第${i}条内容随便写点`, importance: 5 });
    }
    f.reconcile();
    return createFts5Retriever({ repo: f.repo, tokenizer: f.tokenizer })
      .retrieve({ text: "拉面", characterId: "taki", limit: 3 })
      .map((hit) => (hit.content === TRIGGER.content ? "trigger" : "mention"));
  }

  it("re-ranks when the operator moves the weight onto content", () => {
    // The ruled default keeps the row that WROTE the recall trigger first — what T5-R12 needs when she gets one
    // search. Weighting content heavily instead promotes the row that merely MENTIONS the word, which is the
    // pre-T5 direction and the reason the old weights could not be carried over.
    expect(rankPair({ disclosure: 2, content: 1, searchTerms: 2 })[0]).toBe("trigger");
    expect(rankPair({ disclosure: 1, content: 4, searchTerms: 2 })[0]).toBe("mention");
  });

  it("narrows a function-word-heavy result set with the stoplist on, without losing the right answer", () => {
    const withStoplist = seeded({ stoplist: true });
    const without = seeded({ stoplist: false });
    fixtures.push(withStoplist.f, without.f);
    const query = "我对什么过敏";

    const on = withStoplist.retriever.retrieve({ text: query, characterId: "taki", limit: 50 });
    const off = without.retriever.retrieve({ text: query, characterId: "taki", limit: 50 });

    // ra §B.2: the stoplist raised precision markedly with rank@1 unchanged.
    expect(on.length).toBeLessThan(off.length);
    expect(on[0]?.content).toBe(off[0]?.content);
    expect(on[0]?.content).toBe("记住：用户对香菜过敏");
  });
});

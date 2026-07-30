import { afterEach, describe, expect, it } from "vitest";
import type { MemoryUpsert } from "../db/memory-repo.ts";
import { createMemoryFixture, type MemoryFixture } from "../testing/memory-fixture.ts";
import { createAssembler, type Assembler } from "./assembler.ts";
import { createFts5Retriever } from "./fts5-retriever.ts";
import type { PersonaProvider } from "./persona-provider.ts";
import { createIntlSegmenterTokenizer } from "./search-tokenizer.ts";

// Recognizable stub cards so the fixed-order assertions can pin exactly where persona content lands.
const STUB_PERSONA: PersonaProvider = {
  assistantLayer: () => "ASSISTANT_LAYER",
  persona: (characterId) => `PERSONA(${characterId})`,
};

const TOKENIZER = createIntlSegmenterTokenizer({ stoplist: true });

// Crafted index rows (deterministic created_at); the T5 schema fields default to a plain unreinforced self-write.
// search_terms is segmented here exactly as the indexer would, so a crafted row is findable like a written one.
function upsert(over: Partial<MemoryUpsert> & Pick<MemoryUpsert, "path" | "id" | "content">): MemoryUpsert {
  const row = {
    layer: "profile",
    characterId: "taki",
    importance: 10,
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
  return { ...row, searchTerms: TOKENIZER.tokenize(`${row.disclosure} ${row.content}`).join(" ") };
}

const fixtures: MemoryFixture[] = [];
function fresh(): { f: MemoryFixture; assembler: Assembler } {
  const f = createMemoryFixture();
  fixtures.push(f);
  return {
    f,
    assembler: createAssembler({
      repo: f.repo,
      retriever: createFts5Retriever({ repo: f.repo, tokenizer: f.tokenizer }),
      persona: STUB_PERSONA,
    }),
  };
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

describe("assembler (T9 deterministic order + budgets)", () => {
  it("emits sections in the fixed order and is deterministic", () => {
    const { f, assembler } = fresh();
    f.store.write({ layer: "relationship", characterId: "taki", content: "每周五一起看电影", importance: 10 });
    f.store.write({ layer: "episodes", characterId: "taki", content: "今天聊到了豚骨拉面", importance: 4 });
    f.reconcile();

    const out = assembler.assemble({ characterId: "taki", queryText: "豚骨拉面好吃吗" });
    const sections = out.split("\n\n");
    expect(sections[0]).toBe("ASSISTANT_LAYER"); // global assistant layer injected FIRST
    expect(sections[1]).toBe("PERSONA(taki)"); // per-character persona AFTER the assistant layer
    expect(sections[2]).toBe("Current mood: neutral.");
    expect(sections[3]).toContain("Promises and facts you always keep in mind:");
    expect(sections[3]).toContain("每周五一起看电影");
    expect(sections[4]).toContain("Things that come to mind right now:");
    expect(sections[4]).toContain("今天聊到了豚骨拉面");

    // Deterministic: same inputs -> byte-identical output.
    expect(assembler.assemble({ characterId: "taki", queryText: "豚骨拉面好吃吗" })).toBe(out);
  });

  it("trims the retrieved block to its token budget (not every match survives)", () => {
    const { f, assembler } = fresh();
    for (let i = 0; i < 10; i += 1) {
      f.store.write({ layer: "episodes", characterId: "taki", content: `豚骨拉面记录${i}` + "记".repeat(150), importance: 4 });
    }
    f.reconcile();

    const out = assembler.assemble({ characterId: "taki", queryText: "豚骨拉面" });
    const retrievedBlock = out.split("\n\n").find((s) => s.startsWith("Things that come to mind")) ?? "";
    const bulletCount = retrievedBlock.split("\n").filter((line) => line.startsWith("- ")).length;
    expect(bulletCount).toBeGreaterThan(0);
    expect(bulletCount).toBeLessThan(10); // budget trimmed the rest
  });

  it("omits memory sections entirely when there is nothing to recall", () => {
    const { assembler } = fresh();
    const out = assembler.assemble({ characterId: "taki", queryText: "hello" });
    expect(out.split("\n\n")).toHaveLength(3); // assistant layer + persona + emotion only
  });

  it("prefixes each memory bullet with a code-computed relative age", () => {
    const { f, assembler } = fresh();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    f.repo.upsert(
      upsert({
        path: "/m/r-1.md",
        id: "0001-r",
        layer: "relationship",
        content: "每周五一起看电影",
        createdAt: threeDaysAgo,
        contentHash: "h-r",
      }),
    );

    const out = assembler.assemble({ characterId: "taki", queryText: "看电影" });
    // Age is computed by code (never left to the model): the bullet carries the "(3 days ago)" prefix.
    expect(out).toContain("- (3 days ago) 每周五一起看电影");
  });

  it("ages a REINFORCED entry from its last reinforcement, not from its creation (T5-R9)", () => {
    const { f, assembler } = fresh();
    const day = 24 * 60 * 60 * 1000;
    f.repo.upsert(
      upsert({
        path: "/m/r-2.md",
        id: "0002-r",
        layer: "relationship",
        content: "答应帮她修电脑",
        createdAt: new Date(Date.now() - 5 * day).toISOString(),
        updatedAt: new Date(Date.now() - 1 * day).toISOString(),
        contentHash: "h-r2",
      }),
    );

    // The duplicate write proved the memory was live again, so the prompt must not present it as five days stale.
    expect(assembler.assemble({ characterId: "taki", queryText: "电脑" })).toContain("- (1 day ago) 答应帮她修电脑");
  });
});

describe("assembler intention gate (T11, AC 9)", () => {
  it("surfaces at most one intention, only when its disclosure matches the message", () => {
    const { f, assembler } = fresh();
    f.store.write({
      layer: "intentions",
      characterId: "taki",
      content: "想问问她周末有没有空",
      importance: 5,
      disclosure: "周末",
    });
    f.reconcile();

    const matched = assembler.assemble({ characterId: "taki", queryText: "这个周末做点什么呢" });
    expect(matched).toContain("A quiet thought you might share: 想问问她周末有没有空");

    const unmatched = assembler.assemble({ characterId: "taki", queryText: "今天天气不错" });
    expect(unmatched).not.toContain("A quiet thought you might share");

    // The gate keys on the CURRENT message only — a keyword from an earlier turn in the recall window must not fire it.
    const staleKeyword = assembler.assemble({
      characterId: "taki",
      queryText: "上次说到周末的事 今天天气不错",
      currentMessage: "今天天气不错",
    });
    expect(staleKeyword).not.toContain("A quiet thought you might share");
  });

  it("picks the newest matching intention and never more than one", () => {
    const { f, assembler } = fresh();
    // Craft rows with explicit created_at so "newest" is deterministic (two store writes could share a ms).
    const base = {
      layer: "intentions",
      characterId: "taki",
      importance: 5,
      expiresAt: "2999-01-01T00:00:00.000Z",
      disclosure: "电影",
    };
    f.repo.upsert(upsert({ ...base, path: "/m/i-old.md", id: "0001-old", content: "旧念头关于电影", createdAt: "2026-01-01T00:00:00.000Z", contentHash: "h-old" }));
    f.repo.upsert(upsert({ ...base, path: "/m/i-new.md", id: "0002-new", content: "新念头关于电影", createdAt: "2026-06-01T00:00:00.000Z", contentHash: "h-new" }));

    const out = assembler.assemble({ characterId: "taki", queryText: "想看电影了" });
    expect(out).toContain("A quiet thought you might share: 新念头关于电影");
    expect(out).not.toContain("旧念头");
    expect(out.match(/A quiet thought you might share/g)).toHaveLength(1);
  });
});

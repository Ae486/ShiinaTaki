import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { TimelineEntry } from "@taki/shared";
import type { Tool, ToolExecutionOptions } from "ai";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { failingGenerateModel, generatingModel } from "../testing/mock-language-model.ts";
import { createEpisodicWriter, type EpisodicWriteOp } from "./episodic-writer.ts";

const fixtures: CompanionFixture[] = [];
function fresh(): CompanionFixture {
  const f = createCompanionFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

// Bind the engine's write op to the episodes layer (the same file-first-then-index store path tools use).
function episodeOp(f: CompanionFixture): EpisodicWriteOp {
  return (input) => f.memory.writeEntry({ ...input, type: "episodes" });
}

function seg(...contents: string[]): TimelineEntry[] {
  return contents.map((content, i) => ({
    seq: i + 1,
    id: `id-${i}`,
    characterId: "taki",
    role: i % 2 === 0 ? "user" : "assistant",
    content,
    createdAt: new Date().toISOString(),
  }));
}

function episodeFiles(root: string): string[] {
  const dir = join(root, "memory");
  try {
    return readdirSync(dir, { recursive: true }).filter(
      (p): p is string => typeof p === "string" && p.includes("episodes") && p.endsWith(".md"),
    );
  } catch {
    return []; // no memory dir yet = no episode files
  }
}

const OPTS = { toolCallId: "t", messages: [] } as unknown as ToolExecutionOptions<unknown>;
async function search(f: CompanionFixture, query: string): Promise<unknown> {
  const t = f.memory.createTools("taki").memory_search as Tool;
  if (!t.execute) throw new Error("no execute");
  return t.execute({ query } as never, OPTS);
}

describe("createEpisodicWriter", () => {
  it("writes 1-3 episode entries via the store (file + index both visible), clamping importance to 3-7", async () => {
    const f = fresh();
    const model = generatingModel(
      JSON.stringify([
        { content: "聊到了周末去爬山的计划", importance: 9, disclosure: "爬山" }, // 9 -> clamp 7
        { content: "她说最近工作很累", importance: 1 }, // 1 -> clamp 3
      ]),
    );
    const writer = createEpisodicWriter({ model, writeEpisode: episodeOp(f) });

    const { entryIds } = await writer.summarize({ characterId: "taki", segment: seg("周末想去爬山", "好啊一起") });
    expect(entryIds).toHaveLength(2);

    const files = episodeFiles(f.root);
    expect(files).toHaveLength(2);
    const contents = files.map((rel) => readFileSync(join(f.root, "memory", rel), "utf8"));
    const clamped = contents.find((c) => c.includes("聊到了周末去爬山的计划")) ?? "";
    expect(clamped).toContain('layer: "episodes"');
    expect(clamped).toContain("importance: 7");
    expect(contents.find((c) => c.includes("她说最近工作很累"))).toContain("importance: 3");

    // Index visibility: the memory_search tool (FTS) finds the just-written episode.
    const hit = (await search(f, "爬山")) as { ok: boolean; results: Array<{ content: string }> };
    expect(hit.ok).toBe(true);
    expect(hit.results.some((r) => r.content.includes("爬山"))).toBe(true);
  });

  it("writes nothing for an empty summaries array (nothing worth keeping)", async () => {
    const f = fresh();
    const writer = createEpisodicWriter({ model: generatingModel("[]"), writeEpisode: episodeOp(f) });

    const { entryIds } = await writer.summarize({ characterId: "taki", segment: seg("哈哈", "嗯") });
    expect(entryIds).toEqual([]);
    expect(episodeFiles(f.root)).toEqual([]);
  });

  it("caps at 3 entries even when the model returns more", async () => {
    const f = fresh();
    const many = Array.from({ length: 5 }, (_, i) => ({ content: `事件${i}`, importance: 5 }));
    const writer = createEpisodicWriter({ model: generatingModel(JSON.stringify(many)), writeEpisode: episodeOp(f) });

    const { entryIds } = await writer.summarize({ characterId: "taki", segment: seg("x") });
    expect(entryIds).toHaveLength(3);
    expect(episodeFiles(f.root)).toHaveLength(3);
  });

  it("rejects (no writes) when the model output is not valid JSON — the caller advances no watermark", async () => {
    const f = fresh();
    const writer = createEpisodicWriter({ model: generatingModel("sorry I can't do that"), writeEpisode: episodeOp(f) });

    await expect(writer.summarize({ characterId: "taki", segment: seg("x") })).rejects.toThrow();
    expect(episodeFiles(f.root)).toEqual([]);
  });

  it("propagates a provider failure (no writes)", async () => {
    const f = fresh();
    const writer = createEpisodicWriter({ model: failingGenerateModel(new Error("provider down")), writeEpisode: episodeOp(f) });

    await expect(writer.summarize({ characterId: "taki", segment: seg("x") })).rejects.toThrow("provider down");
    expect(episodeFiles(f.root)).toEqual([]);
  });
});

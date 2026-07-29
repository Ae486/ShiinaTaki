import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { TimelineEntry } from "@taki/shared";
import type { Tool, ToolExecutionOptions } from "ai";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { failingGenerateModel, generatingModel } from "../testing/mock-language-model.ts";
import { getLayer } from "./layer-registry.ts";
import { createEpisodicWriter, type MemoryWriteOp } from "./episodic-writer.ts";

const fixtures: CompanionFixture[] = [];
function fresh(): CompanionFixture {
  const f = createCompanionFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

// The engine's write op, bound exactly as main.ts binds it: the WRITER picks the layer (T5 Q11-1), not the binding.
function memoryOp(f: CompanionFixture): MemoryWriteOp {
  return ({ layer, ...rest }) => f.memory.writeEntry({ ...rest, type: layer });
}

type WriteCall = Parameters<MemoryWriteOp>[0];
// A recording op for the assertions about what the writer HANDS the store (layer/importance/turnSeq).
function recordingOp(): { calls: WriteCall[]; op: MemoryWriteOp } {
  const calls: WriteCall[] = [];
  return {
    calls,
    op: (input) => {
      calls.push(input);
      return { id: `id-${calls.length}` };
    },
  };
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

function layerFiles(root: string, layer: string): string[] {
  const dir = join(root, "memory");
  try {
    return readdirSync(dir, { recursive: true }).filter(
      (p): p is string => typeof p === "string" && p.includes(layer) && p.endsWith(".md"),
    );
  } catch {
    return []; // no memory dir yet = nothing written
  }
}

// Every entry file regardless of layer — used where the assertion is "the store was not touched at all".
function allEntryFiles(root: string): string[] {
  return layerFiles(root, "");
}

const OPTS = { toolCallId: "t", messages: [] } as unknown as ToolExecutionOptions<unknown>;
async function search(f: CompanionFixture, query: string): Promise<unknown> {
  const t = f.memory.createTools("taki").memory_search as Tool;
  if (!t.execute) throw new Error("no execute");
  return t.execute({ query } as never, OPTS);
}

describe("createEpisodicWriter", () => {
  it("writes each entry into the layer the model chose (file + index both visible)", async () => {
    const f = fresh();
    const model = generatingModel(
      JSON.stringify([
        { layer: "episodes", content: "聊到了周末去爬山的计划", importance: 6, disclosure: "爬山" },
        { layer: "profile", content: "他说自己怕高", importance: 6 },
      ]),
    );
    const writer = createEpisodicWriter({ model, writeMemory: memoryOp(f) });

    const { entryIds } = await writer.summarize({ characterId: "taki", segment: seg("周末想去爬山", "好啊一起") });
    expect(entryIds).toHaveLength(2);

    const episodes = layerFiles(f.root, "episodes");
    expect(episodes).toHaveLength(1);
    expect(readFileSync(join(f.root, "memory", episodes[0] as string), "utf8")).toContain('layer: "episodes"');
    const profile = layerFiles(f.root, "profile");
    expect(profile).toHaveLength(1);
    expect(readFileSync(join(f.root, "memory", profile[0] as string), "utf8")).toContain("他说自己怕高");

    // Index visibility: the memory_search tool (FTS) finds the just-written entry.
    const hit = (await search(f, "爬山")) as { ok: boolean; results: Array<{ content: string }> };
    expect(hit.ok).toBe(true);
    expect(hit.results.some((r) => r.content.includes("爬山"))).toBe(true);
  });

  it("writing NOTHING is the normal outcome, not an error (T5-R15 — the quota is gone)", async () => {
    const f = fresh();
    const writer = createEpisodicWriter({ model: generatingModel("[]"), writeMemory: memoryOp(f) });

    const { entryIds } = await writer.summarize({ characterId: "taki", segment: seg("哈哈", "嗯") });
    expect(entryIds).toEqual([]);
    expect(allEntryFiles(f.root)).toEqual([]);
  });

  it("falls back to episodes when the layer is omitted or outside the auto-writable set", async () => {
    const rec = recordingOp();
    // "relationship" is writable but PINNED by policy, so the auto path may never choose it (Q11-1); it degrades
    // to the fallback rather than throwing away the whole pass — including the sibling summary in the same array.
    const model = generatingModel(
      JSON.stringify([
        { content: "没写 layer 的一条" },
        { layer: "relationship", content: "想钉在最前面的一条", importance: 10 },
      ]),
    );
    const writer = createEpisodicWriter({ model, writeMemory: rec.op });

    const { entryIds } = await writer.summarize({ characterId: "taki", segment: seg("x") });
    expect(entryIds).toHaveLength(2);
    expect(rec.calls.map((c) => c.layer)).toEqual(["episodes", "episodes"]);
  });

  it("clamps importance below the chosen layer's pin threshold — an auto write can never become always-visible", async () => {
    const rec = recordingOp();
    const model = generatingModel(
      JSON.stringify([
        { layer: "profile", content: "他叫 pleia", importance: 10 }, // asks for the pin line
        { layer: "episodes", content: "无关紧要的小事", importance: 0 }, // asks below the band
      ]),
    );
    const writer = createEpisodicWriter({ model, writeMemory: rec.op });

    await writer.summarize({ characterId: "taki", segment: seg("x") });

    const profileThreshold = getLayer("profile")?.pinnedImportanceThreshold;
    expect(profileThreshold).toBeDefined();
    expect(rec.calls[0]?.importance).toBeLessThan(profileThreshold as number);
    expect(rec.calls[1]?.importance).toBe(3); // floor of the auto band
  });

  it("passes the segment's LAST seq through as the turn this pass judged", async () => {
    const rec = recordingOp();
    const writer = createEpisodicWriter({
      model: generatingModel(JSON.stringify([{ layer: "episodes", content: "一件事", importance: 5 }])),
      writeMemory: rec.op,
    });

    await writer.summarize({ characterId: "taki", segment: seg("a", "b", "c") });
    expect(rec.calls[0]?.turnSeq).toBe(3);
  });

  it("caps at 3 entries even when the model returns more", async () => {
    const f = fresh();
    const many = Array.from({ length: 5 }, (_, i) => ({ layer: "episodes", content: `事件${i}`, importance: 5 }));
    const writer = createEpisodicWriter({ model: generatingModel(JSON.stringify(many)), writeMemory: memoryOp(f) });

    const { entryIds } = await writer.summarize({ characterId: "taki", segment: seg("x") });
    expect(entryIds).toHaveLength(3);
    expect(layerFiles(f.root, "episodes")).toHaveLength(3);
  });

  it("rejects (no writes) when the model output is not valid JSON — the caller advances no watermark", async () => {
    const f = fresh();
    const writer = createEpisodicWriter({ model: generatingModel("sorry I can't do that"), writeMemory: memoryOp(f) });

    await expect(writer.summarize({ characterId: "taki", segment: seg("x") })).rejects.toThrow();
    expect(allEntryFiles(f.root)).toEqual([]);
  });

  it("propagates a provider failure (no writes)", async () => {
    const f = fresh();
    const writer = createEpisodicWriter({
      model: failingGenerateModel(new Error("provider down")),
      writeMemory: memoryOp(f),
    });

    await expect(writer.summarize({ characterId: "taki", segment: seg("x") })).rejects.toThrow("provider down");
    expect(allEntryFiles(f.root)).toEqual([]);
  });
});

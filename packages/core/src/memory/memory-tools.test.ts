import { afterEach, describe, expect, it } from "vitest";
import type { Tool, ToolExecutionOptions } from "ai";
import { z } from "zod";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { AUTO_LAYER_CHOICES } from "./auto-layer-policy.ts";

const fixtures: CompanionFixture[] = [];
function fresh(): CompanionFixture {
  const f = createCompanionFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

// Test-only: the tools ignore ToolExecutionOptions, so a minimal stub is enough to invoke execute directly.
const OPTS = { toolCallId: "t", messages: [] } as unknown as ToolExecutionOptions<unknown>;
async function run(t: Tool | undefined, input: unknown): Promise<Record<string, unknown>> {
  const exec = t?.execute;
  if (!exec) throw new Error("tool has no execute");
  return (await exec(input as never, OPTS)) as Record<string, unknown>;
}

function resultsOf(result: Record<string, unknown>): unknown[] {
  return (result.results ?? []) as unknown[];
}

// The `type` enum IS the enforcement (the SDK zod-parses a tool call before execute ever runs), so the assertion has
// to read the schema — invoking execute directly would bypass the very control under test.
function writableLayersOf(t: Tool | undefined): string[] {
  const schema = t?.inputSchema;
  if (!(schema instanceof z.ZodObject)) return [];
  const type = schema.shape.type;
  return type instanceof z.ZodEnum ? type.options.filter((v) => typeof v === "string") : [];
}

describe("memory tools (T12)", () => {
  it("writes a relationship promise and reports its id", async () => {
    const tools = fresh().memory.createTools("taki");
    const result = await run(tools.memory_write, { type: "relationship", content: "每周五看电影", importance: 10 });
    expect(result).toMatchObject({ ok: true, layer: "relationship" });
    // The write is immediately searchable (indexed after the file write).
    const search = await run(tools.memory_search, { query: "每周五" });
    expect(search).toMatchObject({ ok: true });
    expect(resultsOf(search)).toHaveLength(1);
  });

  it("refuses a non-writable layer with a structured {ok:false}, never a throw", async () => {
    const tools = fresh().memory.createTools("taki");
    const result = await run(tools.memory_write, { type: "activity", content: "machine only", importance: 3 });
    expect(result).toEqual({ ok: false, code: "LAYER_NOT_WRITABLE", message: expect.stringContaining("activity") });
  });

  it("archives an existing memory and misses a bogus id", async () => {
    const tools = fresh().memory.createTools("taki");
    const written = await run(tools.memory_write, { type: "episodes", content: "一次聊到豚骨拉面", importance: 4 });
    const id = written.id as string;

    expect(await run(tools.memory_archive, { id })).toEqual({ ok: true, id });
    // Archived entries drop out of active search.
    expect(resultsOf(await run(tools.memory_search, { query: "豚骨拉面" }))).toHaveLength(0);

    expect(await run(tools.memory_archive, { id: "9999-nope" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("isolates search by the bound characterId", async () => {
    const f = fresh();
    await run(f.memory.createTools("taki").memory_write, { type: "relationship", content: "taki的豚骨拉面约定", importance: 10 });
    const yuiSearch = await run(f.memory.createTools("yui").memory_search, { query: "豚骨拉面" });
    expect(resultsOf(yuiSearch)).toHaveLength(0);
  });
});

describe("background memory tools (T5 Q11-1 — every AUTOMATIC path is clamped)", () => {
  it("keeps the pinned-policy layers out of the write tool's schema, so they are not even expressible", () => {
    const write = fresh().memory.createBackgroundTools("taki").memory_write;
    const layers = writableLayersOf(write);

    expect(layers).toEqual([...AUTO_LAYER_CHOICES]);
    expect(layers).not.toContain("relationship");
    // The conversation set is unchanged — the restriction is on the automatic path, not on her deliberate act.
    expect(writableLayersOf(fresh().memory.createTools("taki").memory_write)).toContain("relationship");
  });

  it("clamps a maximal importance below the pin line, so an automatic write can never become always-visible", async () => {
    const f = fresh();
    const result = await run(f.memory.createBackgroundTools("taki").memory_write, {
      type: "profile",
      content: "他叫 pleia",
      importance: 10,
    });

    expect(result).toMatchObject({ ok: true, layer: "profile" });
    // The pinned block is the property that matters: a clamped profile row must not reach it.
    expect(f.memory.assemble({ characterId: "taki", queryText: "名字" })).not.toContain(
      "Promises and facts you always keep in mind:",
    );
  });

  it("describes only the layers it actually accepts (a description must match reality)", () => {
    const description = fresh().memory.createBackgroundTools("taki").memory_write?.description ?? "";
    expect(description).not.toContain("relationship");
    for (const id of AUTO_LAYER_CHOICES) expect(description).toContain(`'${id}'`);
  });

  it("leaves search and archive untouched", async () => {
    const tools = fresh().memory.createBackgroundTools("taki");
    const written = await run(tools.memory_write, { type: "episodes", content: "一次聊到豚骨拉面", importance: 4 });
    expect(resultsOf(await run(tools.memory_search, { query: "豚骨拉面" }))).toHaveLength(1);
    expect(await run(tools.memory_archive, { id: written.id as string })).toMatchObject({ ok: true });
  });
});

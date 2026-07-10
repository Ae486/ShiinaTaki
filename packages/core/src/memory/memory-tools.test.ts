import { afterEach, describe, expect, it } from "vitest";
import type { Tool, ToolExecutionOptions } from "ai";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";

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

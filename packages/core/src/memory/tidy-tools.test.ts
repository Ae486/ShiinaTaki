import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool, ToolExecutionOptions } from "ai";
import { z } from "zod";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createBlockStore } from "./block-store.ts";
import { createMemoryEngine, type MemoryEngine } from "./memory-engine.ts";

interface TidyFixture {
  engine: MemoryEngine;
  db: Database;
  root: string;
}

const opened: Array<{ db: Database; root: string }> = [];
function fresh(): TidyFixture {
  const root = mkdtempSync(join(tmpdir(), "taki-tidy-"));
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  opened.push({ db, root });
  const engine = createMemoryEngine({
    db,
    memoryRoot: join(root, "memory"),
    blocks: createBlockStore({ root: join(root, "blocks") }),
  });
  return { engine, db, root };
}
afterEach(() => {
  for (const { db, root } of opened.splice(0)) {
    db.close();
    rmTempDir(root);
  }
});

// Test-only: the tools ignore ToolExecutionOptions, so a minimal stub is enough to invoke execute directly.
const OPTS = { toolCallId: "t", messages: [] } as unknown as ToolExecutionOptions<unknown>;
async function run(t: Tool | undefined, input: unknown): Promise<Record<string, unknown>> {
  const exec = t?.execute;
  if (!exec) throw new Error("tool has no execute");
  return (await exec(input as never, OPTS)) as Record<string, unknown>;
}

function activeRows(engine: MemoryEngine) {
  return engine.tidy.listActive("taki");
}

describe("tidy tools (batch 4b — maintenance verbs the foreground agent never gets)", () => {
  it("reinforce refreshes recency and count without touching importance; unknown id is NOT_FOUND", async () => {
    const { engine } = fresh();
    const { id } = engine.writeEntry({ characterId: "taki", type: "episodes", content: "一起去了秋叶原", importance: 5 });
    const tools = engine.tidy.createTools("taki");

    expect(await run(tools.memory_reinforce, { id })).toEqual({ ok: true, id });

    const [row] = activeRows(engine);
    expect(row?.importance).toBe(5);
    expect(row?.updatedAt).not.toBeNull();
    expect(readFileSync(row?.path ?? "", "utf8")).toContain("reinforce_count: 1");

    expect(await run(tools.memory_reinforce, { id: "9999-nope" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("archive_supersede without a replacement archives the row (file kept — R8 reversibility)", async () => {
    const { engine } = fresh();
    const { id } = engine.writeEntry({ characterId: "taki", type: "episodes", content: "过时的旧记忆", importance: 4 });
    const path = activeRows(engine)[0]?.path ?? "";
    const tools = engine.tidy.createTools("taki");

    expect(await run(tools.memory_archive_supersede, { id })).toEqual({ ok: true, archived: id });

    expect(activeRows(engine)).toHaveLength(0);
    expect(readFileSync(path, "utf8")).toContain('status: "archived"');
  });

  it("archive_supersede with a replacement is the sanctioned promotion route — no auto ceiling, no auto layer set", async () => {
    const { engine } = fresh();
    const { id } = engine.writeEntry({ characterId: "taki", type: "episodes", content: "他叫P", importance: 4 });
    const tools = engine.tidy.createTools("taki");

    const result = await run(tools.memory_archive_supersede, {
      id,
      replacement: { layer: "relationship", content: "他叫P，答应了一直记得", importance: 10, disclosure: "用户问自己叫什么" },
    });

    expect(result).toMatchObject({ ok: true, archived: id, replacement: { layer: "relationship" } });
    const [row] = activeRows(engine);
    // The background writer could never do this: relationship at importance 10 is the always-visible rung (Q11-1).
    expect(row).toMatchObject({ layer: "relationship", importance: 10, disclosure: "用户问自己叫什么" });
  });

  it("a replacement that duplicates a THIRD row reinforces it instead of minting a second copy (R9 stays live)", async () => {
    const { engine } = fresh();
    const keeper = engine.writeEntry({ characterId: "taki", type: "episodes", content: "喜欢豚骨拉面", importance: 4 });
    const wrong = engine.writeEntry({ characterId: "taki", type: "episodes", content: "写错了的记录", importance: 3 });
    const tools = engine.tidy.createTools("taki");

    const result = await run(tools.memory_archive_supersede, {
      id: wrong.id,
      replacement: { layer: "episodes", content: "喜欢豚骨拉面。", importance: 6 },
    });

    expect(result).toMatchObject({ ok: true, replacement: { id: keeper.id } });
    const rows = activeRows(engine);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: keeper.id, importance: 6 }); // reinforced: importance maxed, no new row
  });

  it("set_disclosure repairs the trigger on file AND index (search_terms recomputed)", async () => {
    const { engine, db } = fresh();
    const { id } = engine.writeEntry({ characterId: "taki", type: "profile", content: "对香菜过敏", importance: 5 });
    const tools = engine.tidy.createTools("taki");

    expect(await run(tools.memory_set_disclosure, { id, disclosure: "用户问自己对什么过敏" })).toEqual({ ok: true, id });

    const [row] = activeRows(engine);
    expect(row?.disclosure).toBe("用户问自己对什么过敏");
    expect(readFileSync(row?.path ?? "", "utf8")).toContain("disclosure:");
    const fts = db.prepare("SELECT search_terms FROM memory_fts WHERE path = :path").get({ path: row?.path ?? "" });
    expect(String(fts?.search_terms)).toContain("过敏");
  });

  it("refile moves the file across layer directories (even across ownership) with id, dates and importance intact", async () => {
    const { engine } = fresh();
    const { id } = engine.writeEntry({ characterId: "taki", type: "profile", content: "喜欢深夜写代码", importance: 5 });
    const before = activeRows(engine)[0];
    const tools = engine.tidy.createTools("taki");

    expect(await run(tools.memory_refile, { id, layer: "episodes" })).toEqual({ ok: true, id, layer: "episodes" });

    const [after] = activeRows(engine);
    expect(after).toMatchObject({ id, layer: "episodes", importance: 5, createdAt: before?.createdAt });
    expect(after?.path).toContain(join("characters", "taki", "episodes"));
    expect(existsSync(before?.path ?? "")).toBe(false);
    expect(existsSync(after?.path ?? "")).toBe(true);
    expect(activeRows(engine)).toHaveLength(1); // the old index row is gone, not orphaned
  });

  it("refile's layer set is the writable registry set — machine layers are not even expressible", () => {
    const { engine } = fresh();
    const schema = engine.tidy.createTools("taki").memory_refile?.inputSchema;
    expect(schema instanceof z.ZodObject && schema.safeParse({ id: "0001-x", layer: "activity" }).success).toBe(false);
    expect(schema instanceof z.ZodObject && schema.safeParse({ id: "0001-x", layer: "episodes" }).success).toBe(true);
  });

  it("block_rethink writes the background blocks in their registry placement and is REFUSED on the user's card", async () => {
    const { engine, root } = fresh();
    const tools = engine.tidy.createTools("taki");

    expect(await run(tools.block_rethink, { id: "user-model", content: "他是夜猫子，常在深夜写代码。" })).toEqual({
      ok: true,
      id: "user-model",
    });
    expect(readFileSync(join(root, "blocks", "global", "user-model.md"), "utf8")).toContain("夜猫子");

    expect(await run(tools.block_rethink, { id: "memory-index", content: "- 用户问自己叫什么 → profile" })).toEqual({
      ok: true,
      id: "memory-index",
    });
    expect(existsSync(join(root, "blocks", "characters", "taki", "memory-index.md"))).toBe(true);

    const refused = await run(tools.block_rethink, { id: "user-card", content: "试图篡改" });
    expect(refused).toMatchObject({ ok: false, code: "REFUSED" });
    expect(String(refused.message)).toContain("user");
    expect(existsSync(join(root, "blocks", "global", "user-card.md"))).toBe(false);
  });

  it("finish is a pure no-op terminal, and a broken row op degrades to {ok:false} — never a throw", async () => {
    const { engine } = fresh();
    const { id } = engine.writeEntry({ characterId: "taki", type: "episodes", content: "会被手动删掉的行", importance: 3 });
    const tools = engine.tidy.createTools("taki");

    expect(await run(tools.memory_finish_edits, {})).toEqual({ ok: true });

    rmSync(activeRows(engine)[0]?.path ?? "", { force: true }); // index still points at the file
    expect(await run(tools.memory_reinforce, { id })).toMatchObject({ ok: false, code: "IO_ERROR" });
  });
});

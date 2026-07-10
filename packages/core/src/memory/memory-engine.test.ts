import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool, ToolExecutionOptions } from "ai";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { rmTempDir } from "../testing/rm-temp.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

const OPTS = { toolCallId: "t", messages: [] } as unknown as ToolExecutionOptions<unknown>;
async function run(t: Tool | undefined, input: unknown): Promise<unknown> {
  if (!t?.execute) throw new Error("tool has no execute");
  return t.execute(input as never, OPTS);
}

function withFixture(dbPath?: string): CompanionFixture {
  const f = createCompanionFixture({ dbPath });
  cleanups.push(() => f.cleanup());
  return f;
}

describe("memory engine restart (T14, AC 2/11)", () => {
  it("rebuilds identical retrieval from files when the DB is fresh (files are truth)", async () => {
    const f = withFixture(); // :memory: — reopen() gives a brand-new empty index
    await run(f.memory.createTools("taki").memory_write, { type: "relationship", content: "每周五一起看电影", importance: 10 });
    await run(f.memory.createTools("taki").memory_write, { type: "profile", content: "最爱豚骨拉面", importance: 9 });

    const before = f.memory.assemble({ characterId: "taki", queryText: "约定 拉面" });
    expect(before).toContain("每周五一起看电影");

    f.reopen(); // fresh DB -> boot reconcile rebuilds the index purely from the markdown files

    const after = f.memory.assemble({ characterId: "taki", queryText: "约定 拉面" });
    expect(after).toBe(before);
    expect(after).toContain("Promises and facts you always keep in mind:");
  });

  it("keeps the pinned promise across a restart over the SAME db file", async () => {
    const dbDir = mkdtempSync(join(tmpdir(), "taki-db-"));
    const f = withFixture(join(dbDir, "taki.db")); // pushes f.cleanup() (closes the db) first
    cleanups.push(() => rmTempDir(dbDir)); // then remove the db dir

    await run(f.memory.createTools("taki").memory_write, { type: "relationship", content: "答应帮她修好电脑", importance: 10 });
    const before = f.memory.assemble({ characterId: "taki", queryText: "电脑" });

    f.reopen(); // new engine instances over the persisted db + workspace

    expect(f.memory.assemble({ characterId: "taki", queryText: "电脑" })).toBe(before);
  });
});

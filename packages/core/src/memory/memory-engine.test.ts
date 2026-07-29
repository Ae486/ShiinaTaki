import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool, ToolExecutionOptions } from "ai";
import { createMemoryEventsRepo } from "../db/memory-events-repo.ts";
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

// Every entry file under the workspace, whatever its layer — "did a second row appear?" is the whole question here.
function entryFiles(root: string): string[] {
  try {
    return readdirSync(join(root, "memory"), { recursive: true }).filter(
      (p): p is string => typeof p === "string" && p.endsWith(".md"),
    );
  } catch {
    return [];
  }
}

describe("memory engine dedupe -> reinforce (T5-R9)", () => {
  it("reinforces the EXISTING entry instead of writing a second row", () => {
    const f = withFixture();
    const first = f.memory.writeEntry({ characterId: "taki", type: "episodes", content: "他喜欢吃豚骨拉面", importance: 4 });

    // A near-duplicate (trailing punctuation only) — evidence that recall FAILED, so it lifts the entry it repeats.
    const second = f.memory.writeEntry({
      characterId: "taki",
      type: "episodes",
      content: "他喜欢吃豚骨拉面。",
      importance: 7,
      turnSeq: 12,
    });

    expect(second.id).toBe(first.id);
    expect(second.layer).toBe("episodes");
    expect(entryFiles(f.root)).toHaveLength(1);

    // The reinforcement is visible through the index, not only on disk.
    const rows = f.memory.assemble({ characterId: "taki", queryText: "豚骨拉面" });
    expect(rows.match(/他喜欢吃豚骨拉面/g)).toHaveLength(1);
  });

  it("records a reinforce event carrying the entry id and the turn that caused it", () => {
    const f = withFixture();
    const events = createMemoryEventsRepo(f.db);
    const first = f.memory.writeEntry({ characterId: "taki", type: "episodes", content: "他喜欢拉面", importance: 4 });

    f.memory.writeEntry({ characterId: "taki", type: "episodes", content: "他喜欢拉面!", importance: 5, turnSeq: 12 });

    const [event] = events.listByCharacter({ characterId: "taki", limit: 10 });
    expect(event?.kind).toBe("reinforce");
    expect(event?.entryId).toBe(first.id);
    expect(event?.turnSeq).toBe(12);
  });

  it("raises the duplicate's importance without ever demoting it", () => {
    const f = withFixture();
    f.memory.writeEntry({ characterId: "taki", type: "profile", content: "他叫 pleia", importance: 10 });
    f.memory.writeEntry({ characterId: "taki", type: "profile", content: "他叫 pleia", importance: 3 });

    // Importance 10 keeps it in the pinned block; a demotion to 3 would silently drop it out of every prompt.
    expect(f.memory.assemble({ characterId: "taki", queryText: "名字" })).toContain(
      "Promises and facts you always keep in mind:",
    );
  });

  it("writes a fresh row and records NO event when the content is genuinely new", () => {
    const f = withFixture();
    const events = createMemoryEventsRepo(f.db);

    const a = f.memory.writeEntry({ characterId: "taki", type: "episodes", content: "他喜欢拉面", importance: 4 });
    const b = f.memory.writeEntry({ characterId: "taki", type: "episodes", content: "他周五要去看电影", importance: 4 });

    expect(b.id).not.toBe(a.id);
    expect(entryFiles(f.root)).toHaveLength(2);
    expect(events.listByCharacter({ characterId: "taki", limit: 10 })).toEqual([]);
  });

  it("scopes the duplicate check to the layer — the same sentence in another layer is a new row", () => {
    const f = withFixture();
    const episode = f.memory.writeEntry({ characterId: "taki", type: "episodes", content: "他喜欢拉面", importance: 4 });
    const profile = f.memory.writeEntry({ characterId: "taki", type: "profile", content: "他喜欢拉面", importance: 6 });

    expect(profile.id).not.toBe(episode.id);
    expect(entryFiles(f.root)).toHaveLength(2);
  });
});

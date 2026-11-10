import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { entryFromFile, entryToFile } from "./entry.ts";
import { startRetentionSweeper } from "./retention-sweeper.ts";
import { createMemoryStore } from "./store.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-07-30T12:00:00.000Z");

const fixtures: CompanionFixture[] = [];
function fresh(): CompanionFixture {
  const f = createCompanionFixture();
  fixtures.push(f);
  return f;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  for (const f of fixtures.splice(0)) f.cleanup();
});

interface SeedInput {
  layer: string;
  characterId?: string;
  importance?: number;
  expires?: string;
}

/**
 * Write a real entry file, then rewrite its frontmatter dates so the row has a controllable age. `expires` goes in
 * the same way for a reason worth keeping visible: no write path sets it today (batch-1 planning note 2).
 */
function seed(f: CompanionFixture, input: SeedInput, dates: { created?: string; updated?: string } = {}): string {
  const store = createMemoryStore({ root: join(f.root, "memory") });
  const stored = store.write({
    layer: input.layer,
    characterId: input.characterId ?? "taki",
    content: `${input.layer} 的一条记忆`,
    importance: input.importance ?? 5,
    expires: input.expires,
  });
  const { entry, body } = entryFromFile(readFileSync(stored.filePath, "utf8"));
  writeFileSync(stored.filePath, entryToFile({ ...entry, ...dates }, body));
  f.memory.reconcile();
  return stored.filePath;
}

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

function sweep(f: CompanionFixture) {
  const { logger, records } = createCaptureLogger();
  startRetentionSweeper({ ops: f.memory.retention, intentionsDefaultDays: 30, logger, now: () => NOW });
  return records;
}

function statusOf(path: string): string {
  return entryFromFile(readFileSync(path, "utf8")).entry.status;
}

describe("retention sweeper — rolling window (activity: the one sanctioned hard delete)", () => {
  it("hard-deletes an activity row past its window: file gone AND index row gone", () => {
    const f = fresh();
    const path = seed(f, { layer: "activity" }, { created: daysAgo(40) });

    sweep(f);

    expect(existsSync(path)).toBe(false);
    expect(f.memory.retention.listActive("activity")).toEqual([]);
  });

  it("keeps an activity row inside its window", () => {
    const f = fresh();
    const path = seed(f, { layer: "activity" }, { created: daysAgo(10) });

    sweep(f);

    expect(existsSync(path)).toBe(true);
    expect(f.memory.retention.listActive("activity")).toHaveLength(1);
  });
});

describe("retention sweeper — expiring (intentions)", () => {
  it("captures the current fallback once per future sweep without replacing explicit expiries", () => {
    const f = fresh();
    const implicit = seed(f, { layer: "intentions" }, { created: daysAgo(20) });
    const explicit = seed(f, { layer: "intentions", expires: new Date(NOW + DAY_MS).toISOString() }, { created: daysAgo(40) });
    let days = 30;
    const capture = vi.fn(() => days);
    const timer = startRetentionSweeper({ ops: f.memory.retention, intentionsDefaultDays: capture,
      logger: createCaptureLogger().logger, now: () => NOW });
    expect(statusOf(implicit)).toBe("active");
    expect(capture).toHaveBeenCalledTimes(1);
    days = 10;
    vi.advanceTimersByTime(6 * 60 * 60 * 1000);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(statusOf(implicit)).toBe("archived");
    expect(statusOf(explicit)).toBe("active");
    timer.stop();
  });

  it("archives an expired intention and KEEPS its file (R8: reversible)", () => {
    const f = fresh();
    const path = seed(f, { layer: "intentions", expires: daysAgo(1) }, { created: daysAgo(5) });

    sweep(f);

    expect(existsSync(path)).toBe(true);
    expect(statusOf(path)).toBe("archived");
    expect(f.memory.retention.listActive("intentions")).toEqual([]);
  });

  it("keeps an intention whose expiry is still ahead, however old the row is", () => {
    const f = fresh();
    const path = seed(f, { layer: "intentions", expires: new Date(NOW + DAY_MS).toISOString() }, { created: daysAgo(400) });

    sweep(f);

    expect(statusOf(path)).toBe("active");
  });

  it("archives a NULL-expiry intention once it is older than the configured window", () => {
    const f = fresh();
    // Nothing sets `expires` today, so without this fallback the expiring layer would never expire anything.
    const stale = seed(f, { layer: "intentions" }, { created: daysAgo(45) });
    const recent = seed(f, { layer: "intentions" }, { created: daysAgo(10) });

    sweep(f);

    expect(statusOf(stale)).toBe("archived");
    expect(statusOf(recent)).toBe("active");
  });
});

describe("retention sweeper — importance decay (episodes)", () => {
  it("archives an old episode below the importance cut", () => {
    const f = fresh();
    const path = seed(f, { layer: "episodes", importance: 3 }, { created: daysAgo(120) });

    sweep(f);

    expect(statusOf(path)).toBe("archived");
    expect(existsSync(path)).toBe(true);
  });

  it("keeps an old episode AT or above the cut, and a young one below it", () => {
    const f = fresh();
    const important = seed(f, { layer: "episodes", importance: 4 }, { created: daysAgo(120) });
    const young = seed(f, { layer: "episodes", importance: 2 }, { created: daysAgo(30) });

    sweep(f);

    expect(statusOf(important)).toBe("active");
    expect(statusOf(young)).toBe("active");
  });

  it("does NOT decay a reinforced row on its birth date (R9: updated_at is the age anchor)", () => {
    const f = fresh();
    const reinforced = seed(f, { layer: "episodes", importance: 2 }, { created: daysAgo(200), updated: daysAgo(1) });

    sweep(f);

    expect(statusOf(reinforced)).toBe("active");
  });
});

describe("retention sweeper — permanent layers and reporting", () => {
  it("never touches a permanent layer, however old or unimportant the row is", () => {
    const f = fresh();
    const profile = seed(f, { layer: "profile", importance: 1 }, { created: daysAgo(900) });
    const promise = seed(f, { layer: "relationship", importance: 1 }, { created: daysAgo(900) });

    sweep(f);

    expect(statusOf(profile)).toBe("active");
    expect(statusOf(promise)).toBe("active");
  });

  it("logs counts only — no paths, no ids, no memory text", () => {
    const f = fresh();
    seed(f, { layer: "activity" }, { created: daysAgo(40) });
    seed(f, { layer: "episodes", importance: 2 }, { created: daysAgo(120) });

    const records = sweep(f);

    expect(records).toEqual([
      { level: "info", obj: { archived: 1, deleted: 1 }, msg: "memory retention swept" },
    ]);
  });

  it("stays silent on a store with nothing to reclaim", () => {
    const f = fresh();
    seed(f, { layer: "episodes", importance: 8 }, { created: daysAgo(10) });

    expect(sweep(f)).toEqual([]);
  });
});

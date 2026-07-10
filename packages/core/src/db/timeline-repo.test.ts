import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { createTimelineRepo, type TimelineRepo } from "./timeline-repo.ts";

let db: Database;
let repo: TimelineRepo;

beforeEach(() => {
  db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  repo = createTimelineRepo(db);
});

afterEach(() => {
  db.close();
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("createTimelineRepo.append", () => {
  it("assigns an ascending seq, a uuid id, and an ISO createdAt", () => {
    const first = repo.append({ characterId: "taki", role: "user", content: "hi" });
    const second = repo.append({ characterId: "taki", role: "assistant", content: "hello" });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(first.id).toMatch(UUID_RE);
    expect(first.id).not.toBe(second.id);
    expect(new Date(first.createdAt).toISOString()).toBe(first.createdAt);
    expect(first).toMatchObject({ characterId: "taki", role: "user", content: "hi" });
  });
});

describe("createTimelineRepo.pageBefore", () => {
  beforeEach(() => {
    for (let i = 1; i <= 5; i += 1) repo.append({ characterId: "taki", role: "user", content: `m${i}` });
  });

  it("returns a newest-first page and a cursor for the next page", () => {
    const page = repo.pageBefore({ characterId: "taki", limit: 2 });
    expect(page.entries.map((entry) => entry.content)).toEqual(["m5", "m4"]);
    expect(page.nextBefore).toBe(page.entries[1]?.seq); // seq of m4
  });

  it("walks backward across pages via the cursor and ends with nextBefore null", () => {
    const collected: string[] = [];
    let before: number | undefined;
    for (;;) {
      const page = repo.pageBefore({ characterId: "taki", before, limit: 2 });
      collected.push(...page.entries.map((entry) => entry.content));
      if (page.nextBefore === null) break;
      before = page.nextBefore;
    }
    expect(collected).toEqual(["m5", "m4", "m3", "m2", "m1"]);
  });

  it("caps a page at the requested limit", () => {
    expect(repo.pageBefore({ characterId: "taki", limit: 3 }).entries).toHaveLength(3);
  });

  it("reports no next page when exactly `limit` rows remain (no phantom empty page)", () => {
    // 5 rows, limit 5: over-fetch (limit+1=6) returns only 5, so hasMore must be false.
    const page = repo.pageBefore({ characterId: "taki", limit: 5 });
    expect(page.entries).toHaveLength(5);
    expect(page.nextBefore).toBeNull();
  });

  it("returns an empty page with a null cursor when nothing is older than `before=1`", () => {
    const page = repo.pageBefore({ characterId: "taki", before: 1, limit: 2 });
    expect(page.entries).toEqual([]);
    expect(page.nextBefore).toBeNull();
  });
});

describe("createTimelineRepo.pageBefore on an empty timeline", () => {
  it("returns an empty page with a null cursor", () => {
    const page = repo.pageBefore({ characterId: "ghost", limit: 50 });
    expect(page.entries).toEqual([]);
    expect(page.nextBefore).toBeNull();
  });
});

describe("createTimelineRepo.latestAscending", () => {
  it("returns the last N entries ascending when more exist (250 -> last 200)", () => {
    for (let i = 1; i <= 250; i += 1) repo.append({ characterId: "taki", role: "user", content: `m${i}` });

    const window = repo.latestAscending("taki", 200);

    expect(window).toHaveLength(200);
    expect(window[0]?.content).toBe("m51"); // 250 - 200 + 1
    expect(window.at(-1)?.content).toBe("m250");
    expect(window[0]?.seq).toBeLessThan(window.at(-1)?.seq ?? 0);
  });

  it("returns everything ascending when fewer than the window exist", () => {
    repo.append({ characterId: "taki", role: "user", content: "a" });
    repo.append({ characterId: "taki", role: "assistant", content: "b" });
    expect(repo.latestAscending("taki", 200).map((entry) => entry.content)).toEqual(["a", "b"]);
  });
});

describe("createTimelineRepo.latestSeq + rangeAscending (auto-memory watermark math)", () => {
  it("latestSeq returns the highest seq, and 0 for an empty character", () => {
    expect(repo.latestSeq("ghost")).toBe(0);
    for (let i = 1; i <= 3; i += 1) repo.append({ characterId: "taki", role: "user", content: `m${i}` });
    expect(repo.latestSeq("taki")).toBe(3);
    expect(repo.latestSeq("ghost")).toBe(0);
  });

  it("rangeAscending returns the half-open (after, through] window ascending", () => {
    for (let i = 1; i <= 6; i += 1) repo.append({ characterId: "taki", role: "user", content: `m${i}` });

    const seg = repo.rangeAscending("taki", 2, 5);
    expect(seg.map((e) => e.content)).toEqual(["m3", "m4", "m5"]); // excludes seq 2, includes seq 5
  });

  it("rangeAscending excludes other characters and yields empty for an out-of-band window", () => {
    for (let i = 1; i <= 3; i += 1) repo.append({ characterId: "taki", role: "user", content: `t${i}` });
    repo.append({ characterId: "yui", role: "user", content: "y1" });

    expect(repo.rangeAscending("taki", 0, 3).map((e) => e.content)).toEqual(["t1", "t2", "t3"]);
    expect(repo.rangeAscending("taki", 3, 3)).toEqual([]); // empty half-open range
  });
});

describe("createTimelineRepo per-character isolation", () => {
  it("keeps each character's timeline separate", () => {
    repo.append({ characterId: "taki", role: "user", content: "for taki" });
    repo.append({ characterId: "yui", role: "user", content: "for yui" });

    expect(repo.latestAscending("taki", 10).map((entry) => entry.content)).toEqual(["for taki"]);
    expect(repo.pageBefore({ characterId: "yui", limit: 10 }).entries.map((entry) => entry.content)).toEqual([
      "for yui",
    ]);
  });
});

describe("timeline restart survival", () => {
  it("reads rows written before a close from a new connection on the same file", () => {
    const dir = mkdtempSync(join(tmpdir(), "taki-db-"));
    const file = join(dir, "taki.db");
    try {
      const first = openDatabase({ path: file, migrations: MIGRATIONS });
      createTimelineRepo(first).append({ characterId: "taki", role: "user", content: "before restart" });
      first.close(); // releases the OS file handle

      const second = openDatabase({ path: file, migrations: MIGRATIONS });
      const rows = createTimelineRepo(second).latestAscending("taki", 10);
      expect(rows.at(-1)?.content).toBe("before restart");
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

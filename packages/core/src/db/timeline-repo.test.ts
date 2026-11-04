import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TimelinePart } from "@taki/shared";
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

  it("sanitizes tool-call input before the JSON column and keeps legacy rows parts-less", () => {
    const sentinel = "SENTINEL_REPO_TOOL_SECRET_40ff";
    const parts: TimelinePart[] = [
      { type: "tool-call", toolCallId: "c1", toolName: "screenshot", input: { token: sentinel } },
    ];
    repo.append({ characterId: "taki", role: "assistant", content: "[tool-call: screenshot]", parts });
    repo.append({ characterId: "taki", role: "user", content: "legacy" });

    const [withParts, legacy] = repo.latestAscending("taki", 10);
    expect(withParts?.parts).toEqual([{ type: "tool-call", toolCallId: "c1", toolName: "screenshot" }]);
    expect(JSON.stringify(withParts)).not.toContain(sentinel);
    expect(legacy?.parts).toBeUndefined();
  });

  it("accepts and reads back a tool role row", () => {
    const parts: TimelinePart[] = [
      { type: "tool-result", toolCallId: "c1", toolName: "screenshot", output: { type: "json", value: { ok: true } } },
    ];
    repo.append({ characterId: "taki", role: "tool", content: "[tool-result: screenshot -> json]", parts });

    const page = repo.pageBefore({ characterId: "taki", limit: 10 });
    expect(page.entries[0]).toMatchObject({ role: "tool", parts });
  });

  it("preserves trusted image refs on their exact tool result while legacy results remain unchanged", () => {
    const ref = `attachments/${"a".repeat(64)}.png`;
    const parts: TimelinePart[] = [{ type: "tool-result", toolCallId: "capture", toolName: "extension_call",
      output: { type: "json", value: { ok: true, width: 64 } }, imageRefs: [{ mediaType: "image/png", ref }] }];
    repo.append({ characterId: "taki", role: "tool", content: "capture status", parts });
    expect(repo.latestAscending("taki", 10)[0]?.parts).toEqual(parts);
    expect(db.prepare("SELECT parts FROM timeline_messages").get()?.parts).toContain(ref);
  });

  it("strips raw input from legacy timeline JSON before returning it", () => {
    const sentinel = "SENTINEL_LEGACY_DB_SECRET_83de";
    db.prepare(
      "INSERT INTO timeline_messages (id, character_id, role, content, parts, created_at) " +
      "VALUES (:id, :characterId, :role, :content, :parts, :createdAt)",
    ).run({
      id: "550e8400-e29b-41d4-a716-446655440000",
      characterId: "taki",
      role: "assistant",
      content: "[tool-call: exec]",
      parts: JSON.stringify([{
        type: "tool-call", toolCallId: "legacy-call", toolName: "exec", input: { command: sentinel },
      }]),
      createdAt: "2026-08-14T00:00:00.000Z",
    });

    const row = repo.latestAscending("taki", 10)[0];
    expect(row?.parts).toEqual([{ type: "tool-call", toolCallId: "legacy-call", toolName: "exec" }]);
    expect(JSON.stringify(row)).not.toContain(sentinel);
  });
});

describe("timeline tool display names", () => {
  it("retains bounded names through writes and reads while scrubbing raw input only", () => {
    const displayName = "🛠".repeat(120);
    const output = { type: "json", value: { displayName: "x".repeat(300), input: "business input" }, hash: "business hash" };
    const parts: TimelinePart[] = [
      { type: "tool-call", toolCallId: "c1", toolName: "opaque_route", displayName, input: { secret: "RAW_INPUT_SENTINEL" } },
      { type: "tool-result", toolCallId: "c1", toolName: "opaque_route", displayName, output },
    ];
    const committed = repo.append({ characterId: "taki", role: "assistant", content: "canonical projection", parts });
    const expected = [
      { type: "tool-call", toolCallId: "c1", toolName: "opaque_route", displayName },
      { type: "tool-result", toolCallId: "c1", toolName: "opaque_route", displayName, output },
    ];
    expect(committed.parts).toEqual(expected);
    expect(repo.latestAscending("taki", 10)[0]?.parts).toEqual(expected);
    expect(repo.pageBefore({ characterId: "taki", limit: 10 }).entries[0]?.parts).toEqual(expected);
    const raw = String(db.prepare("SELECT parts FROM timeline_messages WHERE seq = :seq").get({ seq: committed.seq })?.parts);
    expect(raw).toContain(displayName);
    expect(raw).not.toContain("RAW_INPUT_SENTINEL");
    expect(raw).toContain("business input");
    expect(raw).toContain("business hash");
  });

  it("omits malformed optional names on append and legacy reads instead of rejecting the row", () => {
    for (const displayName of [null, 17, {}, "", " \t\n", "x".repeat(241), "🛠".repeat(121)]) {
      const parts = [
        { type: "tool-call", toolCallId: "c1", toolName: "opaque_route", displayName, input: { secret: "RAW_INPUT_SENTINEL" } },
        { type: "tool-result", toolCallId: "c1", toolName: "opaque_route", displayName, output: { type: "text", value: "done" } },
      ];
      const expected = [
        { type: "tool-call", toolCallId: "c1", toolName: "opaque_route" },
        { type: "tool-result", toolCallId: "c1", toolName: "opaque_route", output: { type: "text", value: "done" } },
      ];
      const committed = repo.append({ characterId: "taki", role: "assistant", content: "canonical projection", parts: parts as TimelinePart[] });
      expect(committed.parts).toEqual(expected);
      const raw = String(db.prepare("SELECT parts FROM timeline_messages WHERE seq = :seq").get({ seq: committed.seq })?.parts);
      expect(raw).not.toContain("displayName");
      expect(raw).not.toContain("RAW_INPUT_SENTINEL");

      db.prepare("UPDATE timeline_messages SET parts = :parts WHERE seq = :seq")
        .run({ seq: committed.seq, parts: JSON.stringify(parts) });
      expect(repo.rangeAscending("taki", committed.seq - 1, committed.seq)[0]?.parts).toEqual(expected);
    }
  });
});

describe("timeline source preservation", () => {
  it("keeps absent source context as SQL NULL and refuses malformed source evidence before a batch writes", () => {
    const legacy = repo.append({ characterId: "taki", role: "user", content: "Original self-report." });
    expect("sourceContext" in legacy).toBe(false);
    expect(db.prepare("SELECT source_context_json AS source FROM timeline_messages WHERE seq=:seq").get({ seq: legacy.seq })?.source).toBeNull();
    const malformed = { characterId: "taki", role: "assistant" as const, content: "Bad context", sourceContext: { materials: [{ label: "" }] } };
    expect(() => repo.appendBatch([{ characterId: "taki", role: "assistant", content: "Must roll back" }, malformed])).toThrow();
    expect(repo.latestAscending("taki", 10)).toEqual([legacy]);
  });

  it("does not silently discard corrupt stored source context", () => {
    db.prepare(`INSERT INTO timeline_messages(id,character_id,role,content,source_context_json,created_at)
      VALUES(:id,'taki','assistant','Original text','{"materials":[{"speaker":42}]}','2026-10-22T00:00:00.000Z')`)
      .run({ id: "550e8400-e29b-41d4-a716-446655440000" });
    expect(() => repo.latestAscending("taki", 10)).toThrow("corrupt source context JSON");
  });

  it("retains source context and exact tool material status without raw call inputs", () => {
    const sourceContext = { generatedBy: { runId: "generation", attemptId: "attempt" },
      materials: [{ label: "Interview", reference: "document:interview", speaker: "Guest" }] };
    const sourceMaterials = [{ key: "interview", source: sourceContext.materials[0] }];
    const output = { type: "json", value: { ok: false, reason: "unavailable" } };
    const parts: TimelinePart[] = [
      { type: "tool-call", toolCallId: "read", toolName: "read_file", input: { secret: "DO_NOT_RETAIN" } },
      { type: "tool-result", toolCallId: "read", toolName: "read_file", output, sourceMaterials },
    ];
    const input = { characterId: "taki", role: "assistant" as const, content: "The guest's story.\n", sourceContext, parts };
    const row = repo.append(input);
    const expected = { ...input, parts: [{ type: "tool-call", toolCallId: "read", toolName: "read_file" }, parts[1]] };
    expect(row).toMatchObject(expected);
    for (const entry of [repo.latestAscending("taki", 10)[0], repo.rangeAscending("taki", 0, row.seq)[0],
      repo.pageBefore({ characterId: "taki", limit: 10 }).entries[0]]) expect(entry).toMatchObject(expected);
    expect(JSON.stringify(row)).not.toContain("DO_NOT_RETAIN");
    sourceContext.materials[0]!.speaker = "Changed outside storage";
    expect(repo.latestAscending("taki", 10)[0]?.sourceContext?.materials?.[0]?.speaker).toBe("Guest");
    expect(() => db.prepare("UPDATE timeline_messages SET source_context_json='{}' WHERE seq=:seq").run({ seq: row.seq }))
      .toThrow("timeline source context is immutable");
  });
});

describe("createTimelineRepo.deleteEntry", () => {
  it("removes exactly the addressed row; later reads exclude it and other rows survive", () => {
    repo.append({ characterId: "taki", role: "user", content: "keep-1" });
    const doomed = repo.append({ characterId: "taki", role: "user", content: "retract-me" });
    repo.append({ characterId: "taki", role: "user", content: "keep-2" });

    repo.deleteEntry("taki", doomed.seq);

    expect(repo.latestAscending("taki", 10).map((e) => e.content)).toEqual(["keep-1", "keep-2"]);
  });

  it("is a no-op for an unknown seq and for another character's row (single-writer, scoped delete)", () => {
    const taki = repo.append({ characterId: "taki", role: "user", content: "mine" });
    expect(() => repo.deleteEntry("taki", 999)).not.toThrow();
    repo.deleteEntry("yui", taki.seq); // wrong character — must not touch taki's row
    expect(repo.latestAscending("taki", 10).map((e) => e.content)).toEqual(["mine"]);
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
      createTimelineRepo(first).append({ characterId: "taki", role: "assistant", content: "[tool-call: captured_route]",
        parts: [{ type: "tool-call", toolCallId: "captured-call", toolName: "captured_route", displayName: "Retired server · tool" }] });
      first.close(); // releases the OS file handle

      const second = openDatabase({ path: file, migrations: MIGRATIONS });
      const rows = createTimelineRepo(second).latestAscending("taki", 10);
      expect(rows[0]?.content).toBe("before restart");
      expect(rows[1]?.parts).toEqual([{
        type: "tool-call", toolCallId: "captured-call", toolName: "captured_route", displayName: "Retired server · tool",
      }]);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

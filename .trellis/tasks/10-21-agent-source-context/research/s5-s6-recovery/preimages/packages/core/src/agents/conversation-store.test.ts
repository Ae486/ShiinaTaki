import { afterEach, describe, expect, it } from "vitest";
import type { TimelineEntry } from "@taki/shared";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { estimateMessageTokens } from "../memory/token-estimator.ts";
import { createConversationStore, REPLAY_WINDOW, type SourceBackstopHit, type WallHit } from "./conversation-store.ts";

const dbs: Database[] = [];

afterEach(() => {
  for (const db of dbs) db.close();
  dbs.length = 0;
});

function makeStore(
  onAppend?: (entry: TimelineEntry) => void,
  onRemove?: (ref: { characterId: string; seq: number }) => void,
) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  return createConversationStore({ repo: createTimelineRepo(db), onAppend, onRemove });
}

// A store with the batch-6 token-window dep injected (production wires calibrator.effectiveWindow × historyRatio).
function makeWindowedStore(budget: number) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  return createConversationStore({ repo: createTimelineRepo(db), window: { budget: () => budget } });
}

// Each "mN" user row costs MESSAGE_OVERHEAD(4) + 1 estimator tokens (content stays under 4 ASCII chars).
const ROW_COST = 5;

function seedUsers(store: ReturnType<typeof makeStore>, n: number): void {
  for (let i = 0; i < n; i += 1) store.appendUser("taki", `m${i + 1}`);
}

describe("createConversationStore", () => {
  it("replays appended turns as ascending ModelMessages", () => {
    const store = makeStore();
    store.appendUser("taki", "hi");
    store.appendAssistant("taki", "hello");
    store.appendUser("taki", "how are you");

    expect(store.history("taki")).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "how are you" },
    ]);
  });

  it("keeps each character's replay separate", () => {
    const store = makeStore();
    store.appendUser("taki", "for taki");
    store.appendUser("yui", "for yui");

    expect(store.history("taki")).toEqual([{ role: "user", content: "for taki" }]);
    expect(store.history("yui")).toEqual([{ role: "user", content: "for yui" }]);
  });

  it("fires onAppend once per append with the committed entry", () => {
    const emitted: TimelineEntry[] = [];
    const store = makeStore((entry) => emitted.push(entry));

    store.appendUser("taki", "hi");
    store.appendAssistant("taki", "hello");

    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toMatchObject({ seq: 1, characterId: "taki", role: "user", content: "hi" });
    expect(emitted[1]).toMatchObject({ seq: 2, characterId: "taki", role: "assistant", content: "hello" });
    expect(emitted[0]?.id).not.toBe(emitted[1]?.id);
  });

  it("does not require an onAppend sink", () => {
    const store = makeStore();
    expect(() => store.appendUser("taki", "hi")).not.toThrow();
    expect(store.history("taki")).toHaveLength(1);
  });

  it("appendUser returns the committed entry with its assigned seq (cancel-retract addressing)", () => {
    const store = makeStore();
    const first = store.appendUser("taki", "hi");
    const second = store.appendUser("taki", "again");
    expect(first).toMatchObject({ seq: 1, characterId: "taki", role: "user", content: "hi" });
    expect(second.seq).toBe(2);
  });

  it("removeEntry deletes the row and fires onRemove with its ref (mirrors onAppend)", () => {
    const removed: { characterId: string; seq: number }[] = [];
    const store = makeStore(undefined, (ref) => removed.push(ref));
    const entry = store.appendUser("taki", "retract me");
    store.appendAssistant("taki", "still here");

    store.removeEntry("taki", entry.seq);

    expect(removed).toEqual([{ characterId: "taki", seq: entry.seq }]);
    expect(store.history("taki")).toEqual([{ role: "assistant", content: "still here" }]);
  });

  it("removeEntry without an onRemove sink still deletes the row", () => {
    const store = makeStore();
    const entry = store.appendUser("taki", "gone");
    expect(() => store.removeEntry("taki", entry.seq)).not.toThrow();
    expect(store.history("taki")).toEqual([]);
  });

  it("appendTurn persists tool-calls + tool-results and history replays the full multi-part shape (D1 #1)", () => {
    const emitted: TimelineEntry[] = [];
    const store = makeStore((entry) => emitted.push(entry));
    store.appendUser("taki", "screenshot please");

    store.appendTurn("taki", [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "screenshot", input: {} }] },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "c1", toolName: "screenshot", output: { type: "json", value: { ok: true } } },
        ],
      },
      { role: "assistant", content: "Saved it." },
    ]);

    // Every row fired timeline.appended (UI parity), and the tool row carries its structured parts.
    expect(emitted.map((entry) => entry.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(emitted[2]?.parts?.[0]).toMatchObject({ type: "tool-result", toolCallId: "c1" });
    expect(emitted[1]?.parts?.[0]).toMatchObject({ toolName: "screenshot", displayName: "屏幕截图" });
    expect(emitted[2]?.parts?.[0]).toMatchObject({ toolName: "screenshot", displayName: "屏幕截图" });

    expect(store.history("taki")).toEqual([
      { role: "user", content: "screenshot please" },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "screenshot", input: {} }] },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "c1", toolName: "screenshot", output: { type: "json", value: { ok: true } } },
        ],
      },
      { role: "assistant", content: "Saved it." },
    ]);
  });

  it("keeps raw tool arguments out of committed rows, SQLite, and reconstructed history", () => {
    const sentinel = "SENTINEL_SQLITE_TOOL_SECRET_4c27";
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    dbs.push(db);
    const emitted: TimelineEntry[] = [];
    const store = createConversationStore({ repo: createTimelineRepo(db), onAppend: (entry) => emitted.push(entry) });

    store.appendTurn("taki", [{
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "secret-call", toolName: "exec", input: { command: sentinel } }],
    }]);

    const persisted = db.prepare("SELECT parts FROM timeline_messages WHERE character_id = :characterId")
      .get({ characterId: "taki" });
    expect(JSON.stringify(emitted)).not.toContain(sentinel);
    expect(String(persisted?.parts)).not.toContain(sentinel);
    expect(JSON.stringify(store.history("taki"))).not.toContain(sentinel);
    expect(store.history("taki")).toEqual([{
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "secret-call", toolName: "exec", input: {} }],
    }]);
  });

  it("captures the presentation input once before append observers can replace its names", () => {
    const names = { opaque_route: "Original server · tool" };
    const emitted: TimelineEntry[] = [];
    const store = makeStore((entry) => {
      emitted.push(entry);
      names.opaque_route = "Replacement server · tool";
    });
    store.appendTurn("taki", [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "opaque_route", input: {} }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "opaque_route", output: { type: "text", value: "done" } }] },
    ], names);

    expect(emitted.map((entry) => entry.parts?.[0])).toEqual([
      { type: "tool-call", toolCallId: "c1", toolName: "opaque_route", displayName: "Original server · tool" },
      { type: "tool-result", toolCallId: "c1", toolName: "opaque_route", displayName: "Original server · tool",
        output: { type: "text", value: "done" } },
    ]);
    expect(JSON.stringify(store.history("taki"))).not.toContain("Original server");
    expect(JSON.stringify(store.history("taki"))).not.toContain("Replacement server");
  });

  it("drops leading orphan tool rows from history (window cut must not start replay with a tool message)", () => {
    const store = makeStore();
    // Simulates the replay window slicing mid-turn: the tool row's assistant tool-call fell outside the window.
    store.appendTurn("taki", [
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "c0", toolName: "exec", output: { type: "text", value: "x" } }],
      },
    ]);
    store.appendUser("taki", "next");

    expect(store.history("taki")).toEqual([{ role: "user", content: "next" }]);
  });

  it("appendUser without images stays a legacy row (byte-identical to today)", () => {
    const emitted: TimelineEntry[] = [];
    const store = makeStore((entry) => emitted.push(entry));
    store.appendUser("taki", "hi");
    expect(emitted[0]?.parts).toBeUndefined();
    expect(store.history("taki")).toEqual([{ role: "user", content: "hi" }]);
  });

  it("appendUser with images persists image parts, but history replays only the TEXT projection (#17)", () => {
    const emitted: TimelineEntry[] = [];
    const store = makeStore((entry) => emitted.push(entry));
    store.appendUser("taki", "look", [{ mediaType: "image/png", ref: "attachments/deadbeef.png" }]);

    // The persisted row carries the image part (for the chat window to render) ...
    expect(emitted[0]?.parts).toEqual([
      { type: "text", text: "look" },
      { type: "image", mediaType: "image/png", ref: "attachments/deadbeef.png" },
    ]);
    // ... but the model replay is text only — no ref, no bytes (decision 6).
    expect(store.history("taki")).toEqual([{ role: "user", content: "look" }]);
    expect(JSON.stringify(store.history("taki"))).not.toContain("attachments/deadbeef.png");
  });
});

describe("token-windowed history (batch 6 — R1)", () => {
  it("windows history by the injected token budget, newest kept", () => {
    const store = makeWindowedStore(ROW_COST * 4);
    seedUsers(store, 30);

    expect(store.history("taki")).toEqual([
      { role: "user", content: "m27" },
      { role: "user", content: "m28" },
      { role: "user", content: "m29" },
      { role: "user", content: "m30" },
    ]);
  });

  it("windowStart is the seq of the FIRST replayed message (the flush reads this exact boundary)", () => {
    const store = makeWindowedStore(ROW_COST * 4);
    seedUsers(store, 30);

    expect(store.windowStart("taki")).toBe(27);
    expect(store.history("taki")[0]).toEqual({ role: "user", content: "m27" });
  });

  it("does not silently truncate long measured history at the legacy 200-row boundary", () => {
    const store = makeWindowedStore(1_000_000_000);
    seedUsers(store, REPLAY_WINDOW + 5);

    const history = store.history("taki");
    expect(history).toHaveLength(REPLAY_WINDOW + 5);
    expect(history[0]).toEqual({ role: "user", content: "m1" });
    expect(store.windowStart("taki")).toBe(1);
  });

  it("keeps a single oversized newest message rather than replaying nothing", () => {
    const store = makeWindowedStore(3);
    seedUsers(store, 5);

    expect(store.history("taki")).toEqual([{ role: "user", content: "m5" }]);
    expect(store.windowStart("taki")).toBe(5);
  });

  it("drops a leading tool row stranded by the token cut (invalid replay input) and moves the boundary past it", () => {
    // Budget 16 admits the tool row (11) + the newest user row (5) but NOT the assistant row carrying the call.
    const store = makeWindowedStore(16);
    store.appendUser("taki", "aaaa".repeat(30)); // seq 1, cost 34 — far outside the budget
    store.appendTurn("taki", [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "exec", input: {} }] }, // seq 2, cost 5
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "c1", toolName: "exec", output: { type: "text", value: "x" } }],
      }, // seq 3, cost 11 — kept by the cut, then dropped as a leading orphan
    ]);
    store.appendUser("taki", "next"); // seq 4, cost 5

    expect(store.history("taki")).toEqual([{ role: "user", content: "next" }]);
    expect(store.windowStart("taki")).toBe(4);
  });

  it("legacy store (no window dep) exposes the same boundary: first replayed seq", () => {
    const store = makeStore();
    seedUsers(store, 5);
    expect(store.windowStart("taki")).toBe(1);

    const big = makeStore();
    seedUsers(big, REPLAY_WINDOW + 5);
    expect(big.windowStart("taki")).toBe(6);
  });

  it("an empty timeline has windowStart 1 (nothing exists, nothing has left the window)", () => {
    expect(makeStore().windowStart("taki")).toBe(1);
    expect(makeWindowedStore(100).windowStart("taki")).toBe(1);
  });
});

// A store with the batch-7 summary seam wired over the SAME db (production shape: summary-repo + optional budget).
function makeSummaryStore(opts: { budget?: number; onWallHit?: (hit: WallHit) => void;
  onSourceBackstopHit?: (hit: SourceBackstopHit) => void; source?: { maxRows?: number; pageSize?: number } } = {}) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  const repo = createTimelineRepo(db);
  const summaries = createSummaryRepo(db);
  const store = createConversationStore({
    repo,
    summaries,
    window: opts.budget === undefined ? undefined : { budget: () => opts.budget! },
    onWallHit: opts.onWallHit,
    onSourceBackstopHit: opts.onSourceBackstopHit,
    source: opts.source,
  });
  return { store, summaries, repo };
}

const HEAD_TEXT = "我们之前聊了很多，他答应周五请我吃拉面";
const HEAD_CONTENT = `<conversation-summary>\n${HEAD_TEXT}\n</conversation-summary>`;

describe("summary substitution (batch 7 — R3 head message)", () => {
  it("drops covered rows and prepends the fenced head message as role:user", () => {
    const { store, summaries } = makeSummaryStore();
    seedUsers(store, 10);
    summaries.upsert({ characterId: "taki", throughSeq: 5, text: HEAD_TEXT });

    expect(store.history("taki")).toEqual([
      { role: "user", content: HEAD_CONTENT },
      { role: "user", content: "m6" },
      { role: "user", content: "m7" },
      { role: "user", content: "m8" },
      { role: "user", content: "m9" },
      { role: "user", content: "m10" },
    ]);
  });

  it("with the seam wired but NO summary row the view is byte-identical to the legacy store", () => {
    const { store } = makeSummaryStore();
    const legacy = makeStore();
    seedUsers(store, 5);
    seedUsers(legacy, 5);

    expect(JSON.stringify(store.history("taki"))).toBe(JSON.stringify(legacy.history("taki")));
    expect(store.windowStart("taki")).toBe(legacy.windowStart("taki"));
  });

  it("renders NO head when the loaded window no longer reaches covered territory (stale summary)", () => {
    const { store, summaries } = makeSummaryStore();
    seedUsers(store, REPLAY_WINDOW + 15); // backstop fetch = seqs 16..215 — nothing <= 5 left to substitute
    summaries.upsert({ characterId: "taki", throughSeq: 5, text: HEAD_TEXT });

    const history = store.history("taki");
    expect(history).toHaveLength(REPLAY_WINDOW);
    expect(history[0]).toEqual({ role: "user", content: "m16" });
    expect(store.windowStart("taki")).toBe(16);
  });

  it("reaches an older summary through more than 200 unretired rows under token-first selection", () => {
    const { store, summaries } = makeSummaryStore({ budget: 1_000_000_000 });
    seedUsers(store, REPLAY_WINDOW + 15);
    summaries.upsert({ characterId: "taki", throughSeq: 5, text: HEAD_TEXT });

    const projection = store.project("taki");
    expect(projection.messages[0]).toEqual({ role: "user", content: HEAD_CONTENT });
    expect(projection.messages).toHaveLength(1 + REPLAY_WINDOW + 10);
    expect(projection.windowStartSeq).toBe(6);
    expect(projection.measurement).toMatchObject({ sourceRows: REPLAY_WINDOW + 10, sourceBackstopHit: false });
  });

  it("emits a distinct source-backstop fact instead of masquerading as token exhaustion", () => {
    const hits: SourceBackstopHit[] = [];
    const { store } = makeSummaryStore({ budget: 1_000_000, source: { maxRows: 3, pageSize: 2 },
      onSourceBackstopHit: (hit) => hits.push(hit) });
    seedUsers(store, 8);

    const projection = store.project("taki");
    expect(projection.messages.map((message) => message.content)).toEqual(["m6", "m7", "m8"]);
    expect(projection.measurement).toMatchObject({ sourceBackstopHit: true, tokenBoundaryHit: false });
    store.history("taki");
    expect(hits).toEqual([expect.objectContaining({ characterId: "taki", loadedRows: 3, limit: 3, throughSeq: 0 })]);
  });

  it("when the summary covers every loaded row the view is the head alone and windowStart is through+1", () => {
    const { store, summaries } = makeSummaryStore();
    seedUsers(store, 10);
    summaries.upsert({ characterId: "taki", throughSeq: 10, text: HEAD_TEXT });

    expect(store.history("taki")).toEqual([{ role: "user", content: HEAD_CONTENT }]);
    expect(store.windowStart("taki")).toBe(11);
  });

  it("windowStart is the first LIVE seq — rows the summary retired have left the flush window too", () => {
    const { store, summaries } = makeSummaryStore();
    seedUsers(store, 10);
    summaries.upsert({ characterId: "taki", throughSeq: 7, text: HEAD_TEXT });

    expect(store.windowStart("taki")).toBe(8);
  });

  it("a substitution stranding a leading tool row still yields valid replay input (orphan drop)", () => {
    const { store, summaries } = makeSummaryStore();
    store.appendUser("taki", "screenshot please"); // seq 1
    store.appendTurn("taki", [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "exec", input: {} }] }, // seq 2
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "c1", toolName: "exec", output: { type: "text", value: "x" } }],
      }, // seq 3
    ]);
    store.appendUser("taki", "next"); // seq 4
    summaries.upsert({ characterId: "taki", throughSeq: 2, text: HEAD_TEXT }); // through lands mid-turn

    expect(store.history("taki")).toEqual([
      { role: "user", content: HEAD_CONTENT },
      { role: "user", content: "next" },
    ]);
  });

  it("estimatedTokens covers head + kept rows and stays 0 in unmeasured mode", () => {
    const { store, summaries } = makeSummaryStore({ budget: 1_000_000 });
    seedUsers(store, 6);
    summaries.upsert({ characterId: "taki", throughSeq: 2, text: HEAD_TEXT });
    const headCost = estimateMessageTokens({ role: "user", content: HEAD_CONTENT });

    expect(store.estimatedTokens("taki")).toBe(headCost + 4 * ROW_COST);

    const unmeasured = makeSummaryStore();
    seedUsers(unmeasured.store, 6);
    expect(unmeasured.store.estimatedTokens("taki")).toBe(0);
  });

  it("exposes messages, windowStart and token pressure from one immutable projection", () => {
    const { store, summaries } = makeSummaryStore({ budget: ROW_COST * 4 + 100 });
    seedUsers(store, 8);
    summaries.upsert({ characterId: "taki", throughSeq: 4, text: HEAD_TEXT });

    const projection = store.project("taki");
    expect(JSON.stringify(projection.messages)).toBe(JSON.stringify(store.history("taki")));
    expect(projection.windowStartSeq).toBe(store.windowStart("taki"));
    expect(projection.measurement.historyTokens).toBe(store.estimatedTokens("taki"));
    expect(projection.measurement.summaryTokens).toBeGreaterThan(0);
  });

  it("projects CJK, image references and dense balanced tool pairs without orphaned replay", () => {
    const { store, repo } = makeSummaryStore({ budget: 20_000 });
    store.appendUser("taki", "看这张图里的拉面", [{ mediaType: "image/png", ref: `attachments/${"a".repeat(64)}.png` }]);
    for (let index = 0; index < 6; index += 1) store.appendTurn("taki", [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: `c${index}`, toolName: "inspect", input: {} }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: `c${index}`, toolName: "inspect",
        output: { type: "json", value: { capturedAt: `2026-08-29T00:0${index}:00.000Z`, detail: "面".repeat(100) } } }] },
    ]);

    const projection = store.project("taki");
    const serialized = JSON.stringify(projection.messages);
    expect(projection.messages[0]).toEqual({ role: "user", content: "看这张图里的拉面" });
    expect(repo.latestAscending("taki", 20)[0]?.parts).toContainEqual(
      expect.objectContaining({ type: "image", ref: `attachments/${"a".repeat(64)}.png` }),
    );
    for (let index = 0; index < 6; index += 1) {
      expect(serialized).toContain(`"toolCallId":"c${index}"`);
    }
    // Persisted image references stay text-authoritative on replay; the source still carries the ref for UI display.
    expect(projection.measurement.historyTokens).toBeGreaterThan(600);
  });
});

describe("replay-view pipeline (batch 7 — idempotence + stage order, ADR 0008)", () => {
  it("double render is byte-identical and the stored rows are never mutated", () => {
    const { store, summaries, repo } = makeSummaryStore({ budget: 60 });
    store.appendUser("taki", "old stuff"); // seq 1 — retired
    store.appendTurn("taki", [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "exec", input: {} }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "exec",
            output: { type: "json", value: { ok: true, out: "z".repeat(400) } },
          },
        ],
      },
    ]);
    seedUsers(store, 3);
    summaries.upsert({ characterId: "taki", throughSeq: 1, text: HEAD_TEXT });
    const rawBefore = JSON.stringify(repo.latestAscending("taki", REPLAY_WINDOW));

    const first = JSON.stringify(store.history("taki"));
    const second = JSON.stringify(store.history("taki"));

    expect(second).toBe(first);
    expect(JSON.stringify(repo.latestAscending("taki", REPLAY_WINDOW))).toBe(rawBefore);
  });

  it("composes substitution -> folds -> cut: head present, oversized fact result folded, view fits", () => {
    const { store, summaries } = makeSummaryStore({ budget: 120 });
    store.appendUser("taki", "old stuff"); // seq 1 — retired by the summary
    store.appendTurn("taki", [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "exec", input: {} }] }, // seq 2
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "exec",
            output: { type: "json", value: { ok: true, out: "z".repeat(600) } },
          },
        ],
      }, // seq 3
    ]);
    seedUsers(store, 2); // seqs 4-5
    summaries.upsert({ characterId: "taki", throughSeq: 1, text: HEAD_TEXT });

    const history = store.history("taki");
    const flat = JSON.stringify(history);
    expect(history[0]).toEqual({ role: "user", content: HEAD_CONTENT });
    expect(flat).toContain("[exec] result folded —");
    expect(flat).not.toContain("zzzz");
    // The fold sufficed — nothing was cut, so the view still starts right after the summary boundary.
    expect(store.windowStart("taki")).toBe(2);
  });
});

describe("wall-hit warn (batch 7 — R5 hard-truncation visibility)", () => {
  it("fires (counts only) when the cut drops rows the summary has not retired, deduped per boundary", () => {
    const hits: WallHit[] = [];
    const { store, summaries } = makeSummaryStore({ budget: ROW_COST * 2, onWallHit: (hit) => hits.push(hit) });
    seedUsers(store, 10);
    summaries.upsert({ characterId: "taki", throughSeq: 4, text: HEAD_TEXT });

    store.history("taki");
    store.history("taki"); // same pressure, same boundary — the warn must not repeat per render

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ characterId: "taki", throughSeq: 4 });
    expect(hits[0]!.windowStartSeq).toBeGreaterThan(5); // the cut outran the summary boundary
    expect(hits[0]!.dropped).toBeGreaterThan(0);

    seedUsers(store, 1); // the boundary advances -> the sustained overrun warns once more
    store.history("taki");
    expect(hits).toHaveLength(2);
  });

  it("does not fire while the summary keeps the view under budget (no cut of live rows)", () => {
    const hits: WallHit[] = [];
    const { store, summaries } = makeSummaryStore({ budget: 1_000_000, onWallHit: (hit) => hits.push(hit) });
    seedUsers(store, 10);
    summaries.upsert({ characterId: "taki", throughSeq: 5, text: HEAD_TEXT });

    store.history("taki");
    expect(hits).toEqual([]);
  });
});

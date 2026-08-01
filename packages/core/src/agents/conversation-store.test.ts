import { afterEach, describe, expect, it } from "vitest";
import type { TimelineEntry } from "@taki/shared";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createConversationStore, REPLAY_WINDOW } from "./conversation-store.ts";

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

  it("REPLAY_WINDOW stays the hard backstop when the budget is huge (broken-estimator guard)", () => {
    const store = makeWindowedStore(1_000_000_000);
    seedUsers(store, REPLAY_WINDOW + 5);

    const history = store.history("taki");
    expect(history).toHaveLength(REPLAY_WINDOW);
    expect(history[0]).toEqual({ role: "user", content: "m6" });
    expect(store.windowStart("taki")).toBe(6);
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

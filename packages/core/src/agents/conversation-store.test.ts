import { afterEach, describe, expect, it } from "vitest";
import type { TimelineEntry } from "@taki/shared";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createConversationStore } from "./conversation-store.ts";

const dbs: Database[] = [];

afterEach(() => {
  for (const db of dbs) db.close();
  dbs.length = 0;
});

function makeStore(onAppend?: (entry: TimelineEntry) => void) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  return createConversationStore({ repo: createTimelineRepo(db), onAppend });
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

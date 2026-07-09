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
});

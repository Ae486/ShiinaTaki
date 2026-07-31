import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryEventsRepo, type MemoryEventsRepo } from "./memory-events-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";

let db: Database;
let repo: MemoryEventsRepo;

beforeEach(() => {
  db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  repo = createMemoryEventsRepo(db);
});

afterEach(() => {
  db.close();
});

describe("createMemoryEventsRepo (T5 events substrate)", () => {
  it("returns nothing for a character with no events", () => {
    expect(repo.listByCharacter({ characterId: "taki", limit: 10 })).toEqual([]);
  });

  it("records an event and reads it back with its ids and turn", () => {
    repo.record({ kind: "reinforce", characterId: "taki", turnSeq: 42, entryId: "0007-ramen" });

    const [event] = repo.listByCharacter({ characterId: "taki", limit: 10 });
    expect(event?.kind).toBe("reinforce");
    expect(event?.characterId).toBe("taki");
    expect(event?.turnSeq).toBe(42);
    expect(event?.entryId).toBe("0007-ramen");
    expect(event?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("round-trips an absent turnSeq/entryId as NULL (a skip has no entry to point at)", () => {
    repo.record({ kind: "skip", characterId: "taki" });

    const [event] = repo.listByCharacter({ characterId: "taki", limit: 10 });
    expect(event?.kind).toBe("skip");
    expect(event?.turnSeq).toBeNull();
    expect(event?.entryId).toBeNull();
  });

  it("records a tidy pass with its edit count and no turn (batch 4b — a pass belongs to no single turn)", () => {
    repo.record({ kind: "tidy", characterId: "taki", count: 3 });

    const [event] = repo.listByCharacter({ characterId: "taki", limit: 10 });
    expect(event?.kind).toBe("tidy");
    expect(event?.count).toBe(3);
    expect(event?.turnSeq).toBeNull();
    expect(event?.entryId).toBeNull();
  });

  it("lists newest first and honours the limit", () => {
    for (const turnSeq of [1, 2, 3]) repo.record({ kind: "skip", characterId: "taki", turnSeq });

    expect(repo.listByCharacter({ characterId: "taki", limit: 10 }).map((e) => e.turnSeq)).toEqual([3, 2, 1]);
    expect(repo.listByCharacter({ characterId: "taki", limit: 2 }).map((e) => e.turnSeq)).toEqual([3, 2]);
  });

  it("keeps each character's events isolated", () => {
    repo.record({ kind: "skip", characterId: "taki", turnSeq: 1 });
    repo.record({ kind: "reinforce", characterId: "yui", turnSeq: 2, entryId: "0001-x" });

    expect(repo.listByCharacter({ characterId: "taki", limit: 10 }).map((e) => e.kind)).toEqual(["skip"]);
    expect(repo.listByCharacter({ characterId: "yui", limit: 10 }).map((e) => e.kind)).toEqual(["reinforce"]);
  });
});

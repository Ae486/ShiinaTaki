import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { createPrivacyPauseRepo, type PrivacyPauseRepo } from "./privacy-pause-repo.ts";
import { openDatabase, type Database } from "./sqlite.ts";

let db: Database;
let repo: PrivacyPauseRepo;

beforeEach(() => {
  db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  repo = createPrivacyPauseRepo(db);
});

afterEach(() => db.close());

describe("createPrivacyPauseRepo (T3b)", () => {
  it("loads nothing for a core that has never been paused", () => {
    expect(repo.load()).toBeUndefined();
  });

  it("round-trips both pause shapes, booleans included", () => {
    repo.save({ paused: true, until: null });
    expect(repo.load()).toEqual({ paused: true, until: null });

    repo.save({ paused: true, until: 1_800_000_000_000 });
    expect(repo.load()).toEqual({ paused: true, until: 1_800_000_000_000 });

    repo.save({ paused: false, until: null });
    expect(repo.load()).toEqual({ paused: false, until: null });
  });

  it("keeps exactly one row — the pause is global, so a save is always the whole state", () => {
    repo.save({ paused: true, until: null });
    repo.save({ paused: true, until: 1_800_000_000_000 });
    const rows = db.prepare("SELECT count(*) AS count FROM privacy_pause_state").get();
    expect(rows?.count).toBe(1);
  });
});

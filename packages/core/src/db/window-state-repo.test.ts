import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { createWindowStateRepo } from "./window-state-repo.ts";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function repo() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  return createWindowStateRepo(db);
}

describe("createWindowStateRepo", () => {
  it("returns null for a never-calibrated slot", () => {
    expect(repo().get("main")).toBeNull();
  });

  it("round-trips a calibration and upserts on the second write", () => {
    const r = repo();
    r.set("main", { effectiveWindow: 29491, factor: 1.25 });
    expect(r.get("main")).toEqual({ effectiveWindow: 29491, factor: 1.25 });

    r.set("main", { effectiveWindow: 26542, factor: 0.9 });
    expect(r.get("main")).toEqual({ effectiveWindow: 26542, factor: 0.9 });
  });

  it("keeps slots independent", () => {
    const r = repo();
    r.set("main", { effectiveWindow: 100, factor: 1 });
    expect(r.get("vision")).toBeNull();
  });
});

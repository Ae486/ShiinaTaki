import { describe, expect, it } from "vitest";
import { openDatabase } from "../sqlite.ts";
import { MIGRATIONS } from "./index-list.ts";

describe("migration 022", () => {
  it("creates inert setup state without changing authority selection", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    expect(db.prepare("SELECT phase,revision FROM hindsight_connection_state WHERE singleton=1").get()).toEqual({ phase: "unconfigured", revision: 0 });
    expect(db.prepare("SELECT mode FROM memory_authority_selection WHERE singleton=1").get()).toEqual({ mode: "legacy-markdown" });
    db.close();
  });

  it("rejects invalid JSON and has no secret-value columns", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    expect(() => db.exec("UPDATE hindsight_connection_state SET latest_error_json='nope' WHERE singleton=1")).toThrow();
    const columns = db.prepare("PRAGMA table_info(hindsight_connection_state)").all().map((row) => row.name);
    expect(columns).not.toContain("api_key");
    expect(columns).not.toContain("secret_value");
    db.close();
  });
});

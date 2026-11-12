import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./index-list.ts";

describe("MIGRATIONS registry", () => {
  it("is contiguous, strictly ascending, and uniquely versioned", () => {
    const versions = MIGRATIONS.map((migration) => migration.version);
    expect(versions).toEqual(Array.from({ length: 55 }, (_, index) => index + 1));
    expect(new Set(versions).size).toBe(versions.length);
    expect(MIGRATIONS.every((migration) => migration.sql.trim().length > 0)).toBe(true);
  });
});

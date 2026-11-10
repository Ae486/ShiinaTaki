import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./index-list.ts";

describe("MIGRATIONS registry", () => {
  it("preserves the ordered T4 lineage and reserved main-59 gap without duplicate versions", () => {
    const versions = MIGRATIONS.map((migration) => migration.version);
    expect(versions).toEqual([...Array.from({ length: 58 }, (_, index) => index + 1), 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72]);
    expect(new Set(versions).size).toBe(versions.length);
    expect(MIGRATIONS.every((migration) => migration.sql.trim().length > 0)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./index-list.ts";
import { T4_HISTORICAL_MIGRATIONS } from "./historical-t4.ts";

describe("MIGRATIONS registry", () => {
  it("keeps the canonical main prefix and higher convergence sequence without duplicate versions", () => {
    const versions = MIGRATIONS.map((migration) => migration.version);
    expect(versions).toEqual([...Array.from({ length: 63 }, (_, index) => index + 1), 73, 74, 75, 76, 77]);
    expect(new Set(versions).size).toBe(versions.length);
    expect(MIGRATIONS.every((migration) => migration.sql.trim().length > 0)).toBe(true);
  });
  it("retains the historical T4 versions and its original 059 gap", () => {
    const versions = T4_HISTORICAL_MIGRATIONS.map((migration) => migration.version);
    expect(versions).toEqual([...Array.from({ length: 58 }, (_, index) => index + 1), 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72]);
    expect(new Set(versions).size).toBe(versions.length);
  });
});

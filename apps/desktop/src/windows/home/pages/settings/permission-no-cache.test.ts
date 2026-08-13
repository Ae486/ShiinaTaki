import { describe, expect, it } from "vitest";
import { canPersist } from "@/lib/cache-persist.js";

describe("permission policy cache boundary", () => {
  it("has no persisted page-cache key for governance state", () => {
    for (const key of ["permission", "permission-level", "permission-cells", "governance-policy"]) {
      expect(canPersist(key)).toBe(false);
    }
  });
});

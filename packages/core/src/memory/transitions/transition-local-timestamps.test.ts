import { describe, expect, it } from "vitest";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createTransitionCandidateFixture } from "../../testing/memory-transition-candidate-fixtures.ts";
import { preserveTransitionLocalTimestamps } from "./transition-local-timestamps.ts";

describe("W3 producer-proven Local timestamps", () => {
  it.each(["consolidation", "native-clock", "native-content", "upsert"])("uses evidence rather than clock ordering for %s", (kind) => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const fixture = createTransitionCandidateFixture(db);
      const before = fixture.proofs.flatMap((entry) => entry.nativePages).flatMap((page) => page.records)
        .find((row) => row.object_id === "native-logical-unit")!;
      const final = structuredClone(before);
      final.payload.consolidated_at = "2026-10-01T00:00:00Z";
      const original = { ...fixture.seed.unit, updatedAt: "2040-01-01T00:00:00Z", editedAt: "2040-01-01T00:00:00Z" };
      if (kind === "native-clock") { final.payload.updated_at = "2020-01-01T00:00:00Z"; final.payload.edited_at = "2020-01-01T00:00:00Z"; }
      if (kind === "native-content") final.payload.text = "Actual later native edit with an earlier clock";
      const unit = { ...fixture.seed.unit, updatedAt: String(final.payload.updated_at), editedAt: final.payload.edited_at as string | null };
      preserveTransitionLocalTimestamps({ unit, original, before, final, reused: kind !== "upsert" });
      expect(unit.updatedAt).toBe(kind === "consolidation" ? original.updatedAt : final.payload.updated_at);
      expect(unit.editedAt).toBe(kind === "consolidation" ? original.editedAt : final.payload.edited_at);
    } finally { db.close(); }
  });
});

import { describe, expect, it } from "vitest";
import { HINDSIGHT_SECRET_REFS, createHindsightConnectionSecret } from "./hindsight-secret-refs.ts";
import type { SecretCatalogService } from "../../secrets/secret-catalog-service.ts";

function catalog(value: string | null, updatedAt = "2026-08-21T00:00:00.000Z"): SecretCatalogService {
  const presence = { secretRef: HINDSIGHT_SECRET_REFS.connectionApiKey, present: value !== null, provenance: value === null ? null : { source: "catalog" as const, keyVersion: 1, updatedAt }, health: "ok" as const };
  return { health: () => "ok", resolve: () => value, presence: () => presence } as unknown as SecretCatalogService;
}

describe("Hindsight secret refs", () => {
  it("pins a fixed collision-free vocabulary", () => {
    const refs = Object.values(HINDSIGHT_SECRET_REFS);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs.every((ref) => ref.startsWith("memory.hindsight."))).toBe(true);
  });

  it("resolves only the connection key and fingerprints safe provenance", () => {
    const first = createHindsightConnectionSecret(catalog("sentinel", "2026-08-21T00:00:00.000Z"));
    const rotated = createHindsightConnectionSecret(catalog("sentinel-2", "2026-08-21T01:00:00.000Z"));
    expect(first.resolve()).toBe("sentinel");
    expect(first.marker()).not.toBe(rotated.marker());
    expect(first.marker()).not.toContain("sentinel");
  });
});

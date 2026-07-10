import { describe, expect, it } from "vitest";
import {
  MemoryLayerDefinitionSchema,
  V1_MEMORY_LAYERS,
  WRITABLE_LAYER_IDS,
  getLayer,
  isWritableLayer,
} from "./layer-registry.ts";

describe("layer registry (T1)", () => {
  it("parses all 5 v1 layers with the expected policy fields", () => {
    expect(V1_MEMORY_LAYERS.map((l) => l.id)).toEqual([
      "profile",
      "activity",
      "relationship",
      "episodes",
      "intentions",
    ]);
    // The never-truncate guarantee is a data field, not a special case.
    expect(getLayer("relationship")?.truncatable).toBe(false);
    expect(getLayer("profile")?.pinnedImportanceThreshold).toBe(9);
    expect(getLayer("activity")?.retention).toEqual({ rollingDays: 30 });
    expect(getLayer("intentions")?.retention).toBe("expiring");
  });

  it("derives the writable-layer set from writePolicy data", () => {
    // explicit-tool | agent are writable; machine (activity) + consolidation are not.
    expect([...WRITABLE_LAYER_IDS].sort()).toEqual(["episodes", "intentions", "profile", "relationship"]);
    expect(isWritableLayer("relationship")).toBe(true);
    expect(isWritableLayer("activity")).toBe(false);
    expect(isWritableLayer("nonexistent")).toBe(false);
  });

  it("rejects a bad ownership", () => {
    const bad = { ...V1_MEMORY_LAYERS[0], ownership: "everyone" };
    expect(MemoryLayerDefinitionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a malformed retention", () => {
    const bad = { ...V1_MEMORY_LAYERS[0], retention: { rollingDays: -1 } };
    expect(MemoryLayerDefinitionSchema.safeParse(bad).success).toBe(false);
    const bad2 = { ...V1_MEMORY_LAYERS[0], retention: "forever" };
    expect(MemoryLayerDefinitionSchema.safeParse(bad2).success).toBe(false);
  });

  it("rejects unknown extra fields (strict schema keeps the taxonomy honest)", () => {
    const bad = { ...V1_MEMORY_LAYERS[0], surprise: true };
    expect(MemoryLayerDefinitionSchema.safeParse(bad).success).toBe(false);
  });
});

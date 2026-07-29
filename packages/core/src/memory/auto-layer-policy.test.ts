import { describe, expect, it } from "vitest";
import {
  AUTO_LAYER_CHOICES,
  autoImportanceCeiling,
  autoLayerGuidance,
  clampAutoImportance,
  resolveAutoLayer,
} from "./auto-layer-policy.ts";
import { getLayer, isWritableLayer, V1_MEMORY_LAYERS } from "./layer-registry.ts";
import { selectPinned } from "./pinned-block.ts";
import type { MemoryEntryRow } from "../db/memory-repo.ts";

describe("AUTO_LAYER_CHOICES (T5 Q11-1 choice set)", () => {
  it("excludes every pinned-policy layer — relationship above all", () => {
    // A pinned-policy layer is always visible at ANY importance, so the clamp below could not take it back.
    expect(AUTO_LAYER_CHOICES).not.toContain("relationship");
    for (const layer of V1_MEMORY_LAYERS) {
      if (layer.recallPolicy === "pinned") expect(AUTO_LAYER_CHOICES).not.toContain(layer.id);
    }
  });

  it("excludes non-writable layers and keeps every writable non-pinned one", () => {
    expect(AUTO_LAYER_CHOICES).not.toContain("activity"); // machine-written
    const expected = V1_MEMORY_LAYERS.filter((l) => isWritableLayer(l.id) && l.recallPolicy !== "pinned").map(
      (l) => l.id,
    );
    expect([...AUTO_LAYER_CHOICES]).toEqual(expected);
  });

  it("names every choice in the prompt guidance so the set and the wording cannot drift apart", () => {
    const guidance = autoLayerGuidance();
    for (const id of AUTO_LAYER_CHOICES) expect(guidance).toContain(`'${id}'`);
  });
});

describe("resolveAutoLayer", () => {
  it("passes an auto-writable layer through unchanged", () => {
    for (const id of AUTO_LAYER_CHOICES) expect(resolveAutoLayer(id)).toBe(id);
  });

  it("falls back to episodes for an omitted, unknown, or out-of-set layer", () => {
    expect(resolveAutoLayer(undefined)).toBe("episodes");
    expect(resolveAutoLayer("not-a-layer")).toBe("episodes");
    expect(resolveAutoLayer("relationship")).toBe("episodes"); // real layer, but not the auto path's to choose
    expect(resolveAutoLayer("activity")).toBe("episodes");
  });
});

describe("autoImportanceCeiling (the ceiling is DERIVED, not coincidental)", () => {
  it("sits strictly below a threshold that falls inside the auto band", () => {
    // No layer carries such a threshold TODAY (profile's 9 is above the band top, so the derivation is currently a
    // no-op). Pinning the function directly is what makes the derivation itself provable — without this, a registry
    // edit that drops a threshold into the band would go unnoticed until an auto write pinned itself.
    expect(autoImportanceCeiling(5)).toBe(4);
    expect(autoImportanceCeiling(4)).toBe(3);
  });

  it("falls back to the band top when the layer pins nothing or its threshold is above the band", () => {
    expect(autoImportanceCeiling(undefined)).toBe(7);
    expect(autoImportanceCeiling(9)).toBe(7);
  });
});

describe("clampAutoImportance (the ceiling is DERIVED from the registry)", () => {
  it("keeps a maximal proposal strictly below the layer's pin threshold wherever one exists", () => {
    for (const id of AUTO_LAYER_CHOICES) {
      const threshold = getLayer(id)?.pinnedImportanceThreshold;
      if (threshold === undefined) continue;
      expect(clampAutoImportance(id, 10)).toBeLessThanOrEqual(threshold - 1);
    }
    // profile is the layer that carries a threshold today; assert it explicitly so a registry edit is visible here.
    expect(getLayer("profile")?.pinnedImportanceThreshold).toBe(9);
    expect(clampAutoImportance("profile", 10)).toBeLessThan(9);
  });

  it("clamps a threshold-free layer into the 3-7 auto band", () => {
    expect(getLayer("episodes")?.pinnedImportanceThreshold).toBeUndefined();
    expect(clampAutoImportance("episodes", 10)).toBe(7);
    expect(clampAutoImportance("episodes", 0)).toBe(3);
    expect(clampAutoImportance("episodes", 5)).toBe(5);
  });

  it("defaults an absent importance to mid-band and rounds a fractional one", () => {
    expect(clampAutoImportance("episodes", undefined)).toBe(5);
    expect(clampAutoImportance("episodes", 6.4)).toBe(6);
    expect(clampAutoImportance("episodes", 6.5)).toBe(7);
  });

  it("clamps an unknown layer into the band rather than throwing", () => {
    expect(clampAutoImportance("not-a-layer", 10)).toBe(7);
  });

  it("makes an auto-written row unreachable by the pinned block — the property Q11-1 actually buys", () => {
    const rows: MemoryEntryRow[] = AUTO_LAYER_CHOICES.map((layer, i) => ({
      path: `/m/${i}.md`,
      id: `000${i}-auto`,
      layer,
      characterId: "taki",
      importance: clampAutoImportance(layer, 10), // the most an auto write can ever ask for
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: null,
      origin: "self",
      expiresAt: null,
      disclosure: "",
      content: "自动写入的一条",
    }));

    expect(selectPinned(rows, 10_000)).toEqual([]);
  });
});

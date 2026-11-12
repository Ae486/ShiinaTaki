/**
 * INPUT:  a listing JSON shaped like the /lab-characters/ response + a fake resolve fn.
 * OUTPUT: assertions on entry expansion (one per costume, generation by suffix, default flag, settings path), the
 *         CostumeSource resolver (siblings resolve absolute; `..` and absolute refs null) and the pruned-ref count.
 * POS:    unit test for the lab's pure catalog module. No engine, no DOM. Exempt from caps.
 */

import { describe, expect, it } from "vitest";

import { countPrunedRefs, parseCatalog, toCostumeSource } from "./character-catalog.ts";

const LISTING = {
  root: "C:/x/characters",
  characters: [
    {
      id: "taki",
      character: {
        characterId: "taki",
        costumes: ["arbeit", "live_01", "ghost"],
        defaultCostume: "arbeit",
        settingsFilesByCostume: { arbeit: "model.json", live_01: "adv_live2d_taki_005_live_01.model3.json" },
      },
    },
    { id: "broken", character: { nope: true } },
    { id: 42, character: { characterId: "x", costumes: [], settingsFilesByCostume: {} } },
  ],
};

describe("parseCatalog", () => {
  it("expands each costume with a settings path, generation and default flag; skips unshaped manifests", () => {
    const entries = parseCatalog(LISTING);
    expect(entries).toEqual([
      {
        characterId: "taki",
        costume: "arbeit",
        settingsUrl: "/lab-characters/taki/arbeit/model.json",
        generation: "cubism2",
        isDefault: true,
      },
      {
        characterId: "taki",
        costume: "live_01",
        settingsUrl: "/lab-characters/taki/live_01/adv_live2d_taki_005_live_01.model3.json",
        generation: "cubism3",
        isDefault: false,
      },
    ]);
  });

  it("returns an empty catalog for a malformed listing", () => {
    expect(parseCatalog(null)).toEqual([]);
    expect(parseCatalog({ characters: "nope" })).toEqual([]);
  });
});

describe("toCostumeSource", () => {
  const entry = parseCatalog(LISTING)[0]!;
  const source = toCostumeSource(entry, "http://localhost:1420");

  it("makes the settings URL absolute and carries the costume identity", () => {
    expect(source.settingsUrl).toBe("http://localhost:1420/lab-characters/taki/arbeit/model.json");
    expect(source.costumeId).toBe("taki/arbeit");
  });

  it("resolves sibling refs against the settings directory", () => {
    expect(source.resolve("model.moc")).toBe("http://localhost:1420/lab-characters/taki/arbeit/model.moc");
    expect(source.resolve("motions/mtn_idle01_C.mtn")).toBe(
      "http://localhost:1420/lab-characters/taki/arbeit/motions/mtn_idle01_C.mtn",
    );
  });

  it("refuses parent-directory and absolute refs so pruneSettings strips them", () => {
    expect(source.resolve("../_mtn_emp/idle.mtn")).toBeNull();
    expect(source.resolve("/etc/passwd")).toBeNull();
    expect(source.resolve("https://evil.example/x.mtn")).toBeNull();
  });

  // Regression: every imported Cubism 3 manifest has FileReferences.Pose = null and the engine's replaceFiles forwards
  // it to the resolver verbatim — the first C3 load in the lab crashed on `null.includes`.
  it("answers null for a null or empty slot instead of throwing (C3 Pose=null)", () => {
    expect(source.resolve(null as unknown as string)).toBeNull();
    expect(source.resolve(undefined as unknown as string)).toBeNull();
    expect(source.resolve("")).toBeNull();
  });
});

describe("countPrunedRefs", () => {
  it("counts stripped motion and expression entries through pruneSettings", () => {
    const settings = {
      motions: { idle: [{ file: "../_mtn_emp/a.mtn" }, { file: "motions/b.mtn" }] },
      expressions: [{ name: "smile", file: "../shared/smile.exp.json" }, { name: "angry", file: "exp/angry.exp.json" }],
    };
    const resolve = (ref: string) => (ref.includes("..") ? null : `http://x/${ref}`);
    expect(countPrunedRefs(settings, resolve)).toBe(2);
    expect(countPrunedRefs({ motions: { idle: [{ file: "a.mtn" }] } }, resolve)).toBe(0);
  });
});

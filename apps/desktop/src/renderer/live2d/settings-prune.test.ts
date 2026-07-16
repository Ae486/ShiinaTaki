import { describe, expect, it } from "vitest";
import { pruneSettings, type ResolveRef } from "./settings-prune.ts";

// Mirrors lib/character-asset-url's resolve semantics: refs in the set resolve; anything with `..` outside it is null.
function resolveExcept(missing: string[]): ResolveRef {
  return (ref) => (missing.includes(ref) ? null : `asset://${ref}`);
}

const C2 = {
  version: "Sample 1.0.0",
  model: "data/model.moc",
  textures: ["data/t1.png"],
  motions: {
    idle: [{ file: "motions/idle.mtn", sound: "sounds/idle.wav" }],
    gone: [{ file: "../_mtn_emp/sakiko/gone.mtn" }],
    mixed: [{ file: "motions/keep.mtn" }, { file: "../_mtn_emp/mana/drop.mtn" }],
  },
  expressions: [
    { name: "smile", file: "exp/smile.exp.json" },
    { name: "lost", file: "../_mtn_emp/anon/lost.json" },
  ],
};

const C3 = {
  Version: 3,
  FileReferences: {
    Moc: "x.moc3",
    Textures: ["t.png"],
    Motions: {
      ok: [{ File: "motions/ok.motion3.json", Sound: "voice/ok.wav" }],
      bad: [{ File: "../pool/bad.motion3.json" }],
    },
    Expressions: [
      { Name: "keep", File: "exp/keep.exp3.json" },
      { Name: "drop", File: "../pool/drop.exp3.json" },
    ],
  },
};

describe("pruneSettings — Cubism 2", () => {
  it("drops unresolvable motion entries + expressions, drops emptied groups, counts both", () => {
    const missing = ["../_mtn_emp/sakiko/gone.mtn", "../_mtn_emp/mana/drop.mtn", "../_mtn_emp/anon/lost.json"];
    const { settings, prunedMotions, prunedExpressions } = pruneSettings(C2, resolveExcept(missing));
    expect(settings.motions).toEqual({
      idle: [{ file: "motions/idle.mtn", sound: "sounds/idle.wav" }],
      mixed: [{ file: "motions/keep.mtn" }],
    });
    expect(settings.expressions).toEqual([{ name: "smile", file: "exp/smile.exp.json" }]);
    expect(prunedMotions).toBe(2);
    expect(prunedExpressions).toBe(1);
    expect(settings.model).toBe("data/model.moc"); // essentials are never pruned
    expect(C2.motions.gone).toHaveLength(1); // input JSON is not mutated
  });

  it("keeps a motion whose sound alone is unresolvable, minus the sound", () => {
    const { settings, prunedMotions } = pruneSettings(C2, resolveExcept(["sounds/idle.wav"]));
    expect(settings.motions).toMatchObject({ idle: [{ file: "motions/idle.mtn" }] });
    expect((settings.motions as Record<string, Array<Record<string, unknown>>>).idle?.[0]).not.toHaveProperty("sound");
    expect(prunedMotions).toBe(0);
  });

  it("returns everything untouched when all refs resolve", () => {
    const { settings, prunedMotions, prunedExpressions } = pruneSettings(C2, () => "asset://x");
    expect(settings.motions).toEqual(C2.motions);
    expect(settings.expressions).toEqual(C2.expressions);
    expect(prunedMotions + prunedExpressions).toBe(0);
  });
});

describe("pruneSettings — Cubism 3 (FileReferences keys)", () => {
  it("prunes over FileReferences.Motions/.Expressions with File/Sound casing", () => {
    const missing = ["../pool/bad.motion3.json", "../pool/drop.exp3.json"];
    const { settings, prunedMotions, prunedExpressions } = pruneSettings(C3, resolveExcept(missing));
    const fr = settings.FileReferences as Record<string, unknown>;
    expect(fr.Motions).toEqual({ ok: [{ File: "motions/ok.motion3.json", Sound: "voice/ok.wav" }] });
    expect(fr.Expressions).toEqual([{ Name: "keep", File: "exp/keep.exp3.json" }]);
    expect(fr.Moc).toBe("x.moc3");
    expect(prunedMotions).toBe(1);
    expect(prunedExpressions).toBe(1);
  });

  it("drops only the Sound key on a sound-only miss", () => {
    const { settings, prunedMotions } = pruneSettings(C3, resolveExcept(["voice/ok.wav"]));
    const fr = settings.FileReferences as { Motions: Record<string, Array<Record<string, unknown>>> };
    expect(fr.Motions.ok?.[0]).toEqual({ File: "motions/ok.motion3.json" });
    expect(prunedMotions).toBe(0);
  });
});

describe("pruneSettings — absent containers", () => {
  it("leaves settings without motions/expressions untouched", () => {
    const bare = { model: "m.moc", textures: ["t.png"] };
    const { settings, prunedMotions, prunedExpressions } = pruneSettings(bare, () => null);
    expect(settings).toEqual(bare);
    expect(prunedMotions + prunedExpressions).toBe(0);
  });
});

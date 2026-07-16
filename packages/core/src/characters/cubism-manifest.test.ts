import { describe, expect, it } from "vitest";
import { CharacterImportError } from "./import-error.ts";
import { detectGeneration, extractManifestNames, motionExpressionRefs, validateEssentials, validateManifest } from "./cubism-manifest.ts";

const hasIn = (present: string[]) => (relPath: string) => present.includes(relPath);

const C2 = {
  version: "Sample 1.0.0",
  model: "data/model.moc",
  textures: ["data/t1.png", "data/t2.png"],
  physics: "data/phys.json",
  motions: { idle: [{ file: "m/idle.mtn" }], smile: [{ file: "m/smile.mtn" }] },
  expressions: [
    { name: "smile01", file: "e/smile.exp.json" },
    { name: "angry01", file: "e/angry.exp.json" },
  ],
};

const C3 = {
  Version: 3,
  FileReferences: {
    Moc: "taki.moc3",
    Textures: ["textures/t.png"],
    Physics: "taki.physics3.json",
    Motions: {
      mtn_idle01_C: [{ File: "motions/idle.motion3.json" }],
      mtn_smile01_C: [{ File: "motions/smile.motion3.json" }],
    },
    Expressions: [{ Name: "exp_smile05", File: "exp/smile.exp3.json" }],
  },
};

describe("detectGeneration (T3)", () => {
  it("detects C2 from a top-level `model` and C3 from `FileReferences` or a 3.x Version", () => {
    expect(detectGeneration(C2)).toBe("cubism2");
    expect(detectGeneration(C3)).toBe("cubism3");
    expect(detectGeneration({ Version: "3.0.0" })).toBe("cubism3");
    expect(detectGeneration({ version: "Sample 1.0.0", model: "x.moc" })).toBe("cubism2");
  });
});

describe("validateManifest hard failures (T3)", () => {
  it("throws missing_moc when the geometry is unreachable", () => {
    expect(() => validateManifest(C2, hasIn(["data/t1.png", "data/t2.png"]))).toThrow(CharacterImportError);
    try {
      validateManifest(C3, hasIn(["textures/t.png"]));
    } catch (error) {
      expect((error as CharacterImportError).code).toBe("missing_moc");
    }
  });

  it("throws missing_textures when a texture is absent or the list is empty", () => {
    try {
      validateManifest(C2, hasIn(["data/model.moc", "data/t1.png"])); // t2 absent
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as CharacterImportError).code).toBe("missing_textures");
    }
    try {
      validateManifest({ model: "m.moc", textures: [] }, hasIn(["m.moc"]));
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as CharacterImportError).code).toBe("missing_textures");
    }
  });
});

describe("validateManifest optional-resource warnings (T3, decision 6)", () => {
  it("returns warnings (never throws) for missing optional motions/expressions in a C2 costume", () => {
    const warnings = validateManifest(C2, hasIn(["data/model.moc", "data/t1.png", "data/t2.png"]));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes("motion"))).toBe(true);
  });

  it("tolerates a Cubism-2 external `../_mtn_emp/` shared-motion reference as a warning, not a failure", () => {
    const external = { model: "m.moc", textures: ["t.png"], motions: { idle: [{ file: "../_mtn_emp/idle.mtn" }] } };
    const warnings = validateManifest(external, hasIn(["m.moc", "t.png"]));
    expect(warnings.some((w) => w.includes("motion"))).toBe(true);
  });

  it("treats a missing C3 optional motion as a warning too (unified policy, not the reference's strict C3)", () => {
    const warnings = validateManifest(C3, hasIn(["taki.moc3", "textures/t.png"]));
    expect(warnings.length).toBeGreaterThan(0); // physics + motions + expressions all absent from the has-set
  });

  it("returns no warnings when every optional resource is present", () => {
    const present = ["data/model.moc", "data/t1.png", "data/t2.png", "data/phys.json", "m/idle.mtn", "m/smile.mtn", "e/smile.exp.json", "e/angry.exp.json"];
    expect(validateManifest(C2, hasIn(present))).toEqual([]);
  });
});

describe("extractManifestNames (T3)", () => {
  it("extracts motion group + expression names from a C2 manifest", () => {
    expect(extractManifestNames(C2)).toEqual({ motions: ["idle", "smile"], expressions: ["angry01", "smile01"] });
  });

  it("extracts motion group + expression names from a C3 manifest (FileReferences paths)", () => {
    expect(extractManifestNames(C3)).toEqual({ motions: ["mtn_idle01_C", "mtn_smile01_C"], expressions: ["exp_smile05"] });
  });
});

describe("validateEssentials (availability's renderable probe)", () => {
  it("passes on moc+textures alone and never probes optional refs", () => {
    expect(() => validateEssentials(C2, hasIn(["data/model.moc", "data/t1.png", "data/t2.png"]))).not.toThrow();
    expect(() => validateEssentials(C2, hasIn(["data/t1.png", "data/t2.png"]))).toThrow(CharacterImportError);
  });
});

describe("motionExpressionRefs (availability's external-ref surface)", () => {
  it("lists motion file+sound and expression file refs from a C2 manifest, deduped", () => {
    const manifest = {
      model: "m.moc",
      textures: ["t.png"],
      motions: { idle: [{ file: "i.mtn", sound: "i.wav" }], again: [{ file: "i.mtn" }] },
      expressions: [{ name: "smile", file: "e.exp.json" }],
    };
    expect(motionExpressionRefs(manifest)).toEqual(["i.mtn", "i.wav", "e.exp.json"]);
  });

  it("lists File+Sound refs from a C3 manifest at the FileReferences paths", () => {
    const manifest = {
      FileReferences: {
        Moc: "x.moc3",
        Textures: ["t.png"],
        Motions: { idle: [{ File: "motions/i.motion3.json", Sound: "voice/i.wav" }] },
        Expressions: [{ Name: "smile", File: "exp/s.exp3.json" }],
      },
    };
    expect(motionExpressionRefs(manifest)).toEqual(["motions/i.motion3.json", "voice/i.wav", "exp/s.exp3.json"]);
  });
});

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rmTempDir } from "../testing/rm-temp.ts";
import type { SkillMeta } from "./skill-scanner.ts";
import type { SkillsState } from "./skills-state.ts";
import { createSkillsLoader } from "./skills-loader.ts";

const roots: string[] = [];
function skillFile(name: string, body: string): SkillMeta {
  const root = mkdtempSync(join(tmpdir(), "taki-skill-load-"));
  roots.push(root);
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const skillPath = join(dir, "SKILL.md");
  writeFileSync(skillPath, `---\nname: ${name}\ndescription: "d"\n---\n${body}`);
  return { name, description: `${name} does things`, skillPath, contentRevision: `sha256.${name}` };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmTempDir(root);
});

function fakeState(disabled: string[] = []): SkillsState {
  const set = new Set(disabled);
  return {
    isDisabled: (n) => set.has(n),
    disable: (n) => void set.add(n),
    enable: (n) => void set.delete(n),
    listDisabled: () => [...set],
  };
}

describe("createSkillsLoader (T19)", () => {
  it("renders only enabled skills; empty list -> empty string", () => {
    const a = skillFile("alpha", "A body");
    const b = skillFile("beta", "B body");
    const loader = createSkillsLoader({ skills: [a, b], state: fakeState(["beta"]) });

    const list = loader.renderList();
    expect(list).toContain("- alpha: alpha does things");
    expect(list).not.toContain("beta");

    expect(createSkillsLoader({ skills: [], state: fakeState() }).renderList()).toBe("");
  });

  it("loads an enabled skill's body", () => {
    const a = skillFile("alpha", "The full alpha instructions.");
    const loader = createSkillsLoader({ skills: [a], state: fakeState() });
    expect(loader.load("alpha")).toEqual({ ok: true, content: "The full alpha instructions.", contentRevision: "sha256.alpha", files: [] });
  });

  it("loads a block-scalar Skill through the standard parser", () => {
    const skill = skillFile("alpha", "The full alpha instructions.");
    writeFileSync(skill.skillPath, "---\nname: alpha\ndescription: |\n  Alpha skill.\nmetadata:\n  team: tools\n---\nBlock body");
    expect(createSkillsLoader({ skills: [skill], state: fakeState() }).load("alpha")).toMatchObject({ ok: true, content: "Block body" });
  });

  it("returns NOT_FOUND for an unknown skill", () => {
    const loader = createSkillsLoader({ skills: [], state: fakeState() });
    expect(loader.load("ghost")).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("returns DISABLED for a disabled skill (and never loads its body)", () => {
    const a = skillFile("alpha", "body");
    const loader = createSkillsLoader({ skills: [a], state: fakeState(["alpha"]) });
    expect(loader.load("alpha")).toMatchObject({ ok: false, code: "DISABLED" });
  });
});

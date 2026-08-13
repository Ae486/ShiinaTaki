import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rmTempDir } from "../testing/rm-temp.ts";
import { scanSkills } from "./skill-scanner.ts";

const roots: string[] = [];
function skillsRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "taki-skills-"));
  roots.push(root);
  return root;
}
function writeSkill(root: string, dir: string, contents: string): void {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, "SKILL.md"), contents);
}
afterEach(() => {
  for (const root of roots.splice(0)) rmTempDir(root);
});

const valid = (name: string, description = "Does a thing. Use when asked.") =>
  `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\nStep 1. Do the thing.\n`;

describe("scanSkills (T17)", () => {
  it("returns {skills, invalid} for a missing root", () => {
    expect(scanSkills(join(skillsRoot(), "absent"))).toEqual({ skills: [], invalid: [] });
  });

  it("discovers a valid skill with its name + description", () => {
    const root = skillsRoot();
    writeSkill(root, "greet", valid("greet"));
    const { skills, invalid } = scanSkills(root);
    expect(invalid).toEqual([]);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: "greet", description: "Does a thing. Use when asked." });
  });

  it("changes contentRevision when SKILL.md content changes", () => {
    const root = skillsRoot();
    writeSkill(root, "greet", valid("greet"));
    const first = scanSkills(root).skills[0]?.contentRevision;
    writeSkill(root, "greet", `${valid("greet")}Step 2. Use the revised procedure.\n`);
    const second = scanSkills(root).skills[0]?.contentRevision;

    expect(first).toMatch(/^sha256\.[a-f0-9]{64}$/);
    expect(second).toMatch(/^sha256\.[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
  });

  it("marks name != directory as invalid", () => {
    const root = skillsRoot();
    writeSkill(root, "greet", valid("greeter")); // name mismatches dir
    expect(scanSkills(root)).toMatchObject({ skills: [], invalid: ["greet"] });
  });

  it("marks a missing description as invalid", () => {
    const root = skillsRoot();
    writeSkill(root, "nodesc", "---\nname: nodesc\n---\nbody");
    expect(scanSkills(root)).toMatchObject({ skills: [], invalid: ["nodesc"] });
  });

  it("marks a block-scalar description (unsupported in v1) as invalid, not a crash", () => {
    const root = skillsRoot();
    writeSkill(root, "block", "---\nname: block\ndescription: |\n  line one\n  line two\n---\nbody");
    expect(scanSkills(root)).toMatchObject({ skills: [], invalid: ["block"] });
  });

  it("keeps valid skills while collecting invalid ones", () => {
    const root = skillsRoot();
    writeSkill(root, "good", valid("good"));
    writeSkill(root, "bad", valid("mismatch"));
    const { skills, invalid } = scanSkills(root);
    expect(skills.map((s) => s.name)).toEqual(["good"]);
    expect(invalid).toEqual(["bad"]);
  });
});

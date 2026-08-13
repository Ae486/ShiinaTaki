/**
 * INPUT:  the skills root dir (<dataDir>/skills) with <name>/SKILL.md folders
 * OUTPUT: scanSkills(root) -> { skills: SkillMeta[]; invalid: string[] } with full-file content revisions
 * POS:    core/skills — boot discovery; invalid packages are isolated, non-missing root IO still fails visibly
 */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { parseFrontmatter } from "../memory/frontmatter.ts";

/** Level-1 metadata (always loaded) + the path to lazy-load the body from (level 2, via load_skill). */
export interface SkillMeta {
  name: string;
  description: string;
  skillPath: string;
  contentRevision: string;
}

export interface SkillScan {
  skills: SkillMeta[];
  invalid: string[];
}

// Spec name rule: kebab-case, must equal the directory name (agentskills.io / Claude Code).
const NAME_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;
const SKILL_FILE = "SKILL.md";

/** Read-only scan; a hand-broken SKILL.md is collected into `invalid` (logged at boot), never a crash. */
export function scanSkills(root: string): SkillScan {
  const skills: SkillMeta[] = [];
  const invalid: string[] = [];
  for (const dirName of listSkillDirs(root)) {
    const skillPath = join(root, dirName, SKILL_FILE);
    const meta = validate(dirName, skillPath);
    if (meta) skills.push(meta);
    else invalid.push(dirName);
  }
  return { skills, invalid };
}

function validate(dirName: string, skillPath: string): SkillMeta | null {
  let text: string;
  try {
    text = readFileSync(skillPath, "utf8");
  } catch {
    return null; // no SKILL.md in this folder
  }
  let data: Record<string, unknown>;
  try {
    data = parseFrontmatter(text).data; // block scalars / lists / bad structure throw -> invalid (single-line only, v1)
  } catch {
    return null;
  }
  const { name, description } = data;
  if (typeof name !== "string" || !NAME_RE.test(name) || name !== dirName) return null;
  if (typeof description !== "string" || description.length === 0) return null;
  return { name, description, skillPath, contentRevision: `sha256.${createHash("sha256").update(text).digest("hex")}` };
}

function listSkillDirs(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; // no skills root yet: zero skills, normal boot
    throw error;
  }
}

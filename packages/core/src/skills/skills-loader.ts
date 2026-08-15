/**
 * INPUT:  discovered SkillMeta[] + a SkillsState (enable/disable) + load(name) calls
 * OUTPUT: createSkillsLoader(deps) -> { renderList, load, describe } — list, lazy body, and trusted revision lookup
 * POS:    core/skills — standard SKILL.md content boundary; metadata/body never grant action permission
 */
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../memory/frontmatter.ts";
import type { SkillMeta } from "./skill-scanner.ts";
import type { SkillsState } from "./skills-state.ts";

// Closed local error union (mirrors memory-tools; execute never throws).
export type SkillLoadResult =
  | { ok: true; content: string }
  | { ok: false; code: "NOT_FOUND" | "DISABLED" | "IO_ERROR"; message: string };

export interface SkillsLoader {
  /** Enabled skills as a system-context section; "" when none (no empty section). */
  renderList(): string;
  /** Lazy-load one enabled skill's markdown body (level 2); honors enable/disable state. */
  load(name: string): SkillLoadResult;
  describe(name: string): { name: string; contentRevision: string } | undefined;
}

const LIST_HEADER = "Skills you can load with load_skill:";

export function createSkillsLoader(deps: { skills: SkillMeta[]; state: SkillsState }): SkillsLoader {
  const byName = new Map(deps.skills.map((skill) => [skill.name, skill]));

  return {
    renderList() {
      const lines = deps.skills
        .filter((skill) => !deps.state.isDisabled(skill.name))
        .map((skill) => `- ${skill.name}: ${skill.description}`);
      return lines.length > 0 ? `${LIST_HEADER}\n${lines.join("\n")}` : "";
    },
    load(name) {
      const skill = byName.get(name);
      if (!skill) return { ok: false, code: "NOT_FOUND", message: `no skill named '${name}'` };
      if (deps.state.isDisabled(name)) return { ok: false, code: "DISABLED", message: `skill '${name}' is disabled` };
      try {
        return { ok: true, content: parseFrontmatter(readFileSync(skill.skillPath, "utf8")).body };
      } catch (error) {
        return { ok: false, code: "IO_ERROR", message: error instanceof Error ? error.message : String(error) };
      }
    },
    describe(name) {
      const skill = byName.get(name);
      return skill ? { name: skill.name, contentRevision: skill.contentRevision } : undefined;
    },
  };
}

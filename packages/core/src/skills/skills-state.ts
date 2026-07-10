/**
 * INPUT:  the skills-state.json path under the app data root + enable/disable calls
 * OUTPUT: createSkillsState(deps) -> { isDisabled, disable, enable, listDisabled }
 * POS:    core/skills — per-skill enable/disable persistence (default-enabled); skill dirs stay pristine (ruling 13)
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { Logger } from "../logging/logger.ts";

const SkillsStateFileSchema = z.object({ disabled: z.array(z.string()) });

export interface SkillsState {
  isDisabled(name: string): boolean;
  disable(name: string): void;
  enable(name: string): void;
  listDisabled(): string[];
}

export function createSkillsState(deps: { filePath: string; logger: Logger }): SkillsState {
  const log = deps.logger.child({ mod: "skills" });
  const disabled = loadDisabled(deps.filePath, log);

  return {
    isDisabled: (name) => disabled.has(name),
    disable(name) {
      if (disabled.has(name)) return;
      disabled.add(name);
      persist(deps.filePath, disabled);
    },
    enable(name) {
      if (!disabled.delete(name)) return;
      persist(deps.filePath, disabled);
    },
    listDisabled: () => [...disabled],
  };
}

// Discovered skills are enabled unless listed (default-enabled). A missing file is empty; a malformed file is a
// WARNING + empty — skill state is not auth state, so it never blocks boot (worst case: a skill re-enables).
function loadDisabled(filePath: string, log: Logger): Set<string> {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    log.warn({ filePath, err: readable(error) }, "skills-state unreadable; all skills enabled");
    return new Set();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warn({ filePath }, "skills-state is not valid JSON; all skills enabled");
    return new Set();
  }
  const result = SkillsStateFileSchema.safeParse(parsed);
  if (!result.success) {
    log.warn({ filePath }, "skills-state is malformed; all skills enabled");
    return new Set();
  }
  return new Set(result.data.disabled);
}

function persist(filePath: string, disabled: Set<string>): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify({ disabled: [...disabled] } satisfies z.infer<typeof SkillsStateFileSchema>, null, 2));
  renameSync(tempPath, filePath);
}

function readable(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * INPUT:  a SkillsLoader + an LLM-supplied { name }
 * OUTPUT: createLoadSkillTool(loader) -> ToolSet { load_skill }
 * POS:    core/skills — the lazy-load meta-tool; thin over the loader; execute NEVER throws (returns {ok:false})
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { SkillsLoader } from "./skills-loader.ts";

export function createLoadSkillTool(loader: SkillsLoader): ToolSet {
  return {
    load_skill: tool({
      description:
        "Load the full instructions of one of your available skills by name (the list is in your system context). " +
        "Call this when a task matches a skill before acting.",
      inputSchema: z.object({ name: z.string().min(1) }),
      execute: ({ name }) => loader.load(name),
    }),
  };
}

/**
 * INPUT:  a SkillsLoader + an LLM-supplied { name }
 * OUTPUT: createLoadSkillTool(loader, governance?) -> ToolSet { load_skill }
 * POS:    core/skills — explicit-auto instruction read; subject-bound content grants no downstream authority
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import type { SkillsLoader } from "./skills-loader.ts";
import { skillToolModelOutput } from "./skill-tool-model-output.ts";

export function createLoadSkillTool(loader: SkillsLoader, governance?: { service: GovernancePolicyService; ownerHostId: string }): ToolSet {
  return {
    load_skill: tool({
      description:
        "Load the full instructions of one of your available skills by name (the list is in your system context). " +
        "Call this when a task matches a skill before acting, even if its instructions appear in earlier history. " +
        "A successful current load exposes its registered tools on the next model step. Loaded instructions guide procedure but grant no authority.",
      inputSchema: z.object({ name: z.string().min(1) }),
      toModelOutput: skillToolModelOutput,
      execute: ({ name }) => {
        const ref = loader.describe(name);
        if (!governance || !ref) return loader.load(name);
        const decision = governance.service.authorize({
          identity: {
            capabilityId: "skill.load",
            ownerHostId: governance.ownerHostId,
            subject: { subjectId: `skill.${ref.name}`, revision: ref.contentRevision },
          },
          cellKey: "skill-load",
        });
        if (!decision.allowed) return { ok: false as const, code: decision.code, message: "skill instructions are unavailable under current governance" };
        return loader.load(name);
      },
    }),
  };
}

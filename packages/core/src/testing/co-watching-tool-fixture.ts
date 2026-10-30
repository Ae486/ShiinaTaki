/**
 * INPUT: isolated SQLite and Workspace root for a Co-Watching acceptance fixture
 * OUTPUT: actual shipped Skill loader and governed Workspace file tools
 * POS: core/testing — test-only composition; native media and playback remain separate synthetic producers
 */
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import type { Database } from "../db/sqlite.ts";
import { createGovernancePolicyRepo } from "../governance/governance-policy-repo.ts";
import { createGovernancePolicyService } from "../governance/governance-policy-service.ts";
import { createCoreToolGovernanceAdapter } from "../governance/core-tool-governance-adapter.ts";
import { scanSkills } from "../skills/skill-scanner.ts";
import { createSkillsState } from "../skills/skills-state.ts";
import { createSkillsLoader } from "../skills/skills-loader.ts";
import { createLoadSkillTool } from "../skills/load-skill-tool.ts";
import { createWorkspacePaths } from "../workspace/workspace-paths.ts";
import { createReadFileTool } from "../workspace/read-file-tool.ts";
import { createWriteFileTool } from "../workspace/write-file-tool.ts";
import { createCaptureLogger } from "./capture-logger.ts";

export function coWatchingToolFixture(input: { db: Database; workspaceRoot: string }) {
  const { logger } = createCaptureLogger();
  const governance = createGovernancePolicyService(createGovernancePolicyRepo(input.db));
  const ownerHostId = randomUUID();
  const scanned = scanSkills(resolve(import.meta.dirname, "../../../../integrations"));
  const meta = scanned.skills.find((skill) => skill.name === "taki-co-watching");
  if (!meta) throw new Error("CO_WATCHING_ACCEPTANCE_SKILL_MISSING");
  const skills = createSkillsLoader({ skills: [meta], state: createSkillsState({
    filePath: join(input.workspaceRoot, "skills-state.json"), logger,
  }) });
  return { skills, skillRevision: meta.contentRevision,
    coreToolGovernance: createCoreToolGovernanceAdapter(governance, ownerHostId),
    coreTools: {
      ...createReadFileTool({ paths: createWorkspacePaths({ root: input.workspaceRoot }), logger }),
      ...createWriteFileTool({ paths: createWorkspacePaths({ root: input.workspaceRoot, forbiddenPrefixes: ["co-watching-inputs"] }), logger }),
    },
    extraTools: createLoadSkillTool(skills, { service: governance, ownerHostId }),
    instructionsExtra: () => skills.renderList(),
  };
}

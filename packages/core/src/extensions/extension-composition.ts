/**
 * INPUT:  Core Host id plus live Skill/MCP/Host authorities and the canonical capability route
 * OUTPUT: compatibility Skill tools and a factory for immutable per-Run Extension contexts
 * POS:    core/extensions composition seam — main.ts wiring only; it creates no new authority or persistence
 */
import { randomUUID } from "node:crypto";
import type { ToolSet } from "ai";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import type { HostCatalogStore } from "../hosts/host-catalog.ts";
import type { McpManager } from "../mcp/mcp-manager.ts";
import type { TurnInteractive } from "../mcp/mcp-turn-tools.ts";
import { createLoadSkillTool } from "../skills/load-skill-tool.ts";
import { createReadSkillResourceTool } from "../skills/read-skill-resource-tool.ts";
import type { SkillCatalogManager } from "../skills/skill-catalog-manager.ts";
import type { SkillsLoader } from "../skills/skills-loader.ts";
import { createExtensionRunContext, type ExtensionRunContext } from "./extension-run-context.ts";

interface ExtensionCompositionInput {
  coreHostId: string;
  catalogs: HostCatalogStore;
  skills: { catalog: SkillCatalogManager; loader: SkillsLoader; governance: GovernancePolicyService };
  mcp: McpManager;
  route: (request: { capabilityId: string; input: unknown; targetHostId: string }, interactive?: TurnInteractive) => Promise<unknown>;
}

export function createExtensionComposition(input: ExtensionCompositionInput): {
  skillTools: ToolSet;
  runContext: (interactive?: TurnInteractive, runId?: string) => ExtensionRunContext;
} {
  const skillTools: ToolSet = {
    ...createLoadSkillTool(input.skills.loader, { service: input.skills.governance, ownerHostId: input.coreHostId }),
    ...createReadSkillResourceTool(input.skills.loader, { service: input.skills.governance, ownerHostId: input.coreHostId }),
  };
  return {
    skillTools: Object.freeze(skillTools),
    runContext: (interactive, runId = randomUUID()) => createExtensionRunContext({
      runId,
      coreHostId: input.coreHostId,
      catalogs: input.catalogs,
      skills: input.skills,
      mcp: input.mcp,
      interactive,
      route: (request) => input.route(request, interactive),
    }),
  };
}

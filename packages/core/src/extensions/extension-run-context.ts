/**
 * INPUT:  one Run id, Core/Host/MCP/Skill live authorities, interactive context, and canonical Host route
 * OUTPUT: createExtensionRunContext() -> captured tools/instructions/snapshot reused by every model retry
 * POS:    core/extensions — Run assembly seam; projections are process-local and never persisted or replayed
 */
import type { ToolSet } from "ai";
import type { ExtensionRunSnapshot } from "@taki/shared";
import { mergeToolSets } from "../agents/tool-set-assembly.ts";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import type { HostCatalogStore } from "../hosts/host-catalog.ts";
import { createHostContext, renderHostContext } from "../hosts/host-context.ts";
import type { McpManager } from "../mcp/mcp-manager.ts";
import type { TurnInteractive } from "../mcp/mcp-turn-tools.ts";
import type { SkillCatalogManager } from "../skills/skill-catalog-manager.ts";
import type { SkillsLoader } from "../skills/skills-loader.ts";
import { createExtensionRegistry } from "./extension-registry.ts";
import {
  snapshotHostCapabilityExtensions,
  snapshotHosts,
  snapshotMcpExtensions,
  snapshotSkillExtensions,
} from "./extension-sources.ts";
import { createExtensionTools } from "./extension-tools.ts";

export interface ExtensionRunContext {
  readonly tools: ToolSet;
  readonly instructions: string;
  readonly snapshot: ExtensionRunSnapshot;
}

export function createExtensionRunContext(input: {
  runId: string;
  coreHostId: string;
  catalogs: HostCatalogStore;
  skills: { catalog: SkillCatalogManager; loader: SkillsLoader; governance: GovernancePolicyService };
  mcp: McpManager;
  interactive?: TurnInteractive;
  route: (request: { capabilityId: string; input: unknown; targetHostId: string }) => Promise<unknown>;
}): ExtensionRunContext {
  const catalogs = input.catalogs.list();
  const mcp = snapshotMcpExtensions(input.mcp, input.interactive);
  const candidates = [
    ...snapshotSkillExtensions({ ownerHostId: input.coreHostId, ...input.skills }),
    ...mcp.candidates,
    ...snapshotHostCapabilityExtensions(input.catalogs, input.route),
  ];
  const registry = createExtensionRegistry({
    runId: input.runId,
    primaryHostId: input.coreHostId,
    hosts: snapshotHosts(catalogs),
    candidates,
  });
  const hostContext = renderHostContext(createHostContext(input.coreHostId, catalogs));
  return Object.freeze({
    tools: Object.freeze(mergeToolSets(mcp.directTools, createExtensionTools(registry))),
    instructions: `${hostContext}\n\n${registry.renderContext()}`,
    snapshot: registry.snapshot,
  });
}

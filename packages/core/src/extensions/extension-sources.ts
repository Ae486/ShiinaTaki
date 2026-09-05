/**
 * INPUT:  live Skill/MCP catalogs, authenticated Host catalogs, and existing governed tool/route adapters
 * OUTPUT: host-qualified candidates plus direct MCP tools and names captured in the same snapshot iteration
 * POS:    core/extensions — adapter layer; it reuses lifecycle/governance authority and adds no execution path
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Tool, ToolExecutionOptions, ToolSet } from "ai";
import { captureToolDisplayNames, formatMcpToolDisplayName, type ExtensionHostSnapshot } from "@taki/shared";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import type { HostCatalogStore, LiveHostCatalog } from "../hosts/host-catalog.ts";
import type { McpManager, McpToolSnapshot } from "../mcp/mcp-manager.ts";
import type { TurnInteractive } from "../mcp/mcp-turn-tools.ts";
import type { SkillCatalogManager } from "../skills/skill-catalog-manager.ts";
import { createLoadSkillTool } from "../skills/load-skill-tool.ts";
import { createReadSkillResourceTool } from "../skills/read-skill-resource-tool.ts";
import type { SkillsLoader } from "../skills/skills-loader.ts";
import type { ExtensionCandidate } from "./extension-registry.ts";
import { routeExtensionTransfer } from "./extension-transfer.ts";

type CapabilityRoute = (request: { capabilityId: string; input: unknown; targetHostId: string }) => Promise<unknown>;

export interface McpExtensionSnapshot {
  readonly candidates: readonly ExtensionCandidate[];
  readonly directTools: ToolSet;
  readonly toolDisplayNames?: Readonly<Record<string, string>>;
}

export function snapshotSkillExtensions(input: {
  ownerHostId: string;
  catalog: SkillCatalogManager;
  loader: SkillsLoader;
  governance: GovernancePolicyService;
}): readonly ExtensionCandidate[] {
  const generation = input.catalog.currentGeneration();
  const loadTool = createLoadSkillTool(input.loader, { service: input.governance, ownerHostId: input.ownerHostId }).load_skill;
  const resourceTool = createReadSkillResourceTool(input.loader, { service: input.governance, ownerHostId: input.ownerHostId }).read_skill_resource;
  return Object.freeze(input.catalog.list().flatMap((entry) => {
    const name = entry.row.skillName;
    const revision = entry.row.contentHash;
    if (!name || !revision) return [];
    const current = () => input.catalog.currentGeneration() === generation
      && input.catalog.describe(name)?.contentRevision === revision;
    const candidates: ExtensionCandidate[] = [{
      identity: localIdentity({ kind: "skill", ownerHostId: input.ownerHostId, subjectId: `skill.${entry.row.packageId}`, revision, generation }),
      displayName: name.slice(0, 160),
      summary: (entry.row.description ?? "Load this Skill's instructions").slice(0, 512),
      callMode: "skill-load",
      isCurrent: current,
      call: (value, options) => emptyInput(value)
        ? executeTool(loadTool, { name }, options)
        : invalidInput(),
    }];
    if (entry.files.some((path) => path !== "SKILL.md")) candidates.push({
      identity: localIdentity({ kind: "skill", ownerHostId: input.ownerHostId, subjectId: `skill-resource.${entry.row.packageId}`, revision, generation }),
      displayName: `${name} resources`.slice(0, 160),
      summary: "Read one listed UTF-8 support resource from this Skill package.",
      callMode: "skill-resource",
      isCurrent: current,
      call: (value, options) => {
        const parsed = ResourceInputSchema.safeParse(value);
        return parsed.success ? executeTool(resourceTool, { name, path: parsed.data.path }, options) : invalidInput();
      },
    });
    return candidates;
  }));
}

export function snapshotMcpExtensions(manager: McpManager, interactive?: TurnInteractive): McpExtensionSnapshot {
  const snapshots = manager.snapshot(interactive);
  const directTools: ToolSet = {};
  const names: [string, string][] = [];
  const candidates = snapshots.map((entry) => {
    directTools[entry.toolKey] = entry.tool;
    names.push([entry.toolKey, formatMcpToolDisplayName(entry.ref)]);
    return mcpCandidate(entry);
  });
  return Object.freeze({
    candidates: Object.freeze(candidates),
    directTools: Object.freeze(directTools),
    toolDisplayNames: captureToolDisplayNames(Object.fromEntries(names)),
  });
}

export function snapshotHostCapabilityExtensions(
  catalogs: HostCatalogStore,
  route: CapabilityRoute,
): readonly ExtensionCandidate[] {
  return Object.freeze(catalogs.list().flatMap((catalog) => catalog.capabilities.map((descriptor) => {
    const transfer = catalog.workspaces.some((workspace) =>
      workspace.transferCapabilityIds.includes(descriptor.capabilityId));
    return {
    identity: {
      kind: "capability" as const,
      ownerHostId: catalog.hostId,
      subjectId: descriptor.capabilityId,
      subjectRevision: capabilityRevision(descriptor),
      connectionGeneration: catalog.connectionGeneration,
      catalogGeneration: catalog.catalogGeneration,
    },
    displayName: descriptor.capabilityId.slice(0, 160),
    summary: `Host capability (${descriptor.execution}; ${descriptor.cancellation} cancellation)`,
    callMode: transfer ? "transfer" as const : "capability" as const,
    available: catalog.readiness === "ready",
    isCurrent: () => currentCapability(catalogs, catalog, descriptor.capabilityId),
    call: (value: unknown) => transfer
      ? routeExtensionTransfer({ catalogs, route }, {
          targetHostId: catalog.hostId,
          transferCapabilityId: descriptor.capabilityId,
          input: value,
        })
      : route({ capabilityId: descriptor.capabilityId, input: value, targetHostId: catalog.hostId }),
    };
  })));
}

export function snapshotHosts(catalogs: readonly LiveHostCatalog[]): readonly ExtensionHostSnapshot[] {
  return Object.freeze(catalogs.map((catalog) => Object.freeze({
    hostId: catalog.hostId,
    available: catalog.readiness === "ready",
    connectionGeneration: catalog.connectionGeneration,
    catalogGeneration: catalog.catalogGeneration,
    extensionCount: catalog.capabilities.length + catalog.skills.length
      + catalog.mcpServers.reduce((count, server) => count + server.toolNames.length, 0),
  })));
}

function mcpCandidate(entry: McpToolSnapshot): ExtensionCandidate {
  return {
    identity: localIdentity({
      kind: "mcp-tool",
      ownerHostId: entry.ownerHostId,
      subjectId: entry.ref.subjectId,
      revision: entry.ref.subjectRevision,
      generation: entry.generation,
    }),
    displayName: entry.ref.toolName.slice(0, 160),
    summary: typeof entry.tool.description === "string" ? entry.tool.description.slice(0, 512) : "Configured MCP tool",
    callMode: "mcp-tool",
    isCurrent: entry.isCurrent,
    call: (value, options) => executeTool(entry.tool, value, options),
  };
}

function localIdentity(input: {
  kind: "skill" | "mcp-tool";
  ownerHostId: string;
  subjectId: string;
  revision: string;
  generation: number;
}) {
  return {
    kind: input.kind,
    ownerHostId: input.ownerHostId,
    subjectId: input.subjectId,
    subjectRevision: input.revision,
    connectionGeneration: input.generation,
    catalogGeneration: input.generation,
  };
}

function currentCapability(catalogs: HostCatalogStore, captured: LiveHostCatalog, capabilityId: string): boolean {
  const current = catalogs.get(captured.hostId);
  return current?.connectionGeneration === captured.connectionGeneration
    && current.catalogGeneration === captured.catalogGeneration
    && current.readiness === "ready"
    && current.capabilities.some((item) => item.capabilityId === capabilityId);
}

function capabilityRevision(descriptor: LiveHostCatalog["capabilities"][number]): string {
  const value = JSON.stringify([
    descriptor.capabilityId,
    descriptor.execution,
    descriptor.cancellation,
    descriptor.governance.descriptorRevision,
    descriptor.governance.classifierId,
    descriptor.governance.classifierRevision,
  ]);
  return `descriptor.${createHash("sha256").update(value).digest("hex")}`;
}

function executeTool(tool: Tool | undefined, input: unknown, options: ToolExecutionOptions<unknown>): unknown | PromiseLike<unknown> {
  const execute = tool?.execute as ((value: unknown, context: ToolExecutionOptions<unknown>) => unknown | PromiseLike<unknown>) | undefined;
  return execute ? execute(input, options) : { ok: false, code: "EXTENSION_UNAVAILABLE" };
}

const ResourceInputSchema = z.strictObject({ path: z.string().min(1) });
const EmptyInputSchema = z.strictObject({});
function emptyInput(value: unknown): boolean { return EmptyInputSchema.safeParse(value).success; }
function invalidInput() { return { ok: false as const, code: "INVALID_EXTENSION_INPUT" as const }; }

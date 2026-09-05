import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { EXTENSION_DISCOVERY_BUDGET } from "@taki/shared";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import { createHostCatalogStore } from "../hosts/host-catalog.ts";
import type { McpManager } from "../mcp/mcp-manager.ts";
import type { SkillCatalogManager } from "../skills/skill-catalog-manager.ts";
import type { SkillsLoader } from "../skills/skills-loader.ts";
import { createExtensionRunContext } from "./extension-run-context.ts";

const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CORE = "00000000-0000-4000-8000-000000000001";
const HOST = "11111111-1111-4111-8111-111111111111";
const options = { toolCallId: "call-1", messages: [] } as unknown as ToolExecutionOptions<unknown>;

describe("extension Run context", () => {
  it("composes usable Skill/MCP/Host bindings and rejects a retired Host generation", async () => {
    const catalogs = createHostCatalogStore();
    publishHost(catalogs, 1);
    let skillGeneration = 2;
    const loader = skillLoader();
    const route = vi.fn(async (request) => ({ ok: true, output: { routedTo: request.targetHostId } }));
    const mcp = mcpManager();
    const snapshot = vi.spyOn(mcp, "snapshot");
    const context = createExtensionRunContext({
      runId: RUN,
      coreHostId: CORE,
      catalogs,
      skills: { catalog: skillCatalog(() => skillGeneration), loader, governance: allowGovernance() },
      mcp,
      route,
    });

    expect(context.snapshot.entries.map((entry) => entry.identity.kind).sort())
      .toEqual(["capability", "mcp-tool", "skill"]);
    expect(Object.keys(context.tools).sort()).toEqual([
      "extension_call",
      "extension_describe",
      "extension_discover",
      "server_echo",
    ]);
    expect(context.instructions).toContain("Cross-Host movement requires");
    expect(snapshot).toHaveBeenCalledOnce();
    expect(context.toolDisplayNames).toEqual({ server_echo: "server · echo" });
    expect(Object.isFrozen(context.toolDisplayNames)).toBe(true);

    const skill = context.snapshot.entries.find((entry) => entry.identity.kind === "skill")!;
    await expect(callExtension(context.tools, skill.identity.extensionId, {})).resolves.toMatchObject({
      ok: true,
      owner: skill.identity,
      output: { ok: true, content: "Use the existing tool.", contentRevision: "sha256.skill", files: [] },
    });

    const capability = context.snapshot.entries.find((entry) => entry.identity.kind === "capability")!;
    await expect(callExtension(context.tools, capability.identity.extensionId, { mode: "full" })).resolves.toMatchObject({
      ok: true,
      owner: capability.identity,
    });
    expect(route).toHaveBeenCalledWith({ capabilityId: "screenshot", input: { mode: "full" }, targetHostId: HOST });

    publishHost(catalogs, 2);
    await expect(callExtension(context.tools, capability.identity.extensionId, {})).resolves.toMatchObject({
      ok: false,
      code: "EXTENSION_STALE_GENERATION",
      owner: capability.identity,
    });
    skillGeneration = 3;
    await expect(callExtension(context.tools, skill.identity.extensionId, {})).resolves.toMatchObject({
      ok: false,
      code: "EXTENSION_STALE_GENERATION",
      owner: skill.identity,
    });
  });

  it("captures every direct MCP name from the same snapshot even when discovery budgets omit entries", () => {
    const seed = mcpManager().snapshot()[0]!;
    const entries = Array.from({ length: EXTENSION_DISCOVERY_BUDGET.maxEntries + 1 }, (_, index) => ({
      ...seed,
      toolKey: `direct_route_${index}`,
      ref: { ...seed.ref, subjectId: `mcp.subject.${index}`, toolName: `actual.tool.${index}` },
    }));
    const snapshot = vi.fn(() => entries);
    const context = createExtensionRunContext({
      runId: RUN,
      coreHostId: CORE,
      catalogs: createHostCatalogStore(),
      skills: { catalog: skillCatalog(() => 1), loader: skillLoader(), governance: allowGovernance() },
      mcp: { snapshot } as unknown as McpManager,
      route: async () => ({ ok: true }),
    });

    expect(snapshot).toHaveBeenCalledOnce();
    expect(context.snapshot.entries).toHaveLength(EXTENSION_DISCOVERY_BUDGET.maxEntries);
    expect(Object.keys(context.toolDisplayNames ?? {})).toHaveLength(entries.length);
    const selected = new Set(context.snapshot.entries.map((entry) => entry.identity.subjectId));
    expect(entries.some((entry) => !selected.has(entry.ref.subjectId))).toBe(true);
    for (const entry of entries) {
      expect(context.tools[entry.toolKey]).toBe(entry.tool);
      expect(context.toolDisplayNames?.[entry.toolKey]).toBe(`server · ${entry.ref.toolName}`);
    }
  });
});

async function callExtension(tools: ReturnType<typeof createExtensionRunContext>["tools"], extensionId: string, input: unknown) {
  return tools.extension_call?.execute?.({ extensionId, input }, options as never);
}

function publishHost(catalogs: ReturnType<typeof createHostCatalogStore>, catalogGeneration: number): void {
  catalogs.publish({
    hostId: HOST,
    label: "Desktop Node",
    protocolVersion: 3,
    catalogSchemaVersion: 2,
    connectionGeneration: 1,
    catalogGeneration,
    publishedAt: "2026-08-18T00:00:00.000Z",
    readiness: "ready",
    capabilities: [{
      capabilityId: "screenshot",
      execution: "read",
      cancellation: "cooperative",
      governance: { descriptorRevision: 1, classifierId: "fixed-risk", classifierRevision: 1 },
    }],
    workspaces: [],
    skills: [],
    mcpServers: [],
  }, {
    hostId: HOST,
    protocolVersion: 3,
    catalogSchemaVersion: 2,
    connectionGeneration: 1,
  });
}

function skillCatalog(generation: () => number): SkillCatalogManager {
  return {
    currentGeneration: generation,
    list: () => [{
      row: { packageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", skillName: "standard-skill", description: "A portable Skill", contentHash: "sha256.skill" },
      root: "unused",
      files: ["SKILL.md"],
    }],
    describe: () => ({ name: "standard-skill", contentRevision: "sha256.skill" }),
  } as unknown as SkillCatalogManager;
}

function skillLoader(): SkillsLoader {
  return {
    renderList: () => "",
    describe: () => ({ name: "standard-skill", contentRevision: "sha256.skill" }),
    load: () => ({ ok: true, content: "Use the existing tool.", contentRevision: "sha256.skill", files: [] }),
  };
}

function allowGovernance(): GovernancePolicyService {
  return { authorize: () => ({ allowed: true }) } as unknown as GovernancePolicyService;
}

function mcpManager(): McpManager {
  const echo = tool({
    description: "Echo text",
    inputSchema: z.strictObject({ text: z.string() }),
    execute: ({ text }) => ({ echo: text }),
  });
  return {
    snapshot: () => [{
      toolKey: "server_echo",
      tool: echo,
      ref: { serverName: "server", toolName: "echo", subjectId: "mcp.subject", subjectRevision: "cfg.hash.r1" },
      serverId: "server-id",
      ownerHostId: CORE,
      configRevision: 1,
      generation: 4,
      isCurrent: () => true,
    }],
  } as unknown as McpManager;
}

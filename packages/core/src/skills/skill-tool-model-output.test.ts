import { describe, expect, it, vi } from "vitest";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createLoadSkillTool } from "./load-skill-tool.ts";
import { createReadSkillResourceTool } from "./read-skill-resource-tool.ts";
import type { SkillLoadResult, SkillsLoader } from "./skills-loader.ts";
import type { SkillCatalogManager } from "./skill-catalog-manager.ts";
import { createHostCatalogStore } from "../hosts/host-catalog.ts";
import { createExtensionRunContext } from "../extensions/extension-run-context.ts";
import { bindCapturedSkillLoad, createToolDisclosure } from "../agents/tool-disclosure.ts";
import type { McpManager } from "../mcp/mcp-manager.ts";

const CORE = "11111111-1111-4111-8111-111111111111";
function fixture(output: SkillLoadResult = { ok: true, content: "Use alpha_query", contentRevision: "revision.alpha", files: ["references/help.md"] }) {
  let generation = 1;
  const loader: SkillsLoader = { renderList: () => "alpha", describe: () => ({ name: "alpha", contentRevision: "revision.alpha" }),
    load: () => output, readResource: () => ({ ok: true, content: "Complete support resource", contentRevision: "revision.resource" }) };
  const catalog = { currentGeneration: () => generation, describe: loader.describe, list: () => [{
    row: { packageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", skillName: "alpha", description: "Alpha Skill", contentHash: "revision.alpha" },
    files: ["SKILL.md", "references/help.md"], root: "unused",
  }] } as unknown as SkillCatalogManager;
  const context = createExtensionRunContext({ runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", coreHostId: CORE,
    catalogs: createHostCatalogStore(), skills: { catalog, loader,
      governance: { authorize: () => ({ allowed: true }) } as unknown as GovernancePolicyService },
    mcp: { snapshot: () => [] } as unknown as McpManager, route: async () => ({ ok: false, code: "NO_HOST" }) });
  const execute = vi.fn(() => ({ useful: "result" }));
  const alphaTools = { alpha_query: tool({ inputSchema: z.strictObject({}), execute }) };
  const tools = bindCapturedSkillLoad({ tools: { ...createLoadSkillTool(loader), ...createReadSkillResourceTool(loader),
    ...context.tools, ...alphaTools }, snapshot: context.toolDisclosure, capturedTools: context.tools });
  return { tools, context, execute, retire: () => { generation += 1; }, bundles: [{ skillName: "alpha", tools: alphaTools }] };
}

describe("Skill model output and current raw disclosure", () => {
  it.each(["load_skill", "extension_call"] as const)("%s omits model revision while raw success activates the exact next-step bundle", async (name) => {
    const f = fixture(); const entry = f.context.snapshot.entries.find((item) => item.callMode === "skill-load")!;
    const input = name === "load_skill" ? { name: "alpha" } : { extensionId: entry.identity.extensionId, input: {} };
    const model = scriptedModel([{ kind: "tool", toolCallId: "load", toolName: name, input },
      { kind: "tool", toolCallId: "query", toolName: "alpha_query", input: {} }, { kind: "text", deltas: ["Done"] }]);
    const disclosure = createToolDisclosure({ tools: f.tools, snapshot: f.context.toolDisclosure, bundles: f.bundles });
    const raw: unknown[] = [];
    const result = streamText({ model, tools: f.tools, prompt: "Use alpha", stopWhen: stepCountIs(3),
      prepareStep: ({ steps }) => ({ activeTools: disclosure.activeTools(steps) }),
      onStepEnd: (step) => { raw.push(...step.toolResults.map((item) => item.output)); } });
    await result.consumeStream();
    expect(model.doStreamCalls[0]?.tools?.map((item) => item.name)).not.toContain("alpha_query");
    expect(model.doStreamCalls[1]?.tools?.map((item) => item.name)).toContain("alpha_query");
    const request = JSON.stringify(model.doStreamCalls[1]?.prompt);
    expect(request).toContain("Use alpha_query"); expect(request).toContain("references/help.md");
    expect(request).not.toContain("revision.alpha"); expect(request).not.toContain("contentRevision");
    expect(JSON.stringify(raw[0])).toContain("revision.alpha");
    if (name === "extension_call") expect(raw[0]).toMatchObject({ ok: true, owner: entry.identity });
    expect(f.execute).toHaveBeenCalledOnce();
  });

  it.each(["stale", "mismatched"] as const)("a %s raw captured load activates no bundle", async (state) => {
    const f = fixture(state === "mismatched" ? { ok: true, content: "Use alpha_query", contentRevision: "replacement", files: [] } : undefined);
    if (state === "stale") f.retire();
    const model = scriptedModel([{ kind: "tool", toolCallId: "load", toolName: "load_skill", input: { name: "alpha" } },
      { kind: "text", deltas: ["Unavailable"] }]);
    const disclosure = createToolDisclosure({ tools: f.tools, snapshot: f.context.toolDisclosure, bundles: f.bundles });
    await streamText({ model, tools: f.tools, prompt: "Use alpha", stopWhen: stepCountIs(2),
      prepareStep: ({ steps }) => ({ activeTools: disclosure.activeTools(steps) }) }).consumeStream();
    expect(model.doStreamCalls[1]?.tools?.map((item) => item.name)).not.toContain("alpha_query");
    if (state === "stale") expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("EXTENSION_STALE_GENERATION");
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("support reads retain full content and raw revision while activating no Skill", async () => {
    const f = fixture(); const model = scriptedModel([{ kind: "tool", toolCallId: "resource", toolName: "read_skill_resource",
      input: { name: "alpha", path: "references/help.md" } }, { kind: "text", deltas: ["Read"] }]);
    const disclosure = createToolDisclosure({ tools: f.tools, snapshot: f.context.toolDisclosure, bundles: f.bundles });
    const raw: unknown[] = [];
    await streamText({ model, tools: f.tools, prompt: "Read support", stopWhen: stepCountIs(2),
      prepareStep: ({ steps }) => ({ activeTools: disclosure.activeTools(steps) }),
      onStepEnd: (step) => { raw.push(...step.toolResults.map((item) => item.output)); } }).consumeStream();
    expect(raw[0]).toMatchObject({ contentRevision: "revision.resource" });
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("Complete support resource");
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).not.toContain("revision.resource");
    expect(model.doStreamCalls[1]?.tools?.map((item) => item.name)).not.toContain("alpha_query");
  });
});

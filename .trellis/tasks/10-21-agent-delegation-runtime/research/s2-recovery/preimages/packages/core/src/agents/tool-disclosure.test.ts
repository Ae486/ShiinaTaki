import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createChatAgent, type ChatAgentDeps } from "./chat-agent.ts";
import type { ToolDisclosureSnapshot } from "../extensions/tool-disclosure-snapshot.ts";
import { estimateToolSchemaTokens } from "./request-measurement.ts";
import type { SkillToolBundle } from "./tool-disclosure.ts";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const fixtures: CompanionFixture[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
const snapshot: ToolDisclosureSnapshot = {
  deferredToolNames: ["native_echo", "native_other"], describedTools: { "ext:echo": "native_echo" },
  skills: { alpha: { extensionId: "ext:alpha", contentRevision: "alpha-v1" }, beta: { extensionId: "ext:beta", contentRevision: "beta-v1" } },
};
const load = (name = "alpha") => ({ kind: "tool" as const, toolCallId: `load-${name}`, toolName: "load_skill", input: { name } });
const answer = { kind: "text" as const, deltas: ["Done"] };
const loaded = { ok: true, content: "Use alpha_query when needed", contentRevision: "alpha-v1", files: [] };

function fixture(model: ReturnType<typeof scriptedModel>, loadOutput: unknown = loaded) {
  const f = createCompanionFixture(); fixtures.push(f);
  const query = vi.fn(async (_input: unknown, options: { toolCallId: string }) => ({ analyses: [], callId: options.toolCallId }));
  const native = vi.fn(async ({ text }: { text: string }) => ({ text }));
  const baseTools = {
    load_skill: tool({ inputSchema: z.object({ name: z.string() }), execute: () => loadOutput }),
    read_skill_resource: tool({ inputSchema: z.object({ name: z.string(), path: z.string() }), execute: () => loaded }),
    extension_describe: tool({ inputSchema: z.object({ extensionId: z.string() }), execute: () => ({
      entry: { identity: { extensionId: "ext:echo" }, available: true }, toolName: "native_echo",
    }) }),
    extension_call: tool({ inputSchema: z.object({ extensionId: z.string(), input: z.unknown() }), execute: () => ({
      ok: true, owner: { extensionId: "ext:alpha" }, output: loadOutput,
    }) }),
  };
  const nativeTools = {
    native_echo: tool({ description: "NATIVE_SCHEMA_SENTINEL", inputSchema: z.object({ text: z.string() }), execute: native }),
    native_other: tool({ inputSchema: z.object({ other: z.string() }), execute: vi.fn() }),
  };
  const bundles: SkillToolBundle[] = [
    { skillName: "alpha", tools: { alpha_query: tool({ description: "ALPHA_SCHEMA_SENTINEL".repeat(100), inputSchema: z.object({}), execute: query }) } },
    { skillName: "beta", tools: { beta_query: tool({ inputSchema: z.object({}), execute: vi.fn() }) } },
  ];
  const measurements: number[] = [];
  const { extension_call, ...extraTools } = baseTools;
  const deps: ChatAgentDeps = { model, store: f.conversation, memory: f.memory, extraTools,
    skillTools: () => bundles, runContext: () => ({ tools: { ...nativeTools, extension_call }, toolDisclosure: snapshot }),
    onRequestMeasured: (_character, measurement) => { measurements.push(measurement.toolSchemaTokens); } };
  return { f, deps, query, native, baseTools, bundles, measurements };
}

async function send(agent: ReturnType<typeof createChatAgent>, message: string) {
  for await (const _chunk of agent.stream({ characterId: "taki", message })) { void _chunk; }
}
function names(model: ReturnType<typeof scriptedModel>, call: number) {
  return model.doStreamCalls[call]?.tools?.map((t) => t.name) ?? [];
}

describe("progressive tool disclosure at the real ToolLoopAgent model boundary", () => {
  it("keeps a trusted execution subset after Skill loading and rejects an omitted tool", async () => {
    const model = scriptedModel([load(), { kind: "tool", toolCallId: "excluded", toolName: "alpha_query", input: {} }, answer]);
    const f = fixture(model); const agent = createChatAgent(f.deps);
    for await (const chunk of agent.stream({ characterId: "taki", message: "Read the Skill" }, {
      turnKind: "non-primary", allowedToolNames: ["load_skill"],
    })) { void chunk; }
    for (let index = 0; index < model.doStreamCalls.length; index += 1) expect(names(model, index)).toEqual(["load_skill"]);
    expect(f.query).not.toHaveBeenCalled();
    expect(f.native).not.toHaveBeenCalled();
    expect(f.f.conversation.history("taki")).toHaveLength(0);
    // The bound loader can use its original closure; the generic extension_call stays unavailable to the model.
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("alpha-v1");
  });

  it("allows a text-only execution without changing a later ordinary turn", async () => {
    const model = scriptedModel([answer, answer]); const f = fixture(model); const agent = createChatAgent(f.deps);
    for await (const chunk of agent.stream({ characterId: "taki", message: "Summarize" }, {
      turnKind: "non-primary", allowedToolNames: [],
    })) { void chunk; }
    await send(agent, "Ordinary conversation");
    expect(names(model, 0)).toEqual([]);
    expect(names(model, 1)).toContain("load_skill");
  });

  it("starts small, reveals only the loaded Skill, preserves history, and resets for the next turn", async () => {
    const model = scriptedModel([answer, load(), { kind: "tool", toolCallId: "query", toolName: "alpha_query", input: {} }, answer, answer]);
    const f = fixture(model); const agent = createChatAgent(f.deps);
    await send(agent, "Hello");
    await send(agent, "Use the alpha Skill to query");
    await send(agent, "Unrelated conversation");
    for (const index of [0, 1, 4]) {
      expect(names(model, index)).not.toContain("alpha_query");
      expect(JSON.stringify(model.doStreamCalls[index]?.tools)).not.toContain("ALPHA_SCHEMA_SENTINEL");
    }
    expect(names(model, 2)).toContain("alpha_query");
    for (const index of [0, 1, 2, 3, 4]) {
      expect(names(model, index)).not.toContain("beta_query");
      expect(names(model, index)).not.toContain("native_echo");
    }
    expect(f.query).toHaveBeenCalledOnce();
    expect(JSON.stringify(model.doStreamCalls[4]?.prompt)).toContain("alpha_query");
    expect(JSON.stringify(f.f.conversation.history("taki"))).toContain("load_skill");
    const initialTools = { ...f.f.memory.createTools("taki"), ...f.baseTools };
    expect(f.measurements[0]).toBe(await estimateToolSchemaTokens(initialTools, Object.keys(initialTools).sort()));
  });

  it.each([
    { ok: false, code: "DISABLED" },
    { ...loaded, contentRevision: "replacement-v2" },
    { ok: true, contentRevision: "alpha-v1" },
  ])("a failed or nonmatching full Skill load does not reveal tools: %j", async (output) => {
    const model = scriptedModel([load(), answer]); const f = fixture(model, output);
    await send(createChatAgent(f.deps), "Use alpha");
    expect(names(model, 1)).not.toContain("alpha_query");
    expect(f.query).not.toHaveBeenCalled();
  });

  it("support-resource reads do not act as full Skill loads", async () => {
    const model = scriptedModel([{ kind: "tool", toolCallId: "resource", toolName: "read_skill_resource", input: { name: "alpha", path: "references/tools.md" } }, answer]);
    const f = fixture(model); await send(createChatAgent(f.deps), "Read the resource");
    expect(names(model, 1)).not.toContain("alpha_query");
  });

  it("reveals the exact described MCP tool on the next step and keeps its execution binding", async () => {
    const model = scriptedModel([
      { kind: "tool", toolCallId: "describe", toolName: "extension_describe", input: { extensionId: "ext:echo" } },
      { kind: "tool", toolCallId: "native", toolName: "native_echo", input: { text: "same captured tool" } }, answer,
    ]);
    const f = fixture(model); await send(createChatAgent(f.deps), "Use the echo extension");
    expect(names(model, 0)).not.toContain("native_echo");
    expect(names(model, 1)).toContain("native_echo");
    expect(names(model, 1)).not.toContain("native_other");
    expect(f.native).toHaveBeenCalledOnce();
    expect(f.native.mock.calls[0]?.[0]).toEqual({ text: "same captured tool" });
  });

  it("does not let a same-step call race ahead of Skill loading", async () => {
    const model = scriptedModel([
      { kind: "tools", calls: [
        { toolCallId: "load", toolName: "load_skill", input: { name: "alpha" } },
        { toolCallId: "too-early", toolName: "alpha_query", input: {} },
      ] },
      { kind: "tool", toolCallId: "on-time", toolName: "alpha_query", input: {} }, answer,
    ]);
    const f = fixture(model); await send(createChatAgent(f.deps), "Load and query");
    expect(f.query).toHaveBeenCalledOnce();
    expect(f.query.mock.calls[0]?.[1]).toMatchObject({ toolCallId: "on-time" });
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("too-early");
    expect(names(model, 1)).toContain("alpha_query");
  });

  it("also recognizes a full load through the captured extension call bridge", async () => {
    const model = scriptedModel([{ kind: "tool", toolCallId: "load", toolName: "extension_call", input: { extensionId: "ext:alpha", input: {} } }, answer]);
    const f = fixture(model); await send(createChatAgent(f.deps), "Load alpha through extensions");
    expect(names(model, 1)).toContain("alpha_query");
    expect(names(model, 1)).not.toContain("beta_query");
  });

  it("does not register a Skill bundle when that Skill was absent from the captured catalog", async () => {
    const model = scriptedModel([load(), answer]); const f = fixture(model);
    f.deps.runContext = () => ({ toolDisclosure: { ...snapshot, skills: {} } });
    await send(createChatAgent(f.deps), "Use alpha");
    expect(names(model, 1)).not.toContain("alpha_query");
  });

  it("uses the captured loading guard rather than a same-name newer compatibility loader", async () => {
    const model = scriptedModel([load(), answer]); const f = fixture(model);
    const currentLoader = vi.fn(() => loaded);
    f.deps.extraTools!.load_skill = tool({ inputSchema: z.object({ name: z.string() }), execute: currentLoader });
    f.deps.runContext = () => ({ toolDisclosure: snapshot, tools: {
      extension_call: tool({ inputSchema: z.object({ extensionId: z.string(), input: z.unknown() }),
        execute: () => ({ ok: false, code: "EXTENSION_STALE_GENERATION" }) }),
    } });
    await send(createChatAgent(f.deps), "Load alpha");
    expect(currentLoader).not.toHaveBeenCalled();
    expect(names(model, 1)).not.toContain("alpha_query");
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("EXTENSION_STALE_GENERATION");
  });

  it("keeps the existing governance decision after disclosure", async () => {
    const model = scriptedModel([load(), { kind: "tool", toolCallId: "query", toolName: "alpha_query", input: {} }, answer]);
    const f = fixture(model);
    f.deps.coreToolGovernance = { wrap: (tools) => Object.fromEntries(Object.entries(tools).map(([name, definition]) =>
      [name, { ...definition, execute: async () => ({ ok: false, code: "FORBIDDEN" }) }])) };
    await send(createChatAgent(f.deps), "Use alpha");
    expect(names(model, 1)).toContain("alpha_query");
    expect(f.query).not.toHaveBeenCalled();
    expect(JSON.stringify(model.doStreamCalls[2]?.prompt)).toContain("FORBIDDEN");
  });

  it("supports permitted non-primary Skill tools without requiring a fabricated user entry", async () => {
    const model = scriptedModel([load(), { kind: "tool", toolCallId: "query", toolName: "alpha_query", input: {} }, answer]);
    const f = fixture(model); const agent = createChatAgent(f.deps);
    for await (const _chunk of agent.stream({ characterId: "taki", message: "Use alpha" }, { turnKind: "non-primary", controlInput: "Use alpha" })) { void _chunk; }
    expect(names(model, 0)).not.toContain("alpha_query");
    expect(names(model, 1)).toContain("alpha_query");
    expect(f.query).toHaveBeenCalledOnce();
    expect(f.f.conversation.history("taki")).toHaveLength(0);
  });

  it("sends only disclosed schemas in actual OpenAI-compatible request bodies", async () => {
    const requests: Array<{ tools?: Array<{ function: { name: string } }> }> = [];
    const provider = createOpenAICompatible({ name: "disclosure-wire", baseURL: "https://fixture.invalid/v1",
      fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        const action = requests.length === 1 ? { name: "load_skill", arguments: '{"name":"alpha"}' }
          : requests.length === 2 ? { name: "alpha_query", arguments: "{}" } : undefined;
        const chunk = { id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture", choices: [{ index: 0,
          delta: action ? { tool_calls: [{ index: 0, id: `call-${requests.length}`, type: "function", function: action }] } : { content: "Done" },
          finish_reason: action ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
      } });
    const f = fixture(scriptedModel([])); f.deps.model = provider("fixture");
    const agent = createChatAgent(f.deps);
    await send(agent, "Query with alpha");
    await send(agent, "An unrelated turn");
    expect(requests).toHaveLength(4);
    const visible = requests.map((request) => request.tools?.map((entry) => entry.function.name) ?? []);
    expect(visible[0]).not.toContain("alpha_query");
    expect(visible[1]).toContain("alpha_query");
    expect(visible[3]).not.toContain("alpha_query");
    expect(visible.flat()).not.toContain("native_echo");
    expect(visible.flat()).not.toContain("beta_query");
    expect(f.query).toHaveBeenCalledOnce();
  });
});

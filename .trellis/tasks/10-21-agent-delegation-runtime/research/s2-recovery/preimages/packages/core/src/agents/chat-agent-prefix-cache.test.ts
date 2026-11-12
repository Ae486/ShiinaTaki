import { afterEach, describe, expect, it, vi } from "vitest";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { createExtensionRegistry } from "../extensions/extension-registry.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createChatAgent, type AgentRunContext } from "./chat-agent.ts";

const RUN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HOST = "11111111-1111-4111-8111-111111111111";
const FIXED_NOW = new Date("2026-08-28T09:30:00.000Z");
const fixtures: CompanionFixture[] = [];
type ProviderCall = ReturnType<typeof scriptedModel>["doStreamCalls"][number];
type ProviderPrompt = ProviderCall["prompt"];
type ProviderTool = NonNullable<ProviderCall["tools"]>[number];

afterEach(() => {
  vi.restoreAllMocks();
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

describe("ChatAgent prompt-prefix cache contract", () => {
  it("keeps system and canonical tool headers identical across execution identities", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW.getTime());
    const firstBinding = vi.fn(async (identity: { runId: string; attemptId: string }) => identity);
    const secondBinding = vi.fn(async (identity: { runId: string; attemptId: string }) => identity);
    const first = await captureRun({ runId: RUN_A, attemptId: "attempt-a", order: ["zulu", "alpha"], binding: firstBinding });
    const second = await captureRun({ runId: RUN_B, attemptId: "attempt-b", order: ["alpha", "zulu"], binding: secondBinding });

    const names = first.tools.map((entry) => entry.name);
    expect(names).toEqual([...names].sort(compareStrings));
    expect(first.tools).toEqual(second.tools);
    expect(first.prompt[0]).toEqual(second.prompt[0]);
    expect(firstBinding).toHaveBeenCalledOnce();
    expect(secondBinding).toHaveBeenCalledOnce();
    expect(firstBinding.mock.calls[0]?.[0]).toEqual({ runId: RUN_A, attemptId: "attempt-a" });
    expect(secondBinding.mock.calls[0]?.[0]).toEqual({ runId: RUN_B, attemptId: "attempt-b" });
  });

  it("strictly append-extends provider messages for a tool continuation within one Run", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW.getTime());
    const fixture = fresh();
    const model = scriptedModel([
      { kind: "tool", toolCallId: "call-alpha", toolName: "alpha", input: {} },
      { kind: "text", deltas: ["done"] },
    ]);
    const agent = createChatAgent({
      model,
      store: fixture.conversation,
      memory: fixture.memory,
      runContext: () => runContext(RUN_A, ["alpha", "zulu"], async () => ({ ok: true })),
    });

    await drain(agent.stream({ characterId: "taki", message: "Use alpha." }, { runId: RUN_A, attemptId: "attempt-a" }));

    const first = model.doStreamCalls[0]!;
    const continuation = model.doStreamCalls[1]!;
    expect(continuation.prompt.slice(0, first.prompt.length)).toEqual(first.prompt);
    expect(continuation.tools).toEqual(first.tools);
    expect(continuation.prompt.length).toBeGreaterThan(first.prompt.length);
  });

  it("keeps the honest cross-Turn prefix through prior plain user text while dropping its old volatile tail", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW.getTime());
    const fixture = fresh();
    const model = scriptedModel([
      { kind: "text", deltas: ["first reply"] },
      { kind: "text", deltas: ["second reply"] },
    ]);
    const agent = createChatAgent({ model, store: fixture.conversation, memory: fixture.memory });

    await drain(agent.stream({ characterId: "taki", message: "first user text" }, { runId: RUN_A, attemptId: "attempt-a" }));
    now.mockReturnValue(FIXED_NOW.getTime() + 60_000);
    await drain(agent.stream({ characterId: "taki", message: "second user text" }, { runId: RUN_B, attemptId: "attempt-b" }));

    const first = model.doStreamCalls[0]!;
    const second = model.doStreamCalls[1]!;
    const firstUser = textContent(first.prompt[1]!);
    const replayedFirstUser = textContent(second.prompt[1]!);
    expect(first.prompt[0]).toEqual(second.prompt[0]);
    expect(first.tools).toEqual(second.tools);
    expect(firstUser.startsWith(replayedFirstUser)).toBe(true);
    expect(replayedFirstUser).toBe("first user text");
    expect(firstUser).toContain("<turn-context>");
    expect(replayedFirstUser).not.toContain("<turn-context>");
  });
});

async function captureRun(input: {
  runId: string;
  attemptId: string;
  order: string[];
  binding: (identity: { runId: string; attemptId: string }) => Promise<unknown>;
}): Promise<{ prompt: ProviderPrompt; tools: ProviderTool[] }> {
  const fixture = fresh();
  const model = scriptedModel([
    { kind: "tool", toolCallId: `call-${input.runId}`, toolName: "alpha", input: {} },
    { kind: "text", deltas: ["done"] },
  ]);
  const agent = createChatAgent({
    model,
    store: fixture.conversation,
    memory: fixture.memory,
    runContext: () => runContext(input.runId, input.order, () => input.binding({ runId: input.runId, attemptId: input.attemptId })),
  });
  await drain(agent.stream({ characterId: "taki", message: "same semantic request" }, { runId: input.runId, attemptId: input.attemptId }));
  const call = model.doStreamCalls[0]!;
  return { prompt: call.prompt, tools: call.tools ?? [] };
}

function runContext(runId: string, order: string[], execute: () => Promise<unknown>): AgentRunContext {
  const registry = createExtensionRegistry({
    runId,
    primaryHostId: HOST,
    hosts: [{ hostId: HOST, available: true, connectionGeneration: 1, catalogGeneration: 1, extensionCount: 0 }],
    candidates: [],
  });
  const tools: ToolSet = {};
  for (const name of order) {
    tools[name] = tool({ description: `${name} cache fixture`, inputSchema: z.object({}), execute: name === "alpha" ? execute : async () => ({ ok: true }) });
  }
  return { tools, instructions: registry.renderContext() };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function textContent(message: ProviderPrompt[number]): string {
  if (message.role !== "user") throw new Error(`expected user message, got ${message.role}`);
  return message.content.map((part) => part.type === "text" ? part.text : "").join("");
}

function fresh(): CompanionFixture {
  const fixture = createCompanionFixture();
  fixtures.push(fixture);
  return fixture;
}

async function drain(stream: AsyncIterable<string>): Promise<void> {
  for await (const delta of stream) void delta;
}

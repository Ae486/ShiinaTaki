import { afterEach, describe, expect, it, vi } from "vitest";
import { APICallError, ToolLoopAgent, isStepCount, tool } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { createChatAgent } from "./chat-agent.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { midStreamErrorModel } from "../testing/mock-language-model.ts";

const fixtures: CompanionFixture[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const fixture of fixtures.splice(0)) fixture.cleanup(); });

function chunk(delta: unknown, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({ id: "wire-fixture", object: "chat.completion.chunk", created: 0, model: "fixture",
    choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
}

function call(index: number, id: string, input: { arguments: string; name?: string }) {
  return { index, id, type: "function", function: input };
}

function wireModel(firstResponse: string) {
  const requests: Array<{ messages: Array<{ role: string; content: string | null }> }> = [];
  const provider = createOpenAICompatible({ name: "compatibility-wire", baseURL: "https://fixture.invalid/v1",
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const body = requests.length === 1 ? firstResponse : chunk({ content: "Done" }, "stop");
      return new Response(body + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    } });
  return { model: provider("fixture"), requests };
}

async function run(firstResponse: string, schema: z.ZodType = z.number()) {
  const fixture = createCompanionFixture(); fixtures.push(fixture);
  const wire = wireModel(firstResponse);
  const execute = vi.fn(async (input: unknown) => ({ ok: true, input }));
  const agent = createChatAgent({ model: wire.model, store: fixture.conversation, memory: fixture.memory,
    extraTools: { probe: tool({ description: "Fixture", inputSchema: schema, execute }) } });
  for await (const delta of agent.stream({ characterId: "taki", message: "Run the fixture" })) void delta;
  return { fixture, execute, requests: wire.requests };
}

describe("existing SDK consumers over actual compatible-provider SSE", () => {
  it("preserves the exact provider exception without SDK console disclosure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new APICallError({ message: "Private fixture failure", url: "https://fixture.invalid/v1",
      requestBodyValues: { privatePrompt: "must-not-log" }, statusCode: 401, responseBody: "private response" });
    const fixture = createCompanionFixture(); fixtures.push(fixture);
    const agent = createChatAgent({ model: midStreamErrorModel([], error), store: fixture.conversation, memory: fixture.memory });
    const consumed = (async () => { for await (const delta of agent.stream({ characterId: "taki", message: "Fixture" })) void delta; })();
    await expect(consumed).rejects.toBe(error);
    expect(consoleError).not.toHaveBeenCalled();
  });
  it("executes only the complete final argument when a JSON number prefix is already parseable", async () => {
    const firstResponse = chunk({ tool_calls: [call(0, "number", { arguments: "1", name: "probe" })] })
      + chunk({ tool_calls: [call(0, "number", { arguments: "2" })] }, "tool_calls");
    const { execute, requests } = await run(firstResponse);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toBe(12);
    expect(requests).toHaveLength(2);
    const result = requests[1]?.messages.find(message => message.role === "tool");
    expect(JSON.parse(result?.content ?? "null")).toEqual({ ok: true, input: 12 });
  });

  it("keeps distinct invocations and ordered replay for repeated wire IDs and noncontiguous indexes", async () => {
    const firstResponse = chunk({ tool_calls: [call(4, "repeated", { arguments: "1", name: "probe" }), call(9, "repeated", { arguments: "2", name: "probe" })] }, "tool_calls");
    const { execute, fixture } = await run(firstResponse);
    expect(execute.mock.calls.map(([input]) => input)).toEqual([1, 2]);
    const results = fixture.conversation.history("taki").filter(message => message.role === "tool")
      .flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => part.type === "tool-result");
    expect(results).toHaveLength(2);
    expect(new Set(results.map(part => part.toolCallId)).size).toBe(2);
    expect(results.map(part => part.output)).toEqual([
      { type: "json", value: { ok: true, input: 1 } }, { type: "json", value: { ok: true, input: 2 } },
    ]);
  });

  it.each(["length", "content_filter", "error", "unexpected"])("does not execute proposed tools on finish_reason=%s", async finishReason => {
    const { execute, fixture } = await run(chunk({ tool_calls: [call(0, "unsafe", { arguments: "1", name: "probe" })] }, finishReason));
    expect(execute).not.toHaveBeenCalled();
    const toolRows = fixture.conversation.history("taki").filter(message => message.role === "tool");
    expect(toolRows).toEqual([]);
  });

  it("settles aggregate results and closes iteration after abort even when the provider cancel promise stalls", async () => {
    const abort = new AbortController();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const provider = createOpenAICompatible({ name: "abort-wire", baseURL: "https://fixture.invalid/v1",
      fetch: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode(chunk({ content: "partial" }))); }, cancel,
      }), { headers: { "content-type": "text/event-stream" } }) });
    const agent = new ToolLoopAgent({ model: provider("fixture"), stopWhen: isStepCount(1) });
    const result = await agent.stream({ prompt: "Fixture", abortSignal: abort.signal });
    const aggregates = Promise.allSettled([result.text, result.totalUsage, result.steps, result.responseMessages]);
    const consumed = (async () => {
      for await (const part of result.fullStream) if (part.type === "text-delta") abort.abort("fixture cancel");
    })();
    const settled = await Promise.race([
      Promise.all([aggregates, consumed]),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("abort results did not settle")), 1000).unref()),
    ]);
    expect(settled[0]).toHaveLength(4);
    expect(settled[0].every(result => result.status === "rejected")).toBe(true);
    expect(abort.signal.reason).toBe("fixture cancel");
  });
});

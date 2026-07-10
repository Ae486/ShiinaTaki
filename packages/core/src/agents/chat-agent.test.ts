import { afterEach, describe, expect, it } from "vitest";
import { APICallError } from "ai";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { failingMockModel, midStreamErrorModel, streamingMockModel } from "../testing/mock-language-model.ts";
import { createChatAgent } from "./chat-agent.ts";

const fixtures: CompanionFixture[] = [];
function fresh(): CompanionFixture {
  const f = createCompanionFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

async function drain(stream: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const delta of stream) text += delta;
  return text;
}

describe("createChatAgent", () => {
  it("streams the model's text deltas in order", async () => {
    const f = fresh();
    const agent = createChatAgent({ model: streamingMockModel(["Hel", "lo ", "you"]), store: f.conversation, memory: f.memory });

    const deltas: string[] = [];
    for await (const delta of agent.stream({ characterId: "taki", message: "hi" })) deltas.push(delta);

    expect(deltas).toEqual(["Hel", "lo ", "you"]);
  });

  it("carries prior user and assistant turns into the next call, behind the assembled system prompt", async () => {
    const f = fresh();
    const model = streamingMockModel(["ok"]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory });

    await drain(agent.stream({ characterId: "taki", message: "first" }));
    await drain(agent.stream({ characterId: "taki", message: "second" }));

    expect(model.doStreamCalls).toHaveLength(2);
    const secondPrompt = model.doStreamCalls[1]?.prompt ?? [];
    // Instructions ride as a leading system message; the conversation turns follow.
    expect(secondPrompt[0]?.role).toBe("system");
    expect(secondPrompt.filter((m) => m.role !== "system").map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const serialized = JSON.stringify(secondPrompt);
    expect(serialized).toContain("first");
    expect(serialized).toContain("ok");
    expect(serialized).toContain("second");
  });

  it("keeps a separate, clean history per character", async () => {
    const f = fresh();
    const model = streamingMockModel(["ok"]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory });

    await drain(agent.stream({ characterId: "taki", message: "hello taki" }));
    await drain(agent.stream({ characterId: "yui", message: "hello yui" }));

    const secondPrompt = model.doStreamCalls[1]?.prompt ?? [];
    expect(secondPrompt.filter((m) => m.role !== "system").map((m) => m.role)).toEqual(["user"]);
    expect(JSON.stringify(secondPrompt)).not.toContain("hello taki");
  });

  it("propagates a provider failure out of the iterator", async () => {
    const f = fresh();
    const agent = createChatAgent({
      model: failingMockModel(
        new APICallError({
          message: "Invalid API key",
          url: "https://api.example.com/chat/completions",
          requestBodyValues: {},
          statusCode: 401,
          isRetryable: false,
        }),
      ),
      store: f.conversation,
      memory: f.memory,
    });

    const caught = await drain(agent.stream({ characterId: "taki", message: "hi" })).then(
      () => null,
      (error: unknown) => error,
    );

    expect(APICallError.isInstance(caught)).toBe(true);
  });

  it("propagates a mid-stream error part and persists no assistant turn", async () => {
    const f = fresh();
    const agent = createChatAgent({ model: midStreamErrorModel(["par"], new Error("mid-stream boom")), store: f.conversation, memory: f.memory });

    const caught = await drain(agent.stream({ characterId: "taki", message: "hi" })).then(
      () => null,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("mid-stream boom");
    // The user turn is recorded; the failed assistant turn must NOT be persisted (no partial row).
    expect(f.conversation.history("taki").map((m) => m.role)).toEqual(["user"]);
  });
});

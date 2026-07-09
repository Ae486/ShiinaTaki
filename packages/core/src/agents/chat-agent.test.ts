import { describe, expect, it } from "vitest";
import { APICallError } from "ai";
import { createMemoryStore } from "../testing/memory-store.ts";
import { failingMockModel, midStreamErrorModel, streamingMockModel } from "../testing/mock-language-model.ts";
import { createChatAgent } from "./chat-agent.ts";

async function drain(stream: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const delta of stream) text += delta;
  return text;
}

describe("createChatAgent", () => {
  it("streams the model's text deltas in order", async () => {
    const agent = createChatAgent({ model: streamingMockModel(["Hel", "lo ", "you"]), store: createMemoryStore().store });

    const deltas: string[] = [];
    for await (const delta of agent.stream({ characterId: "taki", message: "hi" })) {
      deltas.push(delta);
    }

    expect(deltas).toEqual(["Hel", "lo ", "you"]);
  });

  it("carries prior user and assistant turns into the next call for the same character", async () => {
    const model = streamingMockModel(["ok"]);
    const agent = createChatAgent({ model, store: createMemoryStore().store });

    await drain(agent.stream({ characterId: "taki", message: "first" }));
    await drain(agent.stream({ characterId: "taki", message: "second" }));

    expect(model.doStreamCalls).toHaveLength(2);
    const secondPrompt = model.doStreamCalls[1]?.prompt ?? [];
    expect(secondPrompt.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const serialized = JSON.stringify(secondPrompt);
    expect(serialized).toContain("first");
    expect(serialized).toContain("ok");
    expect(serialized).toContain("second");
  });

  it("keeps a separate, clean history per character", async () => {
    const model = streamingMockModel(["ok"]);
    const agent = createChatAgent({ model, store: createMemoryStore().store });

    await drain(agent.stream({ characterId: "taki", message: "hello taki" }));
    await drain(agent.stream({ characterId: "yui", message: "hello yui" }));

    const secondPrompt = model.doStreamCalls[1]?.prompt ?? [];
    expect(secondPrompt.map((m) => m.role)).toEqual(["user"]);
    expect(JSON.stringify(secondPrompt)).not.toContain("hello taki");
  });

  it("propagates a provider failure out of the iterator", async () => {
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
      store: createMemoryStore().store,
    });

    const caught = await drain(agent.stream({ characterId: "taki", message: "hi" })).then(
      () => null,
      (error: unknown) => error,
    );

    expect(APICallError.isInstance(caught)).toBe(true);
  });

  it("propagates a mid-stream error part and persists no assistant turn", async () => {
    // ai@7 textStream would swallow this error and finish silently; fullStream surfaces it as an
    // `error` part which the loop rethrows. This test fails if the loop reverts to textStream.
    const memory = createMemoryStore();
    const agent = createChatAgent({ model: midStreamErrorModel(["par"], new Error("mid-stream boom")), store: memory.store });

    const caught = await drain(agent.stream({ characterId: "taki", message: "hi" })).then(
      () => null,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("mid-stream boom");
    // The user turn is recorded; the failed assistant turn must NOT be persisted (no partial row).
    expect(memory.store.history("taki").map((m) => m.role)).toEqual(["user"]);
  });
});

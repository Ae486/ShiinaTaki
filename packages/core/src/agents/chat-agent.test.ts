import { afterEach, describe, expect, it } from "vitest";
import { APICallError } from "ai";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { abortRejectingModel, failingMockModel, midStreamErrorModel, slowStreamingModel, streamingMockModel } from "../testing/mock-language-model.ts";
import { createChatAgent, type TurnContext } from "./chat-agent.ts";

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

  it("propagates a mid-stream error part and persists the already-streamed partial text (D1 #5)", async () => {
    const f = fresh();
    const agent = createChatAgent({ model: midStreamErrorModel(["par"], new Error("mid-stream boom")), store: f.conversation, memory: f.memory });

    const caught = await drain(agent.stream({ characterId: "taki", message: "hi" })).then(
      () => null,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("mid-stream boom");
    // The user already saw "par" stream by — the transcript must not lose it (gap #5); the error still propagates.
    expect(f.conversation.history("taki")).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "par" },
    ]);
  });

  it("fires the auto-memory trigger after the turn, without blocking the turn's resolution (T9)", async () => {
    const f = fresh();
    let released!: () => void;
    const gate = new Promise<void>((resolve) => {
      released = resolve;
    });
    const order: string[] = [];
    // The trigger's work only completes when we release the gate — proving the turn resolves independently.
    const autoMemory = {
      onTurnCompleted(characterId: string): Promise<void> {
        order.push(`trigger:${characterId}`);
        return gate.then(() => void order.push("auto-write-done"));
      },
    };
    const agent = createChatAgent({ model: streamingMockModel(["hi"]), store: f.conversation, memory: f.memory, autoMemory });

    await drain(agent.stream({ characterId: "taki", message: "hello" }));

    // Turn is done and the trigger was invoked, but the (gated) auto-write has NOT finished yet.
    expect(order).toEqual(["trigger:taki"]);
    released();
    await gate;
    expect(order).toEqual(["trigger:taki", "auto-write-done"]);
  });

  // A cancellable turn handle: records whether onRetract fired and carries the abort signal.
  function cancellableTurn(controller: AbortController, onRetract: () => void): TurnContext {
    return { notify: () => undefined, onClose: () => undefined, signal: controller.signal, onRetract };
  }

  // Records each characterId the detached auto-write fires for (so a test can assert it did / did not run).
  function recordingAutoMemory(seen: string[]) {
    return {
      onTurnCompleted(characterId: string): Promise<void> {
        seen.push(characterId);
        return Promise.resolve();
      },
    };
  }

  it("cancel before any output retracts the user row and fires NEITHER auto-write (nothing persisted)", async () => {
    const f = fresh();
    const auto: string[] = [];
    const controller = new AbortController();
    let retracted = false;
    const agent = createChatAgent({
      model: slowStreamingModel(["a", "b", "c"], 30),
      store: f.conversation,
      memory: f.memory,
      autoMemory: recordingAutoMemory(auto),
    });

    // Abort BEFORE the first (30ms) chunk lands — the turn produces nothing.
    setTimeout(() => controller.abort("turn cancelled by operator"), 5);
    const deltas: string[] = [];
    for await (const delta of agent.stream({ characterId: "taki", message: "hi" }, cancellableTurn(controller, () => (retracted = true)))) {
      deltas.push(delta);
    }

    expect(deltas).toEqual([]);
    expect(retracted).toBe(true); // the pump is told to restore the draft
    expect(f.conversation.history("taki")).toEqual([]); // the user row was retracted, nothing else persisted
    expect(auto).toEqual([]); // a retracted turn never enters memory
  });

  it("cancel after partial text keeps the stop path: partial persisted, no retract, autoMemory fires", async () => {
    const f = fresh();
    const auto: string[] = [];
    const controller = new AbortController();
    let retracted = false;
    const agent = createChatAgent({
      model: slowStreamingModel(["par", "tial", "more"], 30),
      store: f.conversation,
      memory: f.memory,
      autoMemory: recordingAutoMemory(auto),
    });

    const deltas: string[] = [];
    for await (const delta of agent.stream({ characterId: "taki", message: "hi" }, cancellableTurn(controller, () => (retracted = true)))) {
      deltas.push(delta);
      if (deltas.length === 1) controller.abort("turn cancelled by operator"); // abort AFTER the first delta streamed
    }

    expect(deltas).toEqual(["par"]);
    expect(retracted).toBe(false); // partial text exists → stop, not retract
    // The user saw "par" — the transcript keeps it (stop path is byte-identical to today).
    expect(f.conversation.history("taki")).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "par" },
    ]);
    expect(auto).toEqual(["taki"]); // the stop path still fires the auto-write
  });

  // The THROW ending (the common prefill-cancel timing): the transport rejects the read with our string abort reason,
  // which fails the SDK's isAbortError, so the stream errors and the for-await throws instead of ending gracefully.
  it("throw-ending cancel before any output still retracts (transport rejects with the string reason)", async () => {
    const f = fresh();
    const auto: string[] = [];
    const controller = new AbortController();
    let retracted = false;
    const agent = createChatAgent({
      model: abortRejectingModel(["a", "b", "c"], 40),
      store: f.conversation,
      memory: f.memory,
      autoMemory: recordingAutoMemory(auto),
    });

    // Abort BEFORE the first (40ms) chunk — the read rejects → SDK errors the stream → the for-await would throw,
    // but the retract seam swallows the cancel echo, so this loop ends WITHOUT throwing.
    setTimeout(() => controller.abort("turn cancelled by operator"), 5);
    const deltas: string[] = [];
    let threw = false;
    try {
      for await (const delta of agent.stream({ characterId: "taki", message: "hi" }, cancellableTurn(controller, () => (retracted = true)))) {
        deltas.push(delta);
      }
    } catch {
      threw = true;
    }

    expect(threw).toBe(false); // the cancel echo was swallowed by the retract
    expect(deltas).toEqual([]);
    expect(retracted).toBe(true);
    expect(f.conversation.history("taki")).toEqual([]); // the user row was retracted
    expect(auto).toEqual([]); // a retracted turn never enters memory
  });

  it("throw-ending cancel after partial text rethrows and keeps the partial (stop, matches old runtime)", async () => {
    const f = fresh();
    const auto: string[] = [];
    const controller = new AbortController();
    let retracted = false;
    const agent = createChatAgent({
      model: abortRejectingModel(["par", "tial", "more"], 40),
      store: f.conversation,
      memory: f.memory,
      autoMemory: recordingAutoMemory(auto),
    });

    const deltas: string[] = [];
    let threw: unknown = null;
    try {
      for await (const delta of agent.stream({ characterId: "taki", message: "hi" }, cancellableTurn(controller, () => (retracted = true)))) {
        deltas.push(delta);
        if (deltas.length === 1) controller.abort("turn cancelled by operator"); // abort AFTER the first delta
      }
    } catch (error) {
      threw = error;
    }

    expect(deltas).toEqual(["par"]);
    expect(String(threw)).toContain("turn cancelled by operator"); // the reason propagates → pump maps it to chat.error
    expect(retracted).toBe(false); // partial text exists → stop, not retract
    expect(f.conversation.history("taki")).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "par" },
    ]);
    expect(auto).toEqual([]); // the throw ending skips the detached auto-write (pre-existing runtime behavior)
  });
});

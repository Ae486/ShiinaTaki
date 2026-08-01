import { afterEach, describe, expect, it, vi } from "vitest";
import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createConversationStore } from "./conversation-store.ts";
import { createWindowCalibrator } from "./window-calibrator.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createWindowStateRepo } from "../db/window-state-repo.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { errorPartThenStreamModel, failingMockModel, failThenStreamModel, midStreamErrorModel } from "../testing/mock-language-model.ts";
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

/** The canonical openai-compatible overflow body (verbatim OpenAI/DeepSeek family — see overflow-error.ts sources). */
function overflowError(requested: number): APICallError {
  return new APICallError({
    message:
      `This model's maximum context length is 65536 tokens. However, you requested ${requested} tokens ` +
      `(${requested} in the messages, 0 in the completion). Please reduce the length of the messages or completion.`,
    url: "https://gw.example.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 400,
    responseBody: '{"error":{"type":"invalid_request_error","code":"context_length_exceeded"}}',
    isRetryable: false,
  });
}

describe("chat-agent R2 overflow retry (batch 6, TDD row 10)", () => {
  it("retries ONCE on a first-request overflow arriving as an error part (graceful transport ending)", async () => {
    const f = fresh();
    const onOverflow = vi.fn();
    const model = errorPartThenStreamModel(overflowError(70000), ["ok"]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory, onOverflow });

    await expect(drain(agent.stream({ characterId: "taki", message: "hi" }))).resolves.toBe("ok");

    // Recalibrated with the provider-reported request size, exactly once; the turn persisted exactly once.
    expect(onOverflow).toHaveBeenCalledExactlyOnceWith(70000);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(f.conversation.history("taki")).toHaveLength(2);
  });

  it("retries ONCE on a first-request overflow that REJECTS the model call (thrown transport ending)", async () => {
    const f = fresh();
    const onOverflow = vi.fn();
    const model = failThenStreamModel(overflowError(70000), ["ok"]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory, onOverflow });

    await expect(drain(agent.stream({ characterId: "taki", message: "hi" }))).resolves.toBe("ok");

    expect(onOverflow).toHaveBeenCalledExactlyOnceWith(70000);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(f.conversation.history("taki")).toHaveLength(2);
  });

  it("falls back to the request's own estimate when the error body names no requested count", async () => {
    const f = fresh();
    const onOverflow = vi.fn();
    // vLLM's engine-path phrasing carries ONLY the limit — the classifier matches, the parse yields undefined.
    const limitOnly = new APICallError({
      message: "This model's context length is only 4096 tokens.",
      url: "https://gw.example.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 400,
      isRetryable: false,
    });
    const agent = createChatAgent({ model: errorPartThenStreamModel(limitOnly, ["ok"]), store: f.conversation, memory: f.memory, onOverflow });

    await expect(drain(agent.stream({ characterId: "taki", message: "hi" }))).resolves.toBe("ok");

    expect(onOverflow).toHaveBeenCalledOnce();
    const observed = onOverflow.mock.calls[0]?.[0] as number;
    expect(Number.isInteger(observed)).toBe(true);
    expect(observed).toBeGreaterThan(0);
  });

  it("re-windows the retry through the store and persists the recalibration (window-state row shrunk)", async () => {
    const f = fresh();
    const stateRepo = createWindowStateRepo(f.db);
    const calibrator = createWindowCalibrator({ repo: stateRepo, slot: "main", declared: 400 });
    // A second store over the same db, wired like main.ts: history budget = effectiveWindow × ratio, re-read per call.
    const store = createConversationStore({
      repo: createTimelineRepo(f.db),
      window: { budget: () => Math.floor(calibrator.effectiveWindow() * 0.55) },
    });
    for (let i = 0; i < 10; i += 1) {
      store.appendUser("taki", `question number ${i} padded with some words`);
      store.appendAssistant("taki", `answer number ${i} padded with some words`);
    }
    const model = errorPartThenStreamModel(overflowError(300), ["ok"]);
    const agent = createChatAgent({ model, store, memory: f.memory, onOverflow: (observed) => void calibrator.onOverflow(observed) });

    await expect(drain(agent.stream({ characterId: "taki", message: "hi" }))).resolves.toBe("ok");

    // The retry's request was rebuilt under the shrunken budget: strictly fewer replayed messages.
    const first = model.doStreamCalls[0]?.prompt.length ?? 0;
    const second = model.doStreamCalls[1]?.prompt.length ?? 0;
    expect(second).toBeLessThan(first);
    expect(second).toBeGreaterThan(0);
    // R2's persistence: floor(300 × 0.9) = 270, visible to a later boot through the repo row.
    expect(stateRepo.get("main")).toMatchObject({ effectiveWindow: 270 });
  });

  it("propagates a second overflow (retry budget is ONE; recalibration fired once)", async () => {
    const f = fresh();
    const onOverflow = vi.fn();
    const model = failingMockModel(overflowError(70000)); // fails EVERY call
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory, onOverflow });

    const caught = await drain(agent.stream({ characterId: "taki", message: "hi" })).then(
      () => null,
      (error: unknown) => error,
    );

    expect(APICallError.isInstance(caught)).toBe(true);
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("never retries once partial text was yielded (the user saw it; D1 #5 partial persist still holds)", async () => {
    const f = fresh();
    const onOverflow = vi.fn();
    const agent = createChatAgent({ model: midStreamErrorModel(["par"], overflowError(70000)), store: f.conversation, memory: f.memory, onOverflow });

    const caught = await drain(agent.stream({ characterId: "taki", message: "hi" })).then(
      () => null,
      (error: unknown) => error,
    );

    expect(APICallError.isInstance(caught)).toBe(true);
    expect(onOverflow).not.toHaveBeenCalled();
    expect(f.conversation.history("taki")).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "par" },
    ]);
  });

  it("never retries after a COMPLETED step (a tool may have acted — re-running could act twice)", async () => {
    const f = fresh();
    const onOverflow = vi.fn();
    let calls = 0;
    // Transport-faithful two-call script: step 1 completes a real memory_search tool round-trip, then the step-2
    // request overflows — the hazard case the step guard exists for.
    const model = new MockLanguageModelV4({
      doStream: async () => {
        calls += 1;
        if (calls > 1) throw overflowError(70000);
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              { type: "tool-call" as const, toolCallId: "c1", toolName: "memory_search", input: JSON.stringify({ query: "拉面" }) },
              {
                type: "finish" as const,
                finishReason: { unified: "tool-calls" as const, raw: undefined },
                usage: { inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } },
              },
            ],
          }),
        };
      },
    });
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory, onOverflow });

    const caught = await drain(agent.stream({ characterId: "taki", message: "还记得吗" })).then(
      () => null,
      (error: unknown) => error,
    );

    expect(APICallError.isInstance(caught)).toBe(true);
    expect(onOverflow).not.toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(2); // no third call — the retry was refused, not consumed
  });

  it("never retries a non-overflow provider error", async () => {
    const f = fresh();
    const onOverflow = vi.fn();
    const auth = new APICallError({
      message: "Invalid API key",
      url: "https://gw.example.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 401,
      isRetryable: false,
    });
    const agent = createChatAgent({ model: failThenStreamModel(auth, ["never"]), store: f.conversation, memory: f.memory, onOverflow });

    const caught = await drain(agent.stream({ characterId: "taki", message: "hi" })).then(
      () => null,
      (error: unknown) => error,
    );

    expect(APICallError.isInstance(caught)).toBe(true);
    expect(onOverflow).not.toHaveBeenCalled();
  });

  it("without the onOverflow dep an overflow propagates exactly as today (absent seam = byte-identical)", async () => {
    const f = fresh();
    const model = errorPartThenStreamModel(overflowError(70000), ["never"]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory });

    const caught = await drain(agent.stream({ characterId: "taki", message: "hi" })).then(
      () => null,
      (error: unknown) => error,
    );

    expect(APICallError.isInstance(caught)).toBe(true);
    expect(model.doStreamCalls).toHaveLength(1);
  });
});

/**
 * INPUT:  scripted text deltas, or an error to raise on the model call
 * OUTPUT: streamingMockModel(deltas) / failingMockModel(error) -> MockLanguageModelV4
 * POS:    core/testing — test-only factories (research/ai-sdk-v7-api.md §3); never imported by production code
 */
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

const USAGE = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** A mock model that streams the given text deltas and finishes, on every call. */
export function streamingMockModel(deltas: string[]): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start" as const, id: "t1" },
          ...deltas.map((delta) => ({ type: "text-delta" as const, id: "t1", delta })),
          { type: "text-end" as const, id: "t1" },
          { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage: USAGE },
        ],
      }),
    }),
  });
}

/** A mock model whose call rejects — simulates a provider failure. */
export function failingMockModel(error: unknown): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw error;
    },
  });
}

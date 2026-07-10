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

/**
 * A mock model that streams some deltas and then emits a mid-stream `error` part (no finish).
 * In ai@7 this error is swallowed by `textStream` but delivered as an `{type:"error"}` part on
 * `fullStream`/`stream` — the reason the chat loop must iterate the full stream (see research addendum).
 */
export function midStreamErrorModel(deltas: string[], error: unknown): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start" as const, id: "t1" },
          ...deltas.map((delta) => ({ type: "text-delta" as const, id: "t1", delta })),
          { type: "error" as const, error },
        ],
      }),
    }),
  });
}

/**
 * A scripted multi-step model for tool-loop tests (research/ai-sdk-v7-tools.md §5): `doStream` is an ARRAY, one
 * fresh stream per LLM call. A tool step ends with finishReason `tool-calls` (which continues the loop); its
 * `input` is a JSON STRING (the provider-level shape). Never reuse a consumed simulateReadableStream — each step
 * builds its own. Total LLM calls across the run must not exceed steps.length.
 */
export type ScriptStep =
  | { kind: "text"; deltas: string[] }
  | { kind: "tool"; toolCallId: string; toolName: string; input: unknown };

export function scriptedModel(steps: ScriptStep[]): MockLanguageModelV4 {
  return new MockLanguageModelV4({ doStream: steps.map(stepToResult) });
}

function stepToResult(step: ScriptStep) {
  if (step.kind === "tool") {
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "tool-call" as const, toolCallId: step.toolCallId, toolName: step.toolName, input: JSON.stringify(step.input) },
          { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: undefined }, usage: USAGE },
        ],
      }),
    };
  }
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        { type: "text-start" as const, id: "t1" },
        ...step.deltas.map((delta) => ({ type: "text-delta" as const, id: "t1", delta })),
        { type: "text-end" as const, id: "t1" },
        { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage: USAGE },
      ],
    }),
  };
}

/**
 * INPUT:  scripted text deltas, or an error to raise on the model call
 * OUTPUT: streamingMockModel / slowStreamingModel / abortRejectingModel / failingMockModel / midStreamErrorModel /
 *         scriptedModel (stream) + generatingModel / failingGenerateModel / scriptedGenerateModel (generate) -> MockLanguageModelV4
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

/** Like streamingMockModel but with a per-chunk delay — gives an abort signal room to land mid-stream. */
export function slowStreamingModel(deltas: string[], chunkDelayInMs: number): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunkDelayInMs,
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

/**
 * Transport-faithful cancel: on abort it ERRORS the model stream with the raw (string) reason — mirroring undici
 * rejecting the in-flight body read with `signal.reason`. That string fails the SDK's isAbortError name check, so the
 * SDK errors the stream and the chat loop's for-await THROWS the reason. This is the prefill-cancel ending that
 * simulateReadableStream cannot reproduce (its reads always resolve, always taking the graceful abort branch). Deltas
 * arrive on a timer so a cancel can be timed before the first (throw-ending retract) or after it (throw-ending stop).
 */
export function abortRejectingModel(deltas: string[], chunkDelayInMs: number): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start" as const, warnings: [] });
          controller.enqueue({ type: "text-start" as const, id: "t1" });
          let i = 0;
          const timer = setInterval(() => {
            const delta = deltas[i];
            i += 1;
            if (delta !== undefined) {
              controller.enqueue({ type: "text-delta" as const, id: "t1", delta });
            } else {
              clearInterval(timer);
              controller.enqueue({ type: "text-end" as const, id: "t1" });
              controller.enqueue({ type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage: USAGE });
              controller.close();
            }
          }, chunkDelayInMs);
          // undici rejects the body read with signal.reason verbatim — reproduce that as a stream error.
          abortSignal?.addEventListener("abort", () => {
            clearInterval(timer);
            controller.error(abortSignal.reason);
          }, { once: true });
        },
      });
      return { stream } as Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
    },
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
 *
 * The `textTool` variant emits text AND a tool call in ONE step (finishReason `tool-calls`) — the shape a real model
 * uses when it speaks and emotes together, which plain `text`/`tool` steps cannot express (they are separate steps).
 */
export type ScriptStep =
  | { kind: "text"; deltas: string[] }
  | { kind: "tool"; toolCallId: string; toolName: string; input: unknown }
  | { kind: "textTool"; deltas: string[]; toolCallId: string; toolName: string; input: unknown };

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
  if (step.kind === "textTool") {
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "t1" },
          ...step.deltas.map((delta) => ({ type: "text-delta" as const, id: "t1", delta })),
          { type: "text-end" as const, id: "t1" },
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

// --- Non-streaming generate path (ai@7 agent.generate -> doGenerate). GenerateTextResult.text = final-step text. ---

/** A mock whose single generate() returns the given text (episodic summarizer: text is a JSON summaries payload). */
export function generatingModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => generateResult([{ type: "text", text }], "stop"),
  });
}

/** A mock whose generate() call rejects — simulates a provider failure on the non-streaming path. */
export function failingGenerateModel(error: unknown): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
  });
}

/**
 * A scripted multi-step model for tool-loop generate() tests (flush): `doGenerate` is an ARRAY, one result per LLM
 * call. A tool step ends with finishReason `tool-calls` (continues the loop); its `input` is a JSON STRING.
 * Total generate calls across the run must not exceed steps.length.
 */
export function scriptedGenerateModel(steps: ScriptStep[]): MockLanguageModelV4 {
  return new MockLanguageModelV4({ doGenerate: steps.map(stepToGenerateResult) });
}

function stepToGenerateResult(step: ScriptStep) {
  if (step.kind === "tool") {
    return generateResult(
      [{ type: "tool-call", toolCallId: step.toolCallId, toolName: step.toolName, input: JSON.stringify(step.input) }],
      "tool-calls",
    );
  }
  if (step.kind === "textTool") {
    return generateResult(
      [
        { type: "text", text: step.deltas.join("") },
        { type: "tool-call", toolCallId: step.toolCallId, toolName: step.toolName, input: JSON.stringify(step.input) },
      ],
      "tool-calls",
    );
  }
  return generateResult([{ type: "text", text: step.deltas.join("") }], "stop");
}

function generateResult(content: unknown, unified: "stop" | "tool-calls") {
  return {
    content,
    finishReason: { unified, raw: undefined },
    usage: USAGE,
    warnings: [],
  } as Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
}

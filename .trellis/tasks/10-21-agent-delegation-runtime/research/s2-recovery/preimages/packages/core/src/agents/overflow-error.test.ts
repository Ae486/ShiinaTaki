import { describe, expect, it } from "vitest";
import { APICallError } from "ai";
import { isContextOverflowError, observedTokensOf } from "./overflow-error.ts";

function apiError(overrides: { message: string; statusCode?: number; responseBody?: string }): APICallError {
  return new APICallError({
    url: "https://gw.example.com/v1/chat/completions",
    requestBodyValues: {},
    isRetryable: false,
    ...overrides,
  });
}

// Real gateway phrasings, verbatim from the sources cited in overflow-error.ts.
const OPENAI_OLD =
  "This model's maximum context length is 8192 tokens. However, you requested 13576 tokens (5127 in the messages, 8449 in the completion). Please reduce the length of the messages or completion.";
const OPENAI_NEW =
  "This model's maximum context length is 4096 tokens. However, your messages resulted in 4239 tokens. Please reduce the length of the messages.";
const VLLM = "This model's maximum context length is 8192 tokens. However, you requested 8960 tokens in the messages, Please reduce the length of the messages.";
const VLLM_ENGINE = "This model's context length is only 4096 tokens.";
const SGLANG = "Input length (160062 tokens) exceeds the maximum allowed length (59862 tokens). Use a shorter input or enable --allow-auto-truncate.";
const LLAMA_CPP = "the request exceeds the available context size";
const ANTHROPIC_STYLE = "prompt is too long: 200000 tokens > 199999 maximum";

describe("isContextOverflowError (R2 classifier, TDD row 9)", () => {
  it.each([
    ["OpenAI old format", OPENAI_OLD, 400],
    ["OpenAI new format", OPENAI_NEW, 400],
    ["vLLM serving_chat", VLLM, 400],
    ["vLLM engine path", VLLM_ENGINE, 400],
    ["sglang", SGLANG, 400],
    ["llama.cpp server", LLAMA_CPP, 400],
    ["Anthropic-style proxy", ANTHROPIC_STYLE, 413],
  ])("classifies the %s phrasing", (_label, message, statusCode) => {
    expect(isContextOverflowError(apiError({ message, statusCode }))).toBe(true);
  });

  it("classifies a generic message whose raw BODY carries the context_length_exceeded code (proxy case)", () => {
    const error = apiError({
      message: "Bad Request",
      statusCode: 400,
      responseBody: '{"error":{"message":"Bad Request","type":"invalid_request_error","code":"context_length_exceeded"}}',
    });
    expect(isContextOverflowError(error)).toBe(true);
  });

  it("classifies a status-less APICallError when the phrasing matches (some wrappers drop the status)", () => {
    expect(isContextOverflowError(apiError({ message: OPENAI_NEW }))).toBe(true);
  });

  it("never classifies a non-overflow APICallError (401 auth)", () => {
    expect(isContextOverflowError(apiError({ message: "Invalid API key", statusCode: 401 }))).toBe(false);
  });

  it("never classifies an overflow-phrased 5xx (gateway-wrapped errors stay unretried)", () => {
    expect(isContextOverflowError(apiError({ message: OPENAI_NEW, statusCode: 502 }))).toBe(false);
  });

  it("never classifies plain Errors, strings, or undefined (fail-open)", () => {
    expect(isContextOverflowError(new Error(OPENAI_NEW))).toBe(false); // not an APICallError — unknown transport
    expect(isContextOverflowError("turn cancelled by operator")).toBe(false); // the thrown abort reason
    expect(isContextOverflowError(undefined)).toBe(false);
  });
});

describe("observedTokensOf (R2's provider-reported request size)", () => {
  it.each([
    ["OpenAI old format", OPENAI_OLD, 13576],
    ["OpenAI new format", OPENAI_NEW, 4239],
    ["vLLM", VLLM, 8960],
    ["sglang", SGLANG, 160062],
    ["Anthropic-style", ANTHROPIC_STYLE, 200000],
  ])("parses the requested count from the %s phrasing", (_label, message, expected) => {
    expect(observedTokensOf(apiError({ message, statusCode: 400 }))).toBe(expected);
  });

  it("never returns the model's advertised maximum when no requested count is present", () => {
    // vLLM's engine-path string names ONLY the limit — parsing it as "observed" would recalibrate to 90% of the
    // WRONG number, so the parse must yield undefined and let the caller fall back to its own estimate.
    expect(observedTokensOf(apiError({ message: VLLM_ENGINE, statusCode: 400 }))).toBeUndefined();
  });

  it("returns undefined for non-APICallError inputs", () => {
    expect(observedTokensOf(new Error(OPENAI_OLD))).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { normalizeAuxiliaryUsage } from "./auxiliary-usage-normalization.ts";

describe("auxiliary usage normalization", () => {
  it("keeps safe normalized zeroes and treats reasoning as part of output", () => {
    expect(normalizeAuxiliaryUsage({
      inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 7, text: 2, reasoning: 5 },
    })).toEqual({
      inputTokens: 0, noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      outputTokens: 7, reasoningTokens: 5, totalTokens: 7,
    });
  });

  it("uses OpenAI raw field presence to distinguish missing adapter details from explicit zero", () => {
    expect(normalizeAuxiliaryUsage({
      inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: undefined },
      outputTokens: { total: 4, text: 4, reasoning: 0 },
      raw: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    })).toEqual({
      inputTokens: 12, noCacheTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
      outputTokens: 4, reasoningTokens: null, totalTokens: 16,
    });

    expect(normalizeAuxiliaryUsage({
      inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: undefined },
      outputTokens: { total: 4, text: 4, reasoning: 0 },
      raw: {
        prompt_tokens: 12, completion_tokens: 4, total_tokens: 16,
        prompt_tokens_details: { cached_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    })).toEqual({
      inputTokens: 12, noCacheTokens: 12, cacheReadTokens: 0, cacheWriteTokens: null,
      outputTokens: 4, reasoningTokens: 0, totalTokens: 16,
    });
  });

  it("accepts consistent DeepSeek aliases and rejects malformed, conflicting or unsafe counts", () => {
    expect(normalizeAuxiliaryUsage({
      inputTokens: { total: 99, noCache: 99, cacheRead: 0 },
      outputTokens: { total: 99, reasoning: 0 },
      raw: {
        prompt_tokens: 20, completion_tokens: 8, total_tokens: 28,
        prompt_cache_hit_tokens: 15, prompt_cache_miss_tokens: 5,
        prompt_tokens_details: { cached_tokens: 15 },
        completion_tokens_details: { reasoning_tokens: 3 },
      },
    })).toEqual({
      inputTokens: 20, noCacheTokens: 5, cacheReadTokens: 15, cacheWriteTokens: null,
      outputTokens: 8, reasoningTokens: 3, totalTokens: 28,
    });

    expect(normalizeAuxiliaryUsage({
      inputTokens: { total: 0, noCache: 0, cacheRead: 0 },
      outputTokens: { total: 0, reasoning: 0 },
      raw: {
        prompt_tokens: "20", completion_tokens: -1, total_tokens: Number.MAX_SAFE_INTEGER + 1,
        prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: "malformed",
        prompt_tokens_details: { cached_tokens: 3 },
        completion_tokens_details: { reasoning_tokens: 9 },
      },
    })).toEqual({
      inputTokens: null, noCacheTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
      outputTokens: null, reasoningTokens: 9, totalTokens: null,
    });
  });

  it("does not guess fields from an unrecognized raw object", () => {
    expect(normalizeAuxiliaryUsage({
      inputTokens: { total: 6, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 2, text: 2, reasoning: undefined },
      raw: { vendor_private_tokens: 100 },
    })).toEqual({
      inputTokens: 6, noCacheTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
      outputTokens: 2, reasoningTokens: null, totalTokens: 8,
    });

    expect(normalizeAuxiliaryUsage({
      inputTokens: { total: 6, noCache: 0, cacheRead: 7, cacheWrite: undefined },
      outputTokens: { total: 0, text: 0, reasoning: 0 },
    }).cacheReadTokens).toBeNull();
  });
});

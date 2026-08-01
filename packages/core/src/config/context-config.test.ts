import { describe, expect, it } from "vitest";
import { DEFAULT_CONTEXT_TOKENS, DEFAULT_HISTORY_RATIO, loadContextConfig } from "./context-config.ts";

describe("loadContextConfig (T5-R1 tier 1 / R13)", () => {
  it("returns fail-closed defaults for an empty env", () => {
    expect(loadContextConfig({})).toEqual({
      contextTokens: {
        main: DEFAULT_CONTEXT_TOKENS,
        vision: DEFAULT_CONTEXT_TOKENS,
        utility: DEFAULT_CONTEXT_TOKENS,
      },
      historyRatio: DEFAULT_HISTORY_RATIO,
      includeUsage: false,
    });
  });

  it("parses per-slot declared windows independently", () => {
    const config = loadContextConfig({
      TAKI_PROVIDER_CONTEXT_TOKENS: "131072",
      TAKI_VLM_CONTEXT_TOKENS: "8192",
    });
    expect(config.contextTokens).toEqual({ main: 131072, vision: 8192, utility: DEFAULT_CONTEXT_TOKENS });
  });

  it("parses the history ratio and accepts the 1.0 boundary", () => {
    expect(loadContextConfig({ TAKI_CONTEXT_HISTORY_RATIO: "0.7" }).historyRatio).toBe(0.7);
    expect(loadContextConfig({ TAKI_CONTEXT_HISTORY_RATIO: "1" }).historyRatio).toBe(1);
  });

  it("parses the includeUsage opt-in strictly (Q14 — true/1/false/0 only, default OFF)", () => {
    expect(loadContextConfig({}).includeUsage).toBe(false);
    expect(loadContextConfig({ TAKI_PROVIDER_INCLUDE_USAGE: "true" }).includeUsage).toBe(true);
    expect(loadContextConfig({ TAKI_PROVIDER_INCLUDE_USAGE: "1" }).includeUsage).toBe(true);
    expect(loadContextConfig({ TAKI_PROVIDER_INCLUDE_USAGE: "false" }).includeUsage).toBe(false);
    expect(loadContextConfig({ TAKI_PROVIDER_INCLUDE_USAGE: "0" }).includeUsage).toBe(false);
  });

  it.each([
    ["TAKI_PROVIDER_CONTEXT_TOKENS", "abc"],
    ["TAKI_PROVIDER_CONTEXT_TOKENS", "0"],
    ["TAKI_PROVIDER_CONTEXT_TOKENS", "-1"],
    ["TAKI_PROVIDER_CONTEXT_TOKENS", "3.5"],
    ["TAKI_VLM_CONTEXT_TOKENS", "garbage"],
    ["TAKI_UTILITY_CONTEXT_TOKENS", "-32768"],
    ["TAKI_CONTEXT_HISTORY_RATIO", "0"],
    ["TAKI_CONTEXT_HISTORY_RATIO", "1.5"],
    ["TAKI_CONTEXT_HISTORY_RATIO", "abc"],
    ["TAKI_PROVIDER_INCLUDE_USAGE", "yes"],
    ["TAKI_PROVIDER_INCLUDE_USAGE", "on"],
  ])("is fatal on garbage (%s=%s), never a silent default", (key, value) => {
    expect(() => loadContextConfig({ [key]: value })).toThrow();
  });
});

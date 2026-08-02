import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPACT_KEEP_MESSAGES,
  DEFAULT_COMPACT_TRIGGER_RATIO,
  DEFAULT_CONTEXT_TOKENS,
  DEFAULT_HISTORY_RATIO,
  loadContextConfig,
} from "./context-config.ts";

describe("loadContextConfig (T5-R1 tier 1 / R5 / R13)", () => {
  it("returns fail-closed defaults for an empty env (batch-7 optimistic-budget rider: 131072 / 0.7)", () => {
    expect(loadContextConfig({})).toEqual({
      contextTokens: {
        main: DEFAULT_CONTEXT_TOKENS,
        vision: DEFAULT_CONTEXT_TOKENS,
        utility: DEFAULT_CONTEXT_TOKENS,
      },
      historyRatio: DEFAULT_HISTORY_RATIO,
      includeUsage: false,
      compact: { triggerRatio: DEFAULT_COMPACT_TRIGGER_RATIO, keepMessages: DEFAULT_COMPACT_KEEP_MESSAGES },
    });
    expect(DEFAULT_CONTEXT_TOKENS).toBe(131072);
    expect(DEFAULT_HISTORY_RATIO).toBe(0.7);
    expect(DEFAULT_COMPACT_TRIGGER_RATIO).toBe(0.8);
    expect(DEFAULT_COMPACT_KEEP_MESSAGES).toBe(40);
  });

  it("parses per-slot declared windows independently", () => {
    const config = loadContextConfig({
      TAKI_PROVIDER_CONTEXT_TOKENS: "262144",
      TAKI_VLM_CONTEXT_TOKENS: "8192",
    });
    expect(config.contextTokens).toEqual({ main: 262144, vision: 8192, utility: DEFAULT_CONTEXT_TOKENS });
  });

  it("parses the history ratio and accepts the 1.0 boundary", () => {
    expect(loadContextConfig({ TAKI_CONTEXT_HISTORY_RATIO: "0.55" }).historyRatio).toBe(0.55);
    expect(loadContextConfig({ TAKI_CONTEXT_HISTORY_RATIO: "1" }).historyRatio).toBe(1);
  });

  it("parses the includeUsage opt-in strictly (Q14 — true/1/false/0 only, default OFF)", () => {
    expect(loadContextConfig({}).includeUsage).toBe(false);
    expect(loadContextConfig({ TAKI_PROVIDER_INCLUDE_USAGE: "true" }).includeUsage).toBe(true);
    expect(loadContextConfig({ TAKI_PROVIDER_INCLUDE_USAGE: "1" }).includeUsage).toBe(true);
    expect(loadContextConfig({ TAKI_PROVIDER_INCLUDE_USAGE: "false" }).includeUsage).toBe(false);
    expect(loadContextConfig({ TAKI_PROVIDER_INCLUDE_USAGE: "0" }).includeUsage).toBe(false);
  });

  it("parses the compaction knobs (batch 7 — trigger ratio + the single retention knob)", () => {
    const config = loadContextConfig({ TAKI_COMPACT_TRIGGER_RATIO: "0.6", TAKI_COMPACT_KEEP_MESSAGES: "80" });
    expect(config.compact).toEqual({ triggerRatio: 0.6, keepMessages: 80 });
    expect(loadContextConfig({ TAKI_COMPACT_TRIGGER_RATIO: "1" }).compact.triggerRatio).toBe(1);
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
    ["TAKI_COMPACT_TRIGGER_RATIO", "0"],
    ["TAKI_COMPACT_TRIGGER_RATIO", "1.2"],
    ["TAKI_COMPACT_TRIGGER_RATIO", "abc"],
    ["TAKI_COMPACT_KEEP_MESSAGES", "0"],
    ["TAKI_COMPACT_KEEP_MESSAGES", "-40"],
    ["TAKI_COMPACT_KEEP_MESSAGES", "12.5"],
    ["TAKI_COMPACT_KEEP_MESSAGES", "many"],
  ])("is fatal on garbage (%s=%s), never a silent default", (key, value) => {
    expect(() => loadContextConfig({ [key]: value })).toThrow();
  });
});

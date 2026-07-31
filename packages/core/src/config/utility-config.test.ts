import { describe, expect, it } from "vitest";
import { loadUtilityConfig } from "./utility-config.ts";

const FULL = {
  TAKI_UTILITY_BASE_URL: "https://utility.example.com",
  TAKI_UTILITY_API_KEY: "sk-utility",
  TAKI_UTILITY_MODEL: "cheap-fast-1",
};

describe("loadUtilityConfig (T5-R11)", () => {
  it("parses all three TAKI_UTILITY_* into a clean config", () => {
    expect(loadUtilityConfig(FULL)).toEqual({
      baseUrl: "https://utility.example.com",
      apiKey: "sk-utility",
      model: "cheap-fast-1",
    });
  });

  it("returns null when none are set (background work then rides the main model)", () => {
    expect(loadUtilityConfig({})).toBeNull();
    expect(loadUtilityConfig({ TAKI_PROVIDER_MODEL: "x" })).toBeNull();
  });

  it("throws naming the missing variable when the set is partial (fail-closed)", () => {
    expect(() => loadUtilityConfig({ TAKI_UTILITY_BASE_URL: "u", TAKI_UTILITY_API_KEY: "k" })).toThrow(
      /TAKI_UTILITY_MODEL/,
    );
    expect(() => loadUtilityConfig({ TAKI_UTILITY_MODEL: "m" })).toThrow(
      /TAKI_UTILITY_BASE_URL|TAKI_UTILITY_API_KEY/,
    );
  });

  it("treats an empty value as absent-and-partial and throws naming it", () => {
    expect(() => loadUtilityConfig({ ...FULL, TAKI_UTILITY_API_KEY: "" })).toThrow(/TAKI_UTILITY_API_KEY/);
  });
});

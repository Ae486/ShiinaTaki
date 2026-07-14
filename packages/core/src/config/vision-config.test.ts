import { describe, expect, it } from "vitest";
import { loadVisionConfig } from "./vision-config.ts";

const FULL = {
  TAKI_VLM_BASE_URL: "https://vlm.example.com",
  TAKI_VLM_API_KEY: "sk-vlm",
  TAKI_VLM_MODEL: "gemini-2.5-pro-1m",
};

describe("loadVisionConfig (T5)", () => {
  it("parses all three TAKI_VLM_* into a clean config", () => {
    expect(loadVisionConfig(FULL)).toEqual({
      baseUrl: "https://vlm.example.com",
      apiKey: "sk-vlm",
      model: "gemini-2.5-pro-1m",
    });
  });

  it("returns null when none are set (feature off, degrades to text-only)", () => {
    expect(loadVisionConfig({})).toBeNull();
    expect(loadVisionConfig({ TAKI_OTHER: "x" })).toBeNull();
  });

  it("throws naming the missing variable when the set is partial (fail-closed)", () => {
    expect(() => loadVisionConfig({ TAKI_VLM_BASE_URL: "u", TAKI_VLM_API_KEY: "k" })).toThrow(/TAKI_VLM_MODEL/);
    expect(() => loadVisionConfig({ TAKI_VLM_MODEL: "m" })).toThrow(/TAKI_VLM_BASE_URL|TAKI_VLM_API_KEY/);
  });

  it("treats an empty value as absent-and-partial and throws naming it", () => {
    expect(() => loadVisionConfig({ ...FULL, TAKI_VLM_API_KEY: "" })).toThrow(/TAKI_VLM_API_KEY/);
  });
});

import { describe, expect, it } from "vitest";
import { loadProviderConfig } from "./provider-config.ts";

const FULL = {
  TAKI_PROVIDER_BASE_URL: "https://api.deepseek.com",
  TAKI_PROVIDER_API_KEY: "sk-test",
  TAKI_PROVIDER_MODEL: "deepseek-v4-flash",
};

describe("loadProviderConfig", () => {
  it("parses a fully populated env into a clean config", () => {
    expect(loadProviderConfig(FULL)).toEqual({
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
    });
  });

  it("throws naming the missing variable", () => {
    expect(() =>
      loadProviderConfig({ TAKI_PROVIDER_API_KEY: "k", TAKI_PROVIDER_MODEL: "m" }),
    ).toThrow(/TAKI_PROVIDER_BASE_URL/);
  });

  it("rejects an empty api key, naming it", () => {
    expect(() => loadProviderConfig({ ...FULL, TAKI_PROVIDER_API_KEY: "" })).toThrow(/TAKI_PROVIDER_API_KEY/);
  });
});

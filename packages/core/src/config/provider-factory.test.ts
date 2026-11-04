import { describe, expect, it } from "vitest";
import { createModels } from "./provider-factory.ts";

const PROVIDER = { baseUrl: "https://api.example.com/v1", apiKey: "sk-test", model: "chat-model-1" };

// Q14's construction-arg assert reads the built chat model's runtime config (TS-private but a plain runtime
// property on @ai-sdk/openai-compatible@3.0.75's OpenAICompatibleChatLanguageModel) — reaching in beats vi.mock'ing
// a module the other tests exercise for real; re-verify the property name on an SDK major bump.
function includeUsageOf(model: unknown): boolean | undefined {
  return (model as { config: { includeUsage?: boolean } }).config.includeUsage;
}

describe("createModels (main.ts provider construction, extracted)", () => {
  it("builds the main model from the provider config", () => {
    const { model } = createModels({ provider: PROVIDER });
    expect(model).toMatchObject({ modelId: "chat-model-1" });
  });

  it("omits the streaming-usage option by default (Q14 — OFF means the setting is ABSENT, not false)", () => {
    const { model } = createModels({ provider: PROVIDER });
    expect(includeUsageOf(model)).toBeUndefined();
  });

  it("passes includeUsage to the single text/image provider when opted in", () => {
    const { model } = createModels({
      provider: PROVIDER,
      includeUsage: true,
    });
    expect(includeUsageOf(model)).toBe(true);
  });
});

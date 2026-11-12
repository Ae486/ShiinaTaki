/**
 * INPUT:  primary ProviderConfig and the streaming-usage opt-in
 * OUTPUT: createModels({provider, includeUsage?}) -> { model } for native text/image requests
 * POS:    core/config — one primary OpenAI-compatible model; no separate vision translator
 */
import type { LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderConfig } from "./provider-config.ts";

export interface ProviderModels {
  model: LanguageModel;
}

export function createModels(deps: { provider: ProviderConfig; includeUsage?: boolean }): ProviderModels {
  const provider = createOpenAICompatible({
    name: "taki-provider",
    baseURL: deps.provider.baseUrl,
    apiKey: deps.provider.apiKey,
    // Preserve compatible gateways that require the option to be absent when disabled.
    ...(deps.includeUsage === true ? { includeUsage: true } : {}),
  });
  return { model: provider.languageModel(deps.provider.model) };
}

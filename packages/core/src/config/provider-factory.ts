/**
 * INPUT:  the loaded ProviderConfig (required text slot) + VisionConfig | null (optional vision slot) + the Q14
 *         includeUsage opt-in
 * OUTPUT: createModels({provider, vision, includeUsage?}) -> { model, visionModel } — the OpenAI-compatible
 *         LanguageModel slots; includeUsage=true adds stream_options:{include_usage:true} to main-slot streams
 * POS:    core/config — provider/model construction lifted out of main.ts (batch-6 sanctioned relief for the
 *         composition root's line cap)
 */
import type { LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderConfig } from "./provider-config.ts";
import type { VisionConfig } from "./vision-config.ts";

export interface ProviderModels {
  model: LanguageModel;
  /** Absent when no vision slot is configured — image turns are then rejected upstream (#17 decision 5). */
  visionModel: LanguageModel | undefined;
}

export function createModels(deps: { provider: ProviderConfig; vision: VisionConfig | null; includeUsage?: boolean }): ProviderModels {
  const provider = createOpenAICompatible({
    name: "taki-provider",
    baseURL: deps.provider.baseUrl,
    apiKey: deps.provider.apiKey,
    // Q14: opt-in streaming usage. Verified against the installed @ai-sdk/openai-compatible@3.0.5 dist:
    // OpenAICompatibleProviderSettings.includeUsage threads into the chat model config, which then sends
    // `stream_options: { include_usage: true }` on streaming calls. Spread-conditional so OFF keeps the
    // setting literally ABSENT (the construction-arg test's "default off = option absent").
    ...(deps.includeUsage === true ? { includeUsage: true } : {}),
  });
  // The vision slot mirrors the text-slot block; absent config = no vision model. Q14 deliberately does NOT cover
  // it — the vision slot is uncalibrated in v1 (batch-6 design §2.5's recorded gap).
  const visionModel = deps.vision
    ? createOpenAICompatible({ name: "taki-vision", baseURL: deps.vision.baseUrl, apiKey: deps.vision.apiKey }).languageModel(
        deps.vision.model,
      )
    : undefined;
  return { model: provider.languageModel(deps.provider.model), visionModel };
}

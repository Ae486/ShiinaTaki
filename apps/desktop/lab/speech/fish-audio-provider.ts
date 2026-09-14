/**
 * INPUT:  runtime Fish config, a speech request, and optional injectable HTTP transport.
 * OUTPUT: Fish /v1/tts request with model header and reference_id, returning real audio bytes.
 * POS:    experimental / lab — not in production path; verified against Fish Audio OpenAPI on 2026-09-08.
 */

import { requestSpeech, speechEndpoint, speechHeaders, validateSpeechRequest } from "./provider-request.ts";
import type { ProviderConfig, SpeechProvider, SpeechRequest, Transport, UpstreamRequest } from "./speech-provider.ts";

export function buildFishRequest(config: ProviderConfig, request: SpeechRequest): UpstreamRequest {
  validateSpeechRequest(request);
  if (!config.apiKey.trim()) throw new Error("Fish Audio API key is required");
  return {
    url: speechEndpoint(config.baseUrl, "/v1/tts"),
    headers: { ...speechHeaders(config), model: request.model },
    body: JSON.stringify({ text: request.text, reference_id: request.voice, format: request.format, prosody: { speed: request.speed }, latency: "normal" }),
  };
}

export function createFishAudioProvider(config: ProviderConfig, transport: Transport): SpeechProvider {
  return {
    id: "fish-audio",
    synthesize: (request, signal) => requestSpeech({
      request: buildFishRequest(config, request), transport, signal,
      providerId: "fish-audio", format: request.format, apiKey: config.apiKey,
    }),
  };
}

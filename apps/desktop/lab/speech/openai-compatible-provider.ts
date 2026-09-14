/**
 * INPUT:  runtime local/VPS provider config, speech request, and injectable transport.
 * OUTPUT: the reserved /v1/audio/speech wire contract with buffered audio bytes.
 * POS:    experimental / lab — not in production path; does not instantiate or run a synthesis model.
 */

import { requestSpeech, speechEndpoint, speechHeaders, validateSpeechRequest } from "./provider-request.ts";
import type { ProviderConfig, SpeechProvider, SpeechRequest, Transport, UpstreamRequest } from "./speech-provider.ts";

export function buildOpenAiSpeechRequest(config: ProviderConfig, request: SpeechRequest): UpstreamRequest {
  validateSpeechRequest(request);
  return {
    url: speechEndpoint(config.baseUrl, "/v1/audio/speech"),
    headers: speechHeaders(config),
    body: JSON.stringify({ model: request.model, input: request.text, voice: request.voice, response_format: request.format, speed: request.speed }),
  };
}

export function createOpenAiSpeechProvider(config: ProviderConfig, transport: Transport): SpeechProvider {
  return {
    id: "openai-compatible",
    synthesize: (request, signal) => requestSpeech({
      request: buildOpenAiSpeechRequest(config, request), transport, signal,
      providerId: "openai-compatible", format: request.format, apiKey: config.apiKey,
    }),
  };
}

/**
 * INPUT:  text/voice request, runtime-only provider config, and an injectable HTTP transport.
 * OUTPUT: provider-neutral audio bytes with MIME and synthesis duration for native engine playback.
 * POS:    experimental / lab — not in production path; buffered whole-utterance contract from docs/TTS-INTERFACE.md.
 */

export type SpeechProviderId = "fish-audio" | "openai-compatible";
export interface SpeechRequest {
  text: string;
  voice: string;
  model: string;
  speed: number;
  format: "wav" | "mp3";
}
export interface SpeechClip {
  bytes: ArrayBuffer;
  mimeType: string;
  providerId: SpeechProviderId | "local-file";
  elapsedMs: number;
}
export interface UpstreamRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}
export type Transport = (request: UpstreamRequest, signal?: AbortSignal) => Promise<Response>;
export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
}
export interface SpeechProvider {
  readonly id: SpeechProviderId;
  synthesize(request: SpeechRequest, signal?: AbortSignal): Promise<SpeechClip>;
}

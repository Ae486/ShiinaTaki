/**
 * INPUT:  validated provider request/configuration and an injectable transport response.
 * OUTPUT: endpoint/auth construction and audio-only buffered responses with sanitized errors.
 * POS:    experimental / lab — not in production path; shared wire handling for two actual TTS contracts.
 */

import type { ProviderConfig, SpeechClip, SpeechProviderId, SpeechRequest, Transport, UpstreamRequest } from "./speech-provider.ts";

export function speechEndpoint(baseUrl: string, endpoint: string): string {
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("TTS base URL must use HTTP(S) without embedded credentials");
  const basePath = url.pathname.replace(/\/+$/u, "");
  url.pathname = basePath.endsWith("/v1") ? basePath + endpoint.slice(3) : basePath + endpoint;
  url.search = "";
  url.hash = "";
  return url.href;
}

export function speechHeaders(config: ProviderConfig): Record<string, string> {
  return { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) };
}

export function validateSpeechRequest(request: SpeechRequest): void {
  if (!request.text.trim()) throw new Error("Speech text is empty");
  if (!request.voice.trim()) throw new Error("A voice is required");
  if (!request.model.trim()) throw new Error("A speech model is required");
  if (!Number.isFinite(request.speed) || request.speed < 0.5 || request.speed > 2) throw new Error("Speech speed must be between 0.5 and 2");
  if (request.format !== "wav" && request.format !== "mp3") throw new Error("Speech format must be wav or mp3");
}

export async function requestSpeech(input: {
  request: UpstreamRequest;
  transport: Transport;
  providerId: SpeechProviderId;
  format: SpeechRequest["format"];
  apiKey: string;
  signal?: AbortSignal;
}): Promise<SpeechClip> {
  const started = performance.now();
  const response = await input.transport(input.request, input.signal);
  if (!response.ok) throw new Error(await responseError(response, input.apiKey));
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (contentType && !contentType.startsWith("audio/") && contentType !== "application/octet-stream") {
    throw new Error(`TTS returned ${contentType}, expected audio`);
  }
  const bytes = await response.arrayBuffer();
  input.signal?.throwIfAborted();
  if (bytes.byteLength === 0) throw new Error("TTS returned empty audio");
  return {
    bytes,
    mimeType: contentType.startsWith("audio/") ? contentType : input.format === "wav" ? "audio/wav" : "audio/mpeg",
    providerId: input.providerId,
    elapsedMs: performance.now() - started,
  };
}

async function responseError(response: Response, apiKey: string): Promise<string> {
  const prefix = `TTS request failed (HTTP ${response.status})`;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return prefix;
  }
  if (typeof body !== "object" || body === null) return prefix;
  const value = body as Record<string, unknown>;
  const nested = typeof value.error === "object" && value.error !== null ? value.error as Record<string, unknown> : null;
  const detail = value.message ?? value.reason ?? nested?.message ?? value.detail;
  if (typeof detail !== "string") return prefix;
  const redacted = apiKey ? detail.replaceAll(apiKey, "[redacted]") : detail;
  return `${prefix}: ${redacted.slice(0, 240)}`;
}

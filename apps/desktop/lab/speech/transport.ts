/**
 * INPUT:  direct/proxy choice, the configured local target, and a provider's structured HTTP request.
 * OUTPUT: fetch transport with AbortSignal; proxy routes only the two explicitly configured destinations.
 * POS:    experimental / lab — not in production path; never an arbitrary URL forwarder.
 */

import type { Transport, UpstreamRequest } from "./speech-provider.ts";

export function proxySpeechUrl(requestUrl: string, localBaseUrl = "http://127.0.0.1:9880"): string {
  const requested = new URL(requestUrl);
  if (requested.username || requested.password || requested.search || requested.hash) throw new Error("Unsupported TTS proxy URL");
  if (requested.origin === "https://api.fish.audio" && requested.pathname === "/v1/tts") return "/lab-tts/fish/v1/tts";
  const local = new URL(localBaseUrl);
  const localPath = local.pathname.replace(/\/+$/u, "");
  const expected = localPath.endsWith("/v1") ? `${localPath}/audio/speech` : `${localPath}/v1/audio/speech`;
  if (requested.origin === local.origin && requested.pathname === expected) return `/lab-tts/local${requested.pathname}`;
  throw new Error("The URL does not match a configured TTS proxy target; select direct transport for another service");
}

export function createTransport(mode: "direct" | "proxy", localBaseUrl = "http://127.0.0.1:9880"): Transport {
  return (request: UpstreamRequest, signal?: AbortSignal) => fetch(
    mode === "proxy" ? proxySpeechUrl(request.url, localBaseUrl) : request.url,
    { method: "POST", headers: request.headers, body: request.body, signal, credentials: "omit", redirect: "error" },
  );
}

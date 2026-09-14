import { describe, expect, it, vi } from "vitest";
import { buildFishRequest, createFishAudioProvider } from "./fish-audio-provider.ts";
import { buildOpenAiSpeechRequest, createOpenAiSpeechProvider } from "./openai-compatible-provider.ts";
import type { SpeechRequest, Transport } from "./speech-provider.ts";
import { speechEndpoint } from "./provider-request.ts";

const request: SpeechRequest = { text: "Native voice test.", voice: "voice-123", model: "s2.1-pro-free", speed: 1, format: "wav" };
const fish = { baseUrl: "https://api.fish.audio", apiKey: "test-secret" };

describe("speech provider contracts", () => {
  it("matches Fish's current JSON API, including the model header", () => {
    const wire = buildFishRequest(fish, request);
    expect(wire.url).toBe("https://api.fish.audio/v1/tts");
    expect(wire.headers).toMatchObject({ Authorization: "Bearer test-secret", model: "s2.1-pro-free" });
    expect(JSON.parse(wire.body)).toEqual({ text: request.text, reference_id: request.voice, format: "wav", prosody: { speed: 1 }, latency: "normal" });
  });
  it("matches the reserved OpenAI-compatible wire and permits keyless local services", () => {
    const wire = buildOpenAiSpeechRequest({ baseUrl: "http://127.0.0.1:9880/v1/", apiKey: "" }, request);
    expect(wire.url).toBe("http://127.0.0.1:9880/v1/audio/speech");
    expect(wire.headers.Authorization).toBeUndefined();
    expect(JSON.parse(wire.body)).toEqual({ model: request.model, input: request.text, voice: request.voice, response_format: "wav", speed: 1 });
  });
  it("preserves an explicit service prefix without duplicating /v1", () => {
    expect(speechEndpoint("https://voice.example/api", "/v1/audio/speech")).toBe("https://voice.example/api/v1/audio/speech");
    expect(speechEndpoint("https://voice.example/api/v1", "/v1/audio/speech")).toBe("https://voice.example/api/v1/audio/speech");
  });
  it("rejects empty fields and invalid speeds before network access", () => {
    expect(() => buildFishRequest({ ...fish, apiKey: "" }, request)).toThrow(/API key/);
    for (const bad of [{ text: " " }, { voice: "" }, { model: "" }, { speed: NaN }, { speed: 0 }]) {
      expect(() => buildFishRequest(fish, { ...request, ...bad })).toThrow();
    }
  });
  it("buffers chunked audio and forwards the cancellation signal", async () => {
    const signal = new AbortController().signal;
    const transport = vi.fn<Transport>(async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3, 4])); controller.close();
    } }), { headers: { "content-type": "audio/wav" } }));
    const clip = await createFishAudioProvider(fish, transport).synthesize(request, signal);
    expect([...new Uint8Array(clip.bytes)]).toEqual([1, 2, 3, 4]);
    expect(clip).toMatchObject({ mimeType: "audio/wav", providerId: "fish-audio" });
    expect(clip.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(transport.mock.calls[0]?.[1]).toBe(signal);
  });
  it("does not interpret success JSON or empty content as playable audio", async () => {
    const json = createFishAudioProvider(fish, async () => Response.json({ message: "not audio" }));
    await expect(json.synthesize(request)).rejects.toThrow(/expected audio/);
    const empty = createFishAudioProvider(fish, async () => new Response(new Uint8Array(), { headers: { "content-type": "audio/wav" } }));
    await expect(empty.synthesize(request)).rejects.toThrow(/empty audio/);
  });
  it("reports structured provider errors without echoing an API key", async () => {
    const provider = createFishAudioProvider(fish, async () => Response.json({ message: "invalid test-secret" }, { status: 401 }));
    await expect(provider.synthesize(request)).rejects.toThrow("HTTP 401): invalid [redacted]");
    const local = createOpenAiSpeechProvider(fish, async () => Response.json({ error: { message: "voice missing" } }, { status: 422 }));
    await expect(local.synthesize(request)).rejects.toThrow(/voice missing/);
  });
  it("preserves cancellation after the body arrives", async () => {
    const controller = new AbortController();
    const provider = createFishAudioProvider(fish, async () => {
      controller.abort();
      return new Response(new Uint8Array([1]), { headers: { "content-type": "audio/wav" } });
    });
    await expect(provider.synthesize(request, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

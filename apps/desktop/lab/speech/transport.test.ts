import { afterEach, expect, it, vi } from "vitest";
import { createTransport, proxySpeechUrl } from "./transport.ts";

afterEach(() => vi.unstubAllGlobals());

it("routes only the exact Fish endpoint or configured local endpoint through the proxy", () => {
  expect(proxySpeechUrl("https://api.fish.audio/v1/tts")).toBe("/lab-tts/fish/v1/tts");
  expect(proxySpeechUrl("http://127.0.0.1:9880/v1/audio/speech")).toBe("/lab-tts/local/v1/audio/speech");
  expect(proxySpeechUrl("http://localhost:9000/api/v1/audio/speech", "http://localhost:9000/api")).toBe("/lab-tts/local/api/v1/audio/speech");
  expect(() => proxySpeechUrl("https://another.example/v1/audio/speech")).toThrow(/does not match/);
  expect(() => proxySpeechUrl("https://api.fish.audio/v1/models")).toThrow(/does not match/);
});

it("passes request body, auth and abort signal without cookies", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response());
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  const request = { url: "https://api.fish.audio/v1/tts", headers: { Authorization: "Bearer test" }, body: "{}" };
  await createTransport("proxy")(request, signal);
  expect(fetcher).toHaveBeenCalledWith("/lab-tts/fish/v1/tts", { method: "POST", headers: request.headers, body: "{}", signal, credentials: "omit", redirect: "error" });
});

it("allows a user-selected HTTP endpoint in direct mode", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response());
  vi.stubGlobal("fetch", fetcher);
  await createTransport("direct")({ url: "https://tts.example/v1/audio/speech", headers: {}, body: "{}" });
  expect(fetcher.mock.calls[0]?.[0]).toBe("https://tts.example/v1/audio/speech");
});

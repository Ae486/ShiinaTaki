import { expect, it } from "vitest";
import { labTtsProxy, labTtsTargets } from "./lab-tts-proxy.ts";

it("publishes fixed Fish and configurable local targets without credentials", () => {
  expect(labTtsTargets({})).toEqual({ fishBaseUrl: "https://api.fish.audio", localBaseUrl: "http://127.0.0.1:9880" });
  expect(() => labTtsTargets({ TAKI_LAB_TTS_LOCAL_TARGET: "https://user:secret@example.com" })).toThrow(/credentials/);
});

it("matches exact synthesis paths and preserves a configured local path prefix", () => {
  const proxies = labTtsProxy({ TAKI_LAB_TTS_LOCAL_TARGET: "http://localhost:9000/api/v1" });
  const entries = Object.entries(proxies);
  const local = entries.find(([pattern]) => new RegExp(pattern).test("/lab-tts/local/api/v1/audio/speech"))?.[1];
  expect(local?.target).toBe("http://localhost:9000");
  expect(local?.rewrite?.("/lab-tts/local/api/v1/audio/speech")).toBe("/api/v1/audio/speech");
  expect(entries.some(([pattern]) => new RegExp(pattern).test("/lab-tts/fish/v1/models"))).toBe(false);
  expect(entries.some(([pattern]) => new RegExp(pattern).test("/lab-tts/fish/v1/tts?url=https://other.example"))).toBe(false);
});

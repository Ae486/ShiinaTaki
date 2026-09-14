import { describe, expect, it, vi } from "vitest";

import { createNativeClipSource } from "./native-clip-source.ts";
import type { SpeechClip, SpeechProvider, SpeechRequest } from "./speech-provider.ts";

const clip: SpeechClip = { bytes: new ArrayBuffer(12), mimeType: "audio/wav", providerId: "openai-compatible", elapsedMs: 10 };
const request: SpeechRequest = { text: "test", model: "local", voice: "local", format: "wav", speed: 1 };

describe("native speech clip input", () => {
  it("retains a local file as bytes for replay and rejects empty or unreadable files", async () => {
    const source = createNativeClipSource();
    expect(await source.loadFile({ name: "hello.wav", type: "audio/wav", arrayBuffer: async () => clip.bytes })).toBe(true);
    expect(source.clip()?.providerId).toBe("local-file");
    expect(source.snapshot().clip).toMatchObject({ name: "hello.wav", bytes: 12 });
    expect(await source.loadFile({ name: "empty.wav", type: "audio/wav", arrayBuffer: async () => new ArrayBuffer(0) })).toBe(false);
    expect(source.snapshot().status).toBe("error");
    expect(await source.loadFile({ name: "bad.wav", type: "audio/wav", arrayBuffer: async () => { throw new Error("denied"); } })).toBe(false);
    expect(source.snapshot().status).toBe("error");
  });

  it("aborts synthesis and ignores a stale result even when a provider ignores its signal", async () => {
    const source = createNativeClipSource();
    let resolve!: (value: SpeechClip) => void;
    const provider: SpeechProvider = { id: "openai-compatible", synthesize: vi.fn(() => new Promise<SpeechClip>((done) => { resolve = done; })) };
    const result = source.synthesize(provider, request);
    expect(source.snapshot().status).toBe("synthesizing");
    const signal = vi.mocked(provider.synthesize).mock.calls[0]?.[1];
    source.cancel();
    expect(signal?.aborted).toBe(true);
    await source.loadFile({ name: "new.wav", type: "audio/wav", arrayBuffer: async () => new ArrayBuffer(16) });
    resolve(clip);
    expect(await result).toBe(false);
    expect(source.snapshot().clip?.name).toBe("new.wav");
  });

  it("does not create a provider request for empty text or after disposal", async () => {
    const source = createNativeClipSource();
    const provider: SpeechProvider = { id: "openai-compatible", synthesize: vi.fn(async () => clip) };
    expect(await source.synthesize(provider, { ...request, text: " " })).toBe(false);
    expect(provider.synthesize).not.toHaveBeenCalled();
    source.dispose();
    expect(await source.synthesize(provider, request)).toBe(false);
    expect(provider.synthesize).not.toHaveBeenCalled();
  });
});

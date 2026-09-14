import { describe, expect, it } from "vitest";

import { analyzeMouthEnvelope, envelopeValueAt } from "./mouth-envelope.ts";

function tone(length: number, value: number): Float32Array {
  return new Float32Array(length).fill(value);
}

function concat(...parts: Float32Array[]): Float32Array {
  const result = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

describe("mouth envelope", () => {
  it("returns zero for silence and out-of-range queries", () => {
    const envelope = analyzeMouthEnvelope({ pcm: tone(1000, 0), sampleRate: 1000, frameMs: 10 });
    expect(envelope.peak).toBe(0);
    expect(envelope.frames.every((frame) => frame.value === 0)).toBe(true);
    expect(envelopeValueAt(envelope, -1)).toBe(0);
    expect(envelopeValueAt(envelope, envelope.durationMs)).toBe(0);
  });

  it("normalises a constant signal and subtracts a low noise floor", () => {
    const noisy = concat(tone(400, 0.01), tone(600, 0.5));
    const envelope = analyzeMouthEnvelope({ pcm: noisy, sampleRate: 1000, frameMs: 10 });
    expect(envelope.noiseFloor).toBeGreaterThan(0);
    expect(envelope.peak).toBeGreaterThan(envelope.noiseFloor);
    expect(envelope.frames.at(-1)?.value).toBeGreaterThan(0.8);
  });

  it("closes after a sustained pause while preserving attack and release", () => {
    const envelope = analyzeMouthEnvelope({
      pcm: concat(tone(240, 0.5), tone(100, 0), tone(240, 0.5)),
      sampleRate: 1000,
      frameMs: 10,
      pauseMs: 50,
    });
    const pauseFrames = envelope.frames.filter((frame) => frame.timeMs >= 240 && frame.timeMs < 340);
    expect(pauseFrames.some((frame) => frame.closed)).toBe(true);
    expect(envelope.frames[1]?.value).toBeGreaterThan(0);
    expect(envelope.frames[29]?.value).toBe(0);
    expect(envelopeValueAt(envelope, 20)).toBeGreaterThan(0);
  });
});

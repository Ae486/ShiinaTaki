/**
 * INPUT:  reply-unit surface callbacks + a ready signal (immediate, or a controllable deferred one).
 * OUTPUT: assertions that v1 surfaces immediately and that a deferred ready HOLDS units until it fires (the TTS slot).
 * POS:    unit test for the presentation gate (D21 seam). Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { createPresentationGate, type PresentationReady } from "./presentation-gate.ts";

describe("presentation gate", () => {
  it("surfaces synchronously with the default immediate ready (v1)", () => {
    const gate = createPresentationGate();
    let surfaced = false;
    gate.present(() => (surfaced = true));
    expect(surfaced).toBe(true);
  });

  it("holds units until ready fires, then releases them in order (the reserved #31 audio-ready slot)", () => {
    const queue: Array<() => void> = [];
    const deferred: PresentationReady = { whenReady: (surface) => queue.push(surface) };
    const gate = createPresentationGate(deferred);
    const order: number[] = [];

    gate.present(() => order.push(1));
    gate.present(() => order.push(2));
    expect(order).toEqual([]); // gated: nothing surfaced until "audio" is ready

    for (const surface of queue) surface();
    expect(order).toEqual([1, 2]);
  });
});

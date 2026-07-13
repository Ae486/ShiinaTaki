/**
 * INPUT:  RenderGovernor driven through a fake ticker that only invokes frame callbacks while started.
 * OUTPUT: assertions that the ticker pauses when hidden/asleep (frame count → 0), throttles on blur/idle,
 *         runs full-rate when active, and ignores throttling when the flag is off.
 * POS:    unit test for the framework-free render governor (the perf AC's provable-pause seam). Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { RenderGovernor, type TickerLike } from "./render-governor.ts";

// A controllable stand-in for PixiJS `Ticker`: `tick()` only fans out to registered callbacks while `started`,
// mirroring how a stopped ticker cancels its animation frame. Lets us count frames across a paused window.
class FakeTicker implements TickerLike {
  started = false;
  maxFPS = 0;
  private readonly callbacks = new Set<() => void>();

  start(): void {
    this.started = true;
  }
  stop(): void {
    this.started = false;
  }
  add(callback: () => void): void {
    this.callbacks.add(callback);
  }
  tick(times: number): void {
    for (let i = 0; i < times; i++) {
      if (!this.started) return;
      for (const callback of this.callbacks) callback();
    }
  }
}

function countFramesWhile(setup: (g: RenderGovernor, t: FakeTicker) => void): number {
  const ticker = new FakeTicker();
  let frames = 0;
  ticker.add(() => (frames += 1));
  const governor = new RenderGovernor(ticker);
  setup(governor, ticker);
  ticker.tick(10);
  return frames;
}

describe("RenderGovernor", () => {
  it("provably pauses when the window is hidden (zero frames while paused)", () => {
    const frames = countFramesWhile((g) => {
      g.setActivity("active");
      g.setHidden(true);
    });
    expect(frames).toBe(0);
  });

  it("pauses when the avatar is asleep", () => {
    const frames = countFramesWhile((g) => g.setActivity("asleep"));
    expect(frames).toBe(0);
  });

  it("resumes and runs frames again when unhidden", () => {
    const ticker = new FakeTicker();
    let frames = 0;
    ticker.add(() => (frames += 1));
    const governor = new RenderGovernor(ticker);
    governor.setActivity("active");
    governor.setHidden(true);
    ticker.tick(5);
    expect(frames).toBe(0);
    governor.setHidden(false);
    ticker.tick(5);
    expect(frames).toBe(5);
  });

  it("caps fps by tier: active=60, idle=30, blur=15", () => {
    const ticker = new FakeTicker();
    const governor = new RenderGovernor(ticker);
    governor.setActivity("active");
    expect(ticker.maxFPS).toBe(60);
    governor.setActivity("idle");
    expect(ticker.maxFPS).toBe(30);
    governor.setFocused(false);
    expect(ticker.maxFPS).toBe(15);
  });

  it("ignores throttling when the flag is off — full rate, never paused", () => {
    const ticker = new FakeTicker();
    const governor = new RenderGovernor(ticker);
    governor.setThrottling(false);
    governor.setActivity("asleep");
    governor.setHidden(true);
    expect(ticker.started).toBe(true);
    expect(ticker.maxFPS).toBe(60);
  });
});

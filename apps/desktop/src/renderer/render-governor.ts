/**
 * INPUT:  render-activity (from the FSM), window focus + document-visibility signals, and the `renderThrottling` flag.
 * OUTPUT: drives a PixiJS-compatible ticker — full fps when active/focused, throttled on blur/idle, STOPPED when
 *         hidden or asleep. The provable-pause the perf AC needs (issue #14).
 * POS:    ui/renderer — framework-free (ZERO React imports). Pure over an injected TickerLike so it unit-tests
 *         without a real Pixi app; signal wiring (Tauri onFocusChanged + DOM visibilitychange) lives in a hook.
 */

import type { RenderActivity } from "./state-machine.ts";

/** Structural subset of PixiJS `Ticker` — `app.ticker` satisfies it; tests pass a fake. */
export interface TickerLike {
  started: boolean;
  maxFPS: number;
  start(): void;
  stop(): void;
}

export type FpsTiers = {
  active: number; // full-rate cap (0 = uncapped)
  idle: number; // only breath/blink drift
  blur: number; // visible but unfocused
};

const DEFAULT_TIERS: FpsTiers = { active: 60, idle: 30, blur: 15 };

type GovernorInputs = {
  activity: RenderActivity;
  focused: boolean;
  hidden: boolean;
  throttling: boolean;
};

export class RenderGovernor {
  private readonly ticker: TickerLike;
  private readonly tiers: FpsTiers;
  private readonly inputs: GovernorInputs = { activity: "idle", focused: true, hidden: false, throttling: true };

  constructor(ticker: TickerLike, tiers: FpsTiers = DEFAULT_TIERS) {
    this.ticker = ticker;
    this.tiers = tiers;
    this.apply();
  }

  setActivity(activity: RenderActivity): void {
    this.inputs.activity = activity;
    this.apply();
  }

  setFocused(focused: boolean): void {
    this.inputs.focused = focused;
    this.apply();
  }

  setHidden(hidden: boolean): void {
    this.inputs.hidden = hidden;
    this.apply();
  }

  /** The `renderThrottling` config flag. Off ⇒ always full-rate, never paused (leader decision, prd). */
  setThrottling(throttling: boolean): void {
    this.inputs.throttling = throttling;
    this.apply();
  }

  private apply(): void {
    const { activity, focused, hidden, throttling } = this.inputs;
    if (!throttling) return this.run(this.tiers.active);
    if (hidden || activity === "asleep") return this.pause();
    if (!focused) return this.run(this.tiers.blur);
    this.run(activity === "active" ? this.tiers.active : this.tiers.idle);
  }

  private run(maxFps: number): void {
    this.ticker.maxFPS = maxFps;
    if (!this.ticker.started) this.ticker.start();
  }

  private pause(): void {
    if (this.ticker.started) this.ticker.stop();
  }
}

export const RENDER_FPS_TIERS = DEFAULT_TIERS;

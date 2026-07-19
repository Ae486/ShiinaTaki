/**
 * INPUT:  a loaded model (its motionManager: definitions/isFinished/state/destroyed + motion()) + an isStale probe.
 * OUTPUT: createIdleMotionScheduler({model, isStale}) -> { dispose() }. A low-freq timer that plays a random idle-pool
 *         one-shot whenever nothing is playing: a finished one-shot returns to idle (no last-frame freeze) and idle
 *         cycles at random gaps. deriveIdlePool(definitions) is exported pure for tests.
 * POS:    ui/renderer/live2d — framework-free (ZERO React imports), zero-LLM, deterministic + offline. First Hook
 *         consumer (motion-finish -> idle return); no generic hook bus yet (YAGNI) but internals stay extraction-friendly.
 */

import { MotionPriority, type Live2DModel } from "untitled-pixi-live2d-engine";

// A dedicated low-freq poll, NOT app.ticker: the render governor throttles/pauses the governed ticker exactly when the
// pet is idle (the moment idle motions must fire), so a governed-ticker scheduler would starve itself. A plain timer is
// independent of render throttling and trivially fake-timer testable. Idle CPU stays ~0% between motions (one cheap
// isFinished() poll per tick); the governed ticker still ADVANCES a playing motion at its idle tier (per
// render-governor source: idle tier runs 30fps, only HIDDEN/ASLEEP stop it — end-to-end confirmed by packaged smoke).
const TICK_MS = 700;
const MIN_GAP_MS = 4_000;
const MAX_GAP_MS = 12_000;

export interface IdleMotionScheduler {
  dispose: () => void;
}

// The minimal model surface the scheduler reads; the real Live2DModel structurally satisfies it, and a test passes a
// fake — so this module never imports the engine as a value beyond MotionPriority (mocked in tests like avatar-commands).
interface IdleMotionModel {
  motion: Live2DModel["motion"];
  internalModel: {
    motionManager: {
      definitions: Partial<Record<string, unknown[]>>;
      isFinished: () => boolean;
      destroyed: boolean;
      state: { currentPriority: MotionPriority };
    };
  };
}

export interface IdleMotionDeps {
  model: IdleMotionModel;
  // True once a newer costume switch (or teardown) superseded the model this scheduler drives — stop touching it.
  isStale: () => boolean;
}

/** Idle-pool motions: motion groups whose name reads as idle (taki: mtn_idle01_C/L/R; the C3 convention group "Idle"). */
export function deriveIdlePool(definitions: Partial<Record<string, unknown[]>>): string[] {
  return Object.keys(definitions).filter((name) => /idle/i.test(name));
}

function randomGap(): number {
  return MIN_GAP_MS + Math.floor(Math.random() * (MAX_GAP_MS - MIN_GAP_MS));
}

function pickIdle(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)] ?? pool[0] ?? "";
}

export function createIdleMotionScheduler(deps: IdleMotionDeps): IdleMotionScheduler {
  const { model, isStale } = deps;
  const mgr = model.internalModel.motionManager;
  const pool = deriveIdlePool(mgr.definitions);
  if (pool.length === 0) {
    // No idle-named motions in this costume: stay dormant (the same safe degrade the old idle-behavior no-op gave).
    console.info("[idle-motion] no idle-pool motions in the manifest; scheduler dormant");
    return { dispose: () => undefined };
  }

  let elapsed = 0; // ms since construction, advanced by TICK_MS each tick — the clock is tick-driven, so no Date.now().
  let nextPlayAt = randomGap();
  let wasPlaying = false; // last tick observed a motion playing — lets a play->finish transition be detected
  let idlePlaying = false; // the currently-playing motion is one WE started (so its finish enters the random gap)
  let timer: ReturnType<typeof setInterval> | undefined;

  const dispose = (): void => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const playIdle = (): void => {
    void model.motion(pickIdle(pool), undefined, MotionPriority.IDLE, { loop: false });
    idlePlaying = true;
    nextPlayAt = elapsed + randomGap();
  };

  const tick = (): void => {
    if (isStale() || mgr.destroyed) return dispose();
    elapsed += TICK_MS;
    if (!mgr.isFinished()) {
      wasPlaying = true;
      // A foreground motion (click/LLM NORMAL/FORCE) overrode our idle: it now owns the finish, not us.
      if (mgr.state.currentPriority > MotionPriority.IDLE) idlePlaying = false;
      return;
    }
    if (wasPlaying) {
      wasPlaying = false;
      // Our idle just ended -> space out the next one; a FOREGROUND one-shot just ended -> return to idle promptly.
      if (idlePlaying) {
        idlePlaying = false;
        nextPlayAt = elapsed + randomGap();
        return;
      }
      return playIdle();
    }
    if (!idlePlaying && elapsed >= nextPlayAt) playIdle();
  };

  timer = setInterval(tick, TICK_MS);
  return { dispose };
}

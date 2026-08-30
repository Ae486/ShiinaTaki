/**
 * INPUT:  a refresh callback (any side-effectful snapshot, e.g. the alpha-mask render+readback) and a frame interval N.
 * OUTPUT: a FrameGatedRefresher — tick() runs the refresh only on every Nth call (gated cadence), force() runs it
 *         immediately AND restarts the count from zero so a forced snapshot is never immediately doubled by the
 *         regular cadence. The helper owns NO timer/loop: it only runs when driven, so it rides whatever loop calls
 *         tick (the governed ticker) and pauses exactly when that loop pauses.
 * POS:    ui/renderer — framework-free (injected callback, no Pixi/React imports) so the cadence policy unit-tests
 *         without a renderer; pet-scene.ts drives tick from the governed ticker (P1c) and force() at the moments the
 *         silhouette can JUMP: model attach / costume switch, scene (re)build, canvas resize.
 */

export type FrameGatedRefresher = {
  /** Call once per loop frame; runs the refresh on every Nth call. */
  tick: () => void;
  /** Run the refresh immediately and reset the frame count (the cadence restarts from the forced refresh). */
  force: () => void;
};

export function createFrameGatedRefresher(refresh: () => void, interval: number): FrameGatedRefresher {
  // Defensive clamp: an interval below 1 (misconfig) degenerates to every-tick instead of never refreshing.
  const step = Math.max(1, Math.floor(interval));
  let framesSinceRefresh = 0;
  const run = () => {
    framesSinceRefresh = 0;
    refresh();
  };
  return {
    tick: () => {
      framesSinceRefresh += 1;
      if (framesSinceRefresh >= step) run();
    },
    force: run,
  };
}

/**
 * INPUT:  the DOM hidden flag; the cached window-origin state (dirty flag + age); a global cursor position, the
 *         cached client-area origin, and the scale factor (all physical px unless noted).
 * OUTPUT: the poll-economy decisions behind use-click-through — whether the poll should run at all, whether the
 *         cached window origin must be re-fetched this tick, and the cursor→canvas-local transform. The interval
 *         (~31Hz) and the origin TTL backstop live here too.
 * POS:    ui/windows/pet — pure, framework-free counterpart to click-through-toggle.ts so the poll's decisions and
 *         the coordinate transform unit-test without Tauri/React/DOM; the hook applies them per tick.
 */

// ~31Hz (widened from 24ms/~40Hz, P1d): still responsive enough that the click-through toggle feels instant — that
// feeling must be RE-VERIFIED BY HAND after this change — while cutting the always-on idle IPC rate by ~2.5x
// (one cursorPosition per tick; the window origin is cached, see shouldRefreshOrigin).
export const POLL_INTERVAL_MS = 32;

// Backstop bound on how long the cached window origin is trusted without a refresh trigger. The real triggers (drag
// end observed by the poll, Tauri onMoved/onResized dirty-marking) refresh immediately in practice; the TTL only
// caps the damage of an exotic missed trigger (e.g. a complete drag shorter than one poll interval) to ~2s of
// possibly-stale hit-testing instead of staleness forever.
export const ORIGIN_TTL_MS = 2000;

/** The poll pauses entirely while the page is hidden — the render governor pauses rendering then, so there is
 * nothing to sample (P1d; the interval itself is stopped, not just skipped). */
export function shouldPollRun(hidden: boolean): boolean {
  return !hidden;
}

export type OriginCacheState = {
  /** A window moved/resized event (or other "geometry may have changed" signal) marked the cache stale. */
  dirty: boolean;
  /** Milliseconds since the cached origin was fetched (performance.now based, hook-side). */
  ageMs: number;
};

/** Refresh the cached client-area origin only when it can have changed: a dirty mark (window moved/resized) or the
 * TTL backstop. A fresh, clean cache is the common case — no second IPC that tick. */
export function shouldRefreshOrigin(state: OriginCacheState): boolean {
  if (state.ageMs < 0) return false; // clock moved backwards; treat as fresh rather than refreshing forever
  return state.dirty || state.ageMs >= ORIGIN_TTL_MS;
}

/** THE coordinate transform (live2d-renderer.md "highest-risk line"): physical cursor − window client-area origin,
 * divided by the scale factor → canvas-local logical px. Uses innerPosition (client area), NEVER outerPosition. */
export function mapCursorToCanvas(
  cursor: { x: number; y: number },
  origin: { x: number; y: number },
  scaleFactor: number,
): { x: number; y: number } {
  return { x: (cursor.x - origin.x) / scaleFactor, y: (cursor.y - origin.y) / scaleFactor };
}

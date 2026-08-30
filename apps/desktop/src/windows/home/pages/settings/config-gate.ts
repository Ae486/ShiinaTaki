/**
 * INPUT:  the settings page's visibility (the shell's shown-page signal) and config.changed arrivals against the
 *         cached knob list, plus whether a re-read is already running.
 * OUTPUT: pure P1e reactivity decisions for use-config — apply/skip a delta while hidden, and the ONE deduped
 *         refetch on reactivation.
 * POS:    ui/windows/home/pages/settings — the node-testable core of the hidden gate (batch-7 §9.2); the hook stays
 *         glue. The subscription itself stays live: only the local apply is gated (reactive-read-models.md §d).
 */

export interface ConfigGateState {
  /** A config.changed delta arrived while the page could not observe it; the cached list is behind Core truth. */
  staleBehind: boolean;
}

export const INITIAL_CONFIG_GATE: ConfigGateState = { staleBehind: false };

/** Visible pages apply the delta locally; hidden ones skip the unobservable apply and record the gap. */
export function onConfigDelta(state: ConfigGateState, visible: boolean): { state: ConfigGateState; apply: boolean } {
  if (visible) return { state, apply: true };
  return { state: state.staleBehind ? state : { staleBehind: true }, apply: false };
}

/**
 * Reactivating with recorded gaps issues exactly ONE refetch instead of replaying the skipped deltas. While a load
 * is already in flight it WAITS (keeps the gap; the caller re-evaluates when `refreshing` settles) so requests never
 * stack — the in-flight answer may predate the skipped delta, so the settled re-evaluation issues the refetch then.
 */
export function onConfigReactivation(
  state: ConfigGateState,
  visible: boolean,
  refreshing: boolean,
): { state: ConfigGateState; refetch: boolean } {
  if (!visible || !state.staleBehind) return { state, refetch: false };
  if (refreshing) return { state, refetch: false };
  return { state: INITIAL_CONFIG_GATE, refetch: true };
}

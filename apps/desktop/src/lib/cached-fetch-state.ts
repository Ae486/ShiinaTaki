/**
 * INPUT:  the load lifecycle of one cached page read — a cache seed, a resolved value, a rejection.
 * OUTPUT: initialCachedFetch / reduceCachedFetch + the two rendering questions a page asks (isLoading, isRefreshing).
 * POS:    ui/lib — the node-testable core of use-cached-fetch. The rule that lives here rather than in the hook: a
 *         REJECTED load keeps the last good value on screen behind an error line, because blanking a page on a failed
 *         re-read is how a working surface starts looking broken.
 */

export interface CachedFetchState<T> {
  data: T | null;
  error: string | null;
  running: boolean;
}

export type CachedFetchAction<T> =
  | { kind: "start" }
  | { kind: "loaded"; value: T }
  | { kind: "failed"; reason: string }
  /** A local edit of the loaded value (a server push, an echoed write); ignored before anything is loaded. */
  | { kind: "mutate"; update: (previous: T) => T };

export function initialCachedFetch<T>(seed: T | null): CachedFetchState<T> {
  return { data: seed, error: null, running: false };
}

export function reduceCachedFetch<T>(state: CachedFetchState<T>, action: CachedFetchAction<T>): CachedFetchState<T> {
  switch (action.kind) {
    case "start":
      return state.running ? state : { ...state, running: true };
    case "loaded":
      return { data: action.value, error: null, running: false };
    case "failed":
      return { ...state, error: action.reason, running: false };
    case "mutate":
      return state.data === null ? state : { ...state, data: action.update(state.data) };
  }
}

/** No answer of any kind yet — the page shows its placeholder. */
export function isLoading<T>(state: CachedFetchState<T>): boolean {
  return state.data === null && state.error === null;
}

/** A load is running over content already on screen — the page shows its refreshing marker. */
export function isRefreshing<T>(state: CachedFetchState<T>): boolean {
  return state.running && state.data !== null;
}

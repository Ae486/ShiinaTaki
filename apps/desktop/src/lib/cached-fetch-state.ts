/**
 * INPUT:  cache seeds, actual read start/retirement, validated results, failures and local view updates.
 * OUTPUT: pure retained-snapshot transitions and truthful cold-loading/background-refresh queries.
 * POS:    ui/lib — useCachedFetch state core; request ownership and disk privacy remain separate.
 */

export interface CachedFetchState<T> {
  data: T | null;
  error: string | null;
  running: boolean;
}

export type CachedFetchAction<T> =
  | { kind: "start" }
  | { kind: "retired" }
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
    case "retired":
      return state.running ? { ...state, running: false } : state;
    case "loaded":
      return { data: action.value, error: null, running: false };
    case "failed":
      return { ...state, error: action.reason, running: false };
    case "mutate":
      return state.data === null ? state : { ...state, data: action.update(state.data) };
  }
}

/** A cold read is actually running; missing data alone is never evidence of loading. */
export function isLoading<T>(state: CachedFetchState<T>): boolean {
  return state.running && state.data === null;
}

/** A load is running over content already on screen — the page shows its refreshing marker. */
export function isRefreshing<T>(state: CachedFetchState<T>): boolean {
  return state.running && state.data !== null;
}

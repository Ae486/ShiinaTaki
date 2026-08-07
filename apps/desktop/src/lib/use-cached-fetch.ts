/**
 * INPUT:  a cache key, the loader for that page's payload (null while the socket is down) and the schema it parses with.
 * OUTPUT: useCachedFetch(key, load, options) -> { data, loading, refreshing, error, refresh, mutate }.
 * POS:    ui/lib — the ONE stale-while-revalidate seam the home pages read through. Glue only: the state rules live in
 *         cached-fetch-state.ts and WHAT may touch disk (allow-list + secret scrub) in cache-persist.ts.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import { readCache, writeCache, type CacheKey, type CacheSchema } from "./cache-persist.js";
import { initialCachedFetch, isLoading, isRefreshing, reduceCachedFetch } from "./cached-fetch-state.js";

export interface CachedFetch<T> {
  data: T | null;
  /** No answer of any kind yet — the page shows its placeholder. */
  loading: boolean;
  /** A load is running over data already on screen — the page shows its refreshing marker. */
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Local edit of the loaded value (a push, an echoed write); the next load overwrites it. */
  mutate: (update: (previous: T) => T) => void;
}

export interface CachedFetchOptions<T> {
  schema: CacheSchema<T>;
  /** true = keep the last value across window closes (allow-listed keys only, see cache-persist). */
  persist?: boolean;
}

// A non-browser render (the repo's static-markup tests) has no Storage; the cache degrades to memory-only there.
const store = (): Storage | null => (typeof localStorage === "undefined" ? null : localStorage);

export function useCachedFetch<T>(key: CacheKey, load: (() => Promise<T>) | null, options: CachedFetchOptions<T>): CachedFetch<T> {
  const { schema, persist = false } = options;
  const [state, dispatch] = useReducer(reduceCachedFetch<T>, null, () => {
    const storage = store();
    return initialCachedFetch(persist && storage ? readCache(key, schema, storage) : null);
  });
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (!load) return;
    const gen = ++generation.current;
    dispatch({ kind: "start" });
    try {
      const value = await load();
      if (generation.current === gen) dispatch({ kind: "loaded", value }); // a newer load already answered otherwise
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      if (generation.current === gen) dispatch({ kind: "failed", reason });
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loaded = state.data;
  useEffect(() => {
    const storage = store();
    if (persist && storage && loaded !== null) writeCache(key, loaded, storage);
  }, [key, persist, loaded]);

  const mutate = useCallback((update: (previous: T) => T) => dispatch({ kind: "mutate", update }), []);

  return { data: loaded, loading: isLoading(state), refreshing: isRefreshing(state), error: state.error, refresh, mutate };
}

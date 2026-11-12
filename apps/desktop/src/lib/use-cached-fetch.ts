/**
 * INPUT:  a stable scoped loader, visibility/demand policy and an explicitly classified cache schema/key.
 * OUTPUT: useCachedFetch() — retained read state, bounded refresh/invalidation and newer-push-safe local mutation.
 * POS:    ui/lib — React adapter over disposable read coordination and the existing guarded persistence allow-list.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer } from "react";
import { readCache, writeCache, type CacheKey, type CacheSchema } from "./cache-persist.js";
import { initialCachedFetch, isLoading, isRefreshing, reduceCachedFetch } from "./cached-fetch-state.js";
import { createReadCoordinator } from "./read-coordinator.ts";

export interface CachedFetch<T> {
  data: T | null;
  /** A cold read is actually running. */
  loading: boolean;
  /** A load is running over data already on screen — the page shows its refreshing marker. */
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  invalidate: () => Promise<void>;
  /** An accepted push or echo supersedes older reads, without becoming persisted authority. */
  mutate: (update: (previous: T) => T) => void;
}

export interface CachedFetchOptions<T> {
  schema: CacheSchema<T>;
  /** true = keep the last value across window closes (allow-listed keys only, see cache-persist). */
  persist?: boolean;
  /** Gates disposable reads only; callers keep their connection and mutation owner. */
  enabled?: boolean;
  /** Push-covered resources initialize through their acknowledged observer when false. */
  automatic?: boolean;
}

// A non-browser render (the repo's static-markup tests) has no Storage; the cache degrades to memory-only there.
const store = (): Storage | null => (typeof localStorage === "undefined" ? null : localStorage);

export function useCachedFetch<T>(key: CacheKey, load: (() => Promise<T>) | null, options: CachedFetchOptions<T>): CachedFetch<T> {
  const { schema, persist = false, enabled = true, automatic = true } = options;
  const [state, dispatch] = useReducer(reduceCachedFetch<T>, null, () => {
    const storage = store();
    return initialCachedFetch(persist && storage ? readCache(key, schema, storage) : null);
  });
  const reads = useMemo(() => createReadCoordinator<T>({
    started: () => dispatch({ kind: "start" }),
    loaded: (value) => dispatch({ kind: "loaded", value }),
    failed: (cause) => dispatch({ kind: "failed", reason: cause instanceof Error ? cause.message : String(cause) }),
    retired: () => dispatch({ kind: "retired" }),
  }), []);

  useLayoutEffect(() => {
    reads.replace(load);
    reads.setActive(enabled);
    if (automatic) void reads.demand();
    return () => reads.replace(null);
  }, [reads, key, load, enabled, automatic]);

  const loaded = state.data;
  useEffect(() => {
    const storage = store();
    if (persist && storage && loaded !== null) writeCache(key, loaded, storage);
  }, [key, persist, loaded]);

  const refresh = useCallback(() => reads.demand(), [reads]);
  const invalidate = useCallback(() => reads.invalidate(), [reads]);
  const mutate = useCallback((update: (previous: T) => T) => {
    reads.acceptUpdate();
    dispatch({ kind: "mutate", update });
  }, [reads]);

  return { data: loaded, loading: isLoading(state), refreshing: isRefreshing(state), error: state.error, refresh, invalidate, mutate };
}

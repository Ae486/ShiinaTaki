/**
 * INPUT:  a cache key, the value a page just loaded, the schema that value parses with, and the window's Storage.
 * OUTPUT: CacheKey + canPersist + readCache/writeCache — the guarded localStorage half of the page cache.
 * POS:    ui/lib — the privacy and trust gate of the stale-while-revalidate seam: only allow-listed keys reach disk,
 *         secrets are scrubbed before a write, and an entry the schema no longer accepts is dropped, never trusted.
 *         Storage is injected (the last-costume pattern) so the rules are testable without a DOM.
 */

const PREFIX = "taki.cache.";

/**
 * The ONLY entries allowed on disk. Everything else stays memory-only, on purpose: perception payloads carry
 * foreground-window titles, which is exactly the observation data Privacy Pause and the retention knobs bound — a
 * localStorage copy would be a second, unmanaged store of it. Chat content is out for the same reason.
 */
const PERSISTED_KEYS = ["costume-list", "config-list", "memory-status", "media-usage"] as const;
type PersistedKey = (typeof PERSISTED_KEYS)[number];

/** Named so the union stays closed, but unwritable by construction: canPersist refuses it. */
type MemoryKey = "perception-card";

export type CacheKey = PersistedKey | MemoryKey;

/** The zod surface the cache needs, taken structurally so lib/ pulls in no validator of its own. */
export interface CacheSchema<T> {
  safeParse: (value: unknown) => { success: boolean; data?: T };
}

export function canPersist(key: string): key is PersistedKey {
  return (PERSISTED_KEYS as readonly string[]).includes(key);
}

function isSecret(entry: unknown): boolean {
  return typeof entry === "object" && entry !== null && "secret" in entry && (entry as { secret: unknown }).secret === true;
}

// Secret knobs are already masked server-side (value: null), so this is the second lock on invariant 5: even a
// regression up there cannot put a credential-shaped row on disk.
function stripSecrets(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("entries" in value)) return value;
  const { entries } = value as { entries: unknown };
  return Array.isArray(entries) ? { ...value, entries: entries.filter((entry) => !isSecret(entry)) } : value;
}

const SCRUBBERS: Partial<Record<PersistedKey, (value: unknown) => unknown>> = { "config-list": stripSecrets };

export function readCache<T>(key: CacheKey, schema: CacheSchema<T>, storage: Storage): T | null {
  if (!canPersist(key)) return null;
  const raw = storage.getItem(PREFIX + key);
  if (raw === null) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data !== undefined ? parsed.data : null;
  } catch {
    return null; // a corrupt entry is a cache miss, never a payload
  }
}

export function writeCache(key: CacheKey, value: unknown, storage: Storage): void {
  if (!canPersist(key)) {
    console.warn(`[cache] refused to persist "${key}" — not on the allow-list`);
    return;
  }
  const scrub = SCRUBBERS[key];
  try {
    storage.setItem(PREFIX + key, JSON.stringify(scrub ? scrub(value) : value));
  } catch (cause) {
    // A full or blocked storage must not break the page: the cache is an optimization, never the source of truth.
    console.warn(`[cache] could not persist "${key}"`, cause);
  }
}

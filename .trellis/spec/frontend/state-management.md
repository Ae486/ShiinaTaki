# State Management

**Library: Zustand ^5** (chosen for footprint and no-provider ergonomics in a multi-window app).

## Where state lives (decision table)

| State | Home |
| --- | --- |
| State of record (sessions, memory, config, global permission policy) | Agent Core DB — the UI only caches disposable read views |
| Cross-component UI state (connection status, active character, pending approvals, chat transcript cache) | Zustand stores in `src/stores/` |
| Animation state (idle/thinking/working/sleeping) | `renderer/state-machine.ts` — mirrored INTO a store for React display, driven by WS events |
| Single-component state (input drafts, open/closed) | `useState` in the component |
| Settings form values | Local form state; persisted via WS config API on save — never a local settings store of record |
| Permission Level / governance cells | Fresh Core snapshot per authenticated Home client generation; component/controller memory only, never cache/localStorage |

## Rules

- One store per domain (`connection-store.ts`, `character-store.ts`, `approval-store.ts`), each under 150 lines. No single `app-store.ts` god store.
- Stores are created with `create<T>()(...)`; state shape typed explicitly; actions defined inside the store (components never `setState` on stores directly).
- Select narrowly: `useStore(s => s.status)`, never `useStore()` whole-store subscriptions in components.
- Each window (pet, settings) instantiates its own stores; cross-window sync goes through the Agent Core (WS events) or Tauri events — never assume shared JS memory between windows.
- No persistence middleware: durable state belongs to the Agent Core, not localStorage. The only disk-backed UI cache is
  the guarded SWR snapshot seam below; it is never writable state of record.
- A connection owner publishes `{ client, status }` atomically per authenticated/restored generation. Consumers rerun
  idempotent reads when client identity changes; they never retain a closed client or replay a mutation.
- D59/D61 timing policy is window-owned, in-memory, and last-good across client generations. Core config is the only
  persisted authority; see `operator-connection-recovery.md`.
- Foreground Chat/Pet activity uses the shared generation/Character recovery adapter and feature-local disposable
  views. Keep initiating request acknowledgement/draft state separate from observed activity, and commit complete
  Timeline batches atomically. Presence/layout state cannot authorize a retry or cancellation. See
  [Foreground Chat Feedback](foreground-chat-feedback.md); none of this content enters a persisted cache.
- Permission policy is more restrictive than an ordinary cached read: it refetches from Core for every replacement
  Home client, ignores retired-client results, serializes mutations, and never enters `useCachedFetch`, the persistence
  allow-list, Zustand persistence, or `localStorage`. A stale mutation refetches after `POLICY_CONFLICT`; a timeout or
  reconnect never replays the mutation.

## Scenario: Guarded stale-while-revalidate page snapshots

### 1. Scope / Trigger

Use `useCachedFetch` for read-only home-page payloads that benefit from showing the last good answer while the Core is
re-read. Persist across window closes only when the payload has been privacy-classified, explicitly allow-listed, and
safe after field-level scrubbing. This is a disposable rendering optimization, not a second database.

### 2. Signatures

```typescript
type CacheKey =
  | "costume-list"
  | "config-list"
  | "memory-status"
  | "media-usage"
  | "perception-card"; // memory-only

useCachedFetch<T>(
  key: CacheKey,
  load: (() => Promise<T>) | null,
  options: { schema: CacheSchema<T>; persist?: boolean; enabled?: boolean; automatic?: boolean },
): {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh(): Promise<void>;
  invalidate(): Promise<void>;
  mutate(update: (previous: T) => T): void;
};

canPersist(key: string): boolean;
readCache<T>(key: CacheKey, schema: CacheSchema<T>, storage: Storage): T | null;
writeCache(key: CacheKey, value: unknown, storage: Storage): void;
```

### 3. Contracts

- The persisted allow-list is closed to exactly `costume-list`, `config-list`, `memory-status`, and `media-usage`.
  `perception-card` may use the hook in memory only. Perception pause and chat content have no cache key at all.
- Every disk read is JSON-decoded and passed through the caller's zod-compatible `safeParse`; corrupt or schema-drifted
  entries become cache misses. Never cast a cache entry into application data.
- Before `config-list` reaches storage, remove every entry with `secret: true`, even though the Core currently masks
  secret values. Adding a persisted key requires a privacy review, an allow-list edit, and tests in the same change.
- A cache hit renders immediately while revalidation runs and exposes the real `refreshing` state. Shared
  `PendingIndicator` reserves a small slot and reveals only slow work; fast reads need no flashing label. This
  presentation delay never postpones the result or changes authority. A rejected revalidation keeps permitted
  last-good data with a persistent error and retry action.
- Storage absence, corruption, quota failure, or blocked writes degrade to memory-only behavior. They must not break the
  page. `load === null` means there is currently no transport and `refresh()` is a no-op; D59 owns connection status and
  reconnection rather than this cache hook. Null/replacement/disabled reads retire pending success and failure alike;
  an old completion cannot restore current data or leave a permanent loading flag.
- `enabled` gates disposable read work, while `automatic: false` lets a feature's acknowledged observer initiate its
  baseline. Neither option cancels, unlocks or replays a Core/Host mutation; command lifetime is owned separately.
- `refresh` joins an owned flight. `invalidate` records a real change and leaves at most one trailing obligation.
  Failure keeps the dirty gap and ends the active read; it does not start a retry loop. See `read-coordinator.ts`.
- `mutate` edits only an already-loaded view and marks the accepted push/echo newer than preceding reads. A covering
  current read can replace it; an uncovered older response/error cannot regress it. It does not create authority.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|-----------|-------------------|
| Key is not on persisted allow-list | Refuse write, warn, leave storage untouched |
| Cache JSON is corrupt | Return `null` cache miss |
| Cache fails current schema | Return `null` cache miss |
| `config-list` contains `secret: true` rows | Strip those rows before serialization |
| `localStorage` is unavailable or write throws | Continue with memory/network state; warn on failed write |
| Revalidation rejects with prior data | Keep prior data, expose error, stop refreshing |
| Revalidation rejects cold | Keep `data: null`, expose error, do not claim loading forever |
| A newer load starts before an older one resolves | Ignore the older generation's result |
| Null loader, hidden/disabled consumer or retired scope during a read | Ignore its late success/failure and clear actual in-flight presentation |
| Duplicate demand / finite invalidation burst during a read | Join one flight / retain one trailing covering read |
| Accepted push or write echo races an older snapshot | Preserve the accepted update; reconcile uncovered changes before claiming freshness |

### 5. Good/Base/Bad Cases

- Good: validated cache seed stays mounted -> quiet fast read or non-displacing slow indicator -> fresh Core response.
- Base: no cache renders a placeholder; a failed refresh preserves last-good content and exposes retry/error state.
- Bad: ad hoc `localStorage.setItem`, persisting perception/chat/pause state, trusting parsed JSON without a schema, or
  clearing the page on a transient Core failure.

### 6. Tests Required

- `lib/cache-persist.test.ts`: exact allow-list, perception/pause rejection, schema-drift/corrupt reads, storage failure,
  and secret-row stripping.
- `lib/cached-fetch-state.test.ts` and `read-coordinator.test.ts`: cache seed, cold/retired loading, refresh retention,
  demand joining, trailing invalidation, old success/failure suppression and newer push/echo protection.
- Each wired page: assert the matching shared schema, `persist` posture, truthful non-displacing pending state, last-good error presentation,
  and manual Refresh action where the operator can recover.
- Privacy regression: source/test sweep must keep perception payloads, pause state, chat content, and secrets out of
  `taki.cache.*` entries.

### 7. Wrong vs Correct

```typescript
// Wrong: unvalidated, unmanaged, potentially sensitive second store.
localStorage.setItem("page", JSON.stringify(result));
const value = JSON.parse(localStorage.getItem("page")!) as PageResult;

// Correct: one guarded seam; persistence is explicit and reads are schema-gated.
const page = useCachedFetch("memory-status", load, {
  schema: MemoryStatusResultSchema,
  persist: true,
});
```

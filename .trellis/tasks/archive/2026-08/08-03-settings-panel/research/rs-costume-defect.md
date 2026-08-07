# Research: costume-switch boundary handling lost in the batch-4 home migration

- **Query**: owner-reported real-machine defect — after one costume fails to switch, every later switch silently does nothing (home highlights the new row, the pet never changes) until the window is reopened. Plus a "lazy migration" audit of every surface batches 2–4 touched, and a data-loading inventory for stale-while-revalidate.
- **Scope**: internal (code + git history + docs)
- **Date**: 2026-08-04
- **Working tree note**: batch-5 work is uncommitted. Everything below reads the WORKING TREE. Where the working tree differs from HEAD it is called out; for the costume path the batch-5 diff is purely visual (PageCard/PageAlert/ActionButton/Badge restyle), so no behavior in this report comes from uncommitted code.

---

## A. The original boundary layer (pet-side panel, pre-batch-4)

### A1. What the executor hook exposes — unchanged to this day

`apps/desktop/src/features/character-import/use-costume-switch.ts` is **byte-unchanged since M4** (last touched in `4e45a27`, "costume-switch timeout+panel fixes (T1 1a/1b/D17/Fix1/Fix2)"). It still exports the full boundary surface:

`use-costume-switch.ts:19-29`
```ts
export interface CostumeSwitch {
  costumes: string[]; // renderable first (stable within each half) — the panel renders them in this order
  availability: Record<string, CostumeAvailability>;
  missingPacksUnion: string[]; // owners whose packs would unlock/complete costumes — feeds the panel's notice row
  current: string | null;
  switchingId: string | null; // the costume currently mid-switch (drives that ONE row's spinner + Cancel), else null
  error: string | null;
  switchTo: (costume: string) => Promise<void>;
  cancelSwitch: () => void; // abort the in-flight switch and release the panel immediately (does not wait out the timeout)
  refresh: () => Promise<void>;
}
```

The in-flight bookkeeping is a ref carrying an id plus a generation counter:

`use-costume-switch.ts:98-100`
```ts
  // Ref mirror of the in-flight switch (id for the re-entrancy guard + a generation so a cancelled switch's late
  // catch/finally is a no-op). switchTo's useCallback deps intentionally omit switching state, so it reads the ref.
  const inFlight = useRef<{ id: string | null; gen: number }>({ id: null, gen: 0 });
```

Single-flight gate — a second click while one switch runs is a **silent** no-op by design, because the panel was expected to show a spinner on the busy row:

`use-costume-switch.ts:116-129`
```ts
  const switchTo = useCallback(
    async (costume: string) => {
      const settingsFile = state.files[costume];
      // The panel disables unrenderable rows; this guard makes the no-op authoritative rather than cosmetic.
      if (!client || !scene || !settingsFile || state.availability[costume]?.renderable === false) return;
      if (inFlight.current.id !== null) return; // one switch at a time (ref, not the stale-closure state)
      await runGuardedSwitch({ client, scene, costume, settingsFile }, inFlight, {
        setSwitchingId,
        setError,
        onSuccess: () => setState((prev) => ({ ...prev, current: costume })),
      });
    },
    [client, scene, state.files, state.availability],
  );
```

Release happens **only** when the promise settles, in `runGuardedSwitch`:

`use-costume-switch.ts:69-90`
```ts
async function runGuardedSwitch(req, guard, sink): Promise<void> {
  const gen = guard.current.gen + 1;
  guard.current = { id: req.costume, gen };
  sink.setSwitchingId(req.costume);
  sink.setError(null);
  try {
    await resolveSwitchReport({ ...req, timeoutMs: SWITCH_TIMEOUT_MS });
    saveLastCostume(ACTIVE_CHARACTER_ID, req.costume, localStorage); // restarts re-wear this costume (B7/B19)
    sink.onSuccess();
  } catch (cause) {
    if (guard.current.gen === gen) sink.setError(`${req.costume}: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    if (guard.current.gen === gen) {
      guard.current = { id: null, gen };
      sink.setSwitchingId(null);
    }
  }
}
```

Cancel is the only path that releases the guard **without** waiting for the promise:

`use-costume-switch.ts:131-139`
```ts
  // Operator Cancel: abort the in-flight switch (its late model self-discards via the switch ticket, 1f Fix 1) and
  // release the panel NOW — the pending resolveSwitchReport settles later (up to the timeout) but the bumped generation
  // makes its catch/finally a no-op, so no stale error toast contradicts the cancel.
  const cancelSwitch = useCallback(() => {
    if (inFlight.current.id === null) return;
    scene?.abortSwitch();
    inFlight.current = { id: null, gen: inFlight.current.gen + 1 };
    setSwitchingId(null);
  }, [scene]);
```

Timeout budget: `use-costume-switch.ts:62` → `const SWITCH_TIMEOUT_MS = 30_000;`

### A2. The C3-wedge mitigation, in code

HANDOFF §5 says "Roaming C3 costume-switch wedge: root cause unknown, fully mitigated". The mitigation is three cooperating pieces:

| Piece | Location | What it does |
|---|---|---|
| Timeout guard | `apps/desktop/src/lib/resolve-switch-report.ts:36-41` | `withTimeout(deps.scene.switchCostume(source), deps.timeoutMs, ...)` — a load that never finishes rejects at 30 s instead of hanging forever |
| Switch ticket (Fix 1) | `apps/desktop/src/renderer/pet-scene.ts:128-145` | every switch takes `const ticket = ++ctx.seq.current`; `abortSwitch()` bumps `ctx.seq.current`, so a late-resolving model sees `isStale()` true and self-destroys in `renderer/live2d/costume-switch.ts:47-52` instead of attaching |
| Abort-on-failure | `resolve-switch-report.ts:36-41` | the `.catch` calls `deps.scene.abortSwitch()` then rethrows, so timeout AND ordinary failure both invalidate the in-flight load |
| Cancel (Fix 2) | `use-costume-switch.ts:134-139` + old panel UI | operator-driven early release + generation bump |

Load-before-teardown means a failed load leaves the currently-worn model on screen untouched — `renderer/live2d/costume-switch.ts:41-57`, the old model is destroyed only after the new one has loaded and passed the staleness check.

Also relevant: `use-initial-costume.ts:55-65` — the boot promotion has its own guarded fallback (remembered costume wedges → fall back to the default costume) so the pet never boots invisible.

### A3. What the deleted panel actually rendered

Recovered with `git show 0b06eb3^:apps/desktop/src/features/character-import/character-panel.tsx` (147 lines, deleted whole in `0b06eb3`).

| Hook state | Old panel rendering | Recovery action offered |
|---|---|---|
| `switchingId === row.id` | `<SwitchingRow>` — spinner + costume name **in place of** the normal row | inline **取消** (Cancel) button wired to `costume.cancelSwitch` |
| `switchingId !== null`, other rows | rows stay live and clickable (a click is a safe no-op via the ref guard) | — the list never froze |
| `error` (or `importState.error`) | `{notice && <p className="text-xs text-rose-600">{notice}</p>}` at the panel foot | — visible text naming the costume and the reason |
| `availability[id].renderable === false` | row rendered `disabled`, sorted to the bottom, under the missing-packs notice | — |
| `availability[id].missingMotions > 0` | amber `⚠ 缺 N 动作` badge, row stays selectable | — |
| `missingPacksUnion` | amber "需导入其他角色包…" notice row | — |
| `current` | row highlighted dark — set **only** by `onSuccess`, i.e. only after the switch actually completed | — |

Verbatim, the cancel affordance that no longer exists anywhere:

```tsx
// The ONE costume currently mid-switch: a spinner + name + an inline Cancel that aborts the switch and releases the
// panel immediately (Fix 2 — a wedged load no longer freezes the whole list for the full timeout).
function SwitchingRow({ id, onCancel }: { id: string; onCancel: () => void }) {
  return (
    <div className="flex w-full items-center justify-between rounded-md bg-slate-800 px-2 py-1 text-xs text-white">
      <span className="flex items-center gap-1.5 truncate">
        <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        <span className="truncate">{id}</span>
      </span>
      <button type="button" onClick={onCancel} className="ml-2 shrink-0 text-slate-300 hover:text-white">
        取消
      </button>
    </div>
  );
}
```

This panel is exactly what manual check **#75** (`docs/devlog/manual-checks.md:155`) validates:

> **75. 面板超时不卡死（Fix2）**：点一件会超时的服装 → 只有那一行 spinner/禁用，其余行仍可点；有 Cancel 可提前取消；取消/超时后面板立即恢复，无需关闭重开。

Manual check **#74** (same file, line 154) additionally requires that after a timeout "面板高亮…停在换前那套" — the highlight must NOT move to the timed-out costume.

---

## B. The wedge in the new path

### B1. The call chain, with lines

1. **Click** — `windows/home/pages/costume/costume-page.tsx:88`
   `<CostumeRow ... onSelect={() => void costume.select(row.id)} />`
   The row is disabled only for `!row.renderable` (line 47). There is no busy state, no spinner, no per-row disable while a switch runs.

2. **Home page hook** — `windows/home/pages/costume/use-costume-page.ts:47-56`
```ts
  const select = useCallback(async (costumeId: string) => {
    setError(null);
    try {
      await requestCostumeSwitch(costumeId);
      setSelected(costumeId);
    } catch (cause) {
      // The pet window may be closed or the event undeliverable — say so instead of leaving a dead click.
      setError(`无法通知宠物窗口换装：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, []);
```
   `setSelected(costumeId)` is **optimistic and unconditional** on emit success. `costume-page.tsx:61` then renders `const current = costume.selected ?? costume.view.current;` — so the clicked row highlights immediately and forever, regardless of what the pet does.

3. **Emit** — `lib/costume-switch-event.ts:21-23`
```ts
/** Commands the pet window to wear `costumeId`. Rejects if the event cannot be delivered (the page toasts it). */
export async function requestCostumeSwitch(costumeId: string): Promise<void> {
  await emitTo(PET_LABEL, COSTUME_SWITCH_EVENT, { costumeId } satisfies CostumeSwitchPayload);
}
```
   **The doc comment overstates what `emitTo` guarantees.** Installed `@tauri-apps/api@2.11.1`, `event.js:151-158`:
```js
async function emitTo(target, event, payload) {
    const eventTarget = typeof target === 'string' ? { kind: 'AnyLabel', label: target } : target;
    await invoke('plugin:event|emit_to', { target: eventTarget, event, payload });
}
```
   It resolves once the Rust side has dispatched to whatever listeners match the label. A closed pet window, or an open pet window with no listener yet, is not an error. So the `catch` in step 2 essentially never fires, and the page's own hint "关闭宠物窗口时无法切换" is never actually surfaced as a failure.

4. **Pet-side listener** — `windows/pet/use-costume-switch-event.ts:14-36`
```ts
export function useCostumeSwitchEvent(scene: PetScene | null): void {
  const { switchTo } = useCostumeSwitch(scene);

  useEffect(() => {
    ...
    void listen(COSTUME_SWITCH_EVENT, (event) =>
      handleCostumeSwitch(event.payload, {
        apply: (costumeId) => void switchTo(costumeId),
        warn: (message, payload) => console.warn(message, payload),
      }),
    )
    ...
  }, [switchTo]);
}
```
   **This is the defect site.** Line 15 destructures **only `switchTo`**. `switchingId`, `error`, `cancelSwitch`, `current`, `costumes`, `availability`, `refresh` are all computed, stored in React state, and thrown away. Line 22's `void switchTo(costumeId)` also discards the returned promise, so any rejection is unobserved.

5. **Executor** — `use-costume-switch.ts:116-129` → `resolve-switch-report.ts:24-46` → `pet-scene.ts:128-137` → `renderer/live2d/costume-switch.ts:41-57`.

### B2. Where a failure leaves each side

| Side | State after a failed switch | Visible? | Recoverable? |
|---|---|---|---|
| Home page | `selected` = the costume that failed; row stays highlighted | highlight is visible and **wrong** | no — nothing ever resets it |
| Home page | `error` = null (it only catches emit failures, not switch failures) | nothing shown | — |
| Pet hook | `error` = `"<costume>: <reason>"` in React state | **nothing renders it** | — |
| Pet hook | `switchingId` back to null (normal path) | nothing renders it | — |
| Pet hook | `inFlight.current` released **iff** the promise settled | — | `cancelSwitch` exists but is wired to nothing |
| Pet scene | `abortSwitch()` bumped the ticket; previous model still attached | correct, no drift | fine |
| Core | no `avatar.report` sent (the re-report sits downstream of the guard) | — | fine |

### B3. Root cause — one sentence

**The migration moved the costume UI to the home window but kept only the executor function from the pet-side hook, so the switch's in-flight, error and cancel states are now computed into a hook instance that nothing renders — the operator sees an optimistic highlight from the home page and never sees the pet's failure, and the one control that could release a stuck single-flight guard (`cancelSwitch`) is no longer reachable from any UI.**

### B4. Which concrete mechanism produces "every later click does nothing"

Three mechanisms all fit the symptom. All three are silent and all three end at the same place — `use-costume-switch.ts:120-121`, where `switchTo` returns without doing anything. Ranked by how confident the code makes me:

**(i) The single-flight guard is never released because the promise never settles. (Certain if any of four awaits hang; this is the only mechanism that is permanent AND matches "no error, no cancel" exactly.)**

`inFlight.current.id` is cleared only in `runGuardedSwitch`'s `finally` (`use-costume-switch.ts:84-89`). `resolve-switch-report.ts` has four awaits and **only one of them is timeout-guarded**:

```ts
export async function resolveSwitchReport(deps: SwitchReportDeps): Promise<void> {
  const { resolution } = await deps.client.costumeResolution(...);          // :26  NO timeout
  const source = await costumeAssetResolver({ ... });                       // :27  NO timeout
  const vocabulary = await withTimeout(deps.scene.switchCostume(source), deps.timeoutMs, ...) // :36 guarded, 30 s
    .catch((cause) => { deps.scene.abortSwitch(); throw cause; });
  await deps.client.reportAvatar({ ... });                                  // :45  NO timeout
}
```

- Line 26 and 45 are JSON-RPC requests. `lib/ws-client-methods.ts:88-91` and `:71-76` call `rpc.request(...)` with **no per-request deadline**; the only thing that ever settles a pending request is the socket's close handler, `lib/ws-client-routes.ts:150-154`:
```ts
  transport.onClose(() => {
    closed = true;
    rpc.rejectAllPendingRequests("connection closed");
    abortTurn(state, CONNECTION_LOST_MESSAGE);
  });
```
  A Core that stops answering while the TCP socket stays open (a half-open socket after sleep/resume is the classic case on Windows) leaves line 26 or 45 pending **forever**, and with it the guard.
- Line 27 is Tauri IPC (`homeDir()` / `join()` in `lib/character-asset-url.ts:71-73`) — also unbounded.

Once the guard is stuck, every subsequent click hits `if (inFlight.current.id !== null) return;` and returns instantly. Nothing is logged, nothing is rendered, and the escape hatch (`cancelSwitch`) has no UI. Only a pet-window reload clears it. This is a precise match for the owner's description.

**(ii) A 30-second window where every click is silently dropped. (Certain — happens on every timeout, not just on a hang.)**

Even in the fully working timeout path, the guard stays set for the entire `SWITCH_TIMEOUT_MS = 30_000`. With the old panel that window was obvious (spinner on the row, Cancel available). With the new page there is zero indication: the operator clicks four different costumes, each highlights, none does anything. This is manual check #75 regressing to exactly the pre-Fix2 behavior — and to an operator it is indistinguishable from "permanently broken" unless they happen to wait out the full 30 s and then click again.

**(iii) The costume map is wiped to empty by one failed refresh and never restored. (Certain once it happens; needs a rejected `character.costumes`.)**

`use-costume-switch.ts:102-114`:
```ts
  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const result = await client.characterCostumes(ACTIVE_CHARACTER_ID);
      setState((prev) => toState(result, prev.current));
    } catch {
      setState(EMPTY); // no imported character yet (dev route) — empty switcher
    }
  }, [client]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);
```
`EMPTY` (line 38) has `files: {}`. After a wipe, `state.files[costume]` is `undefined` for every costume, so `switchTo` returns at line 120 forever. `refresh` only re-runs when `connected` transitions — and **neither window reconnects**: `windows/pet/use-core-connection.ts:47` and `windows/home/use-home-connection.ts:43` both just set status `disconnected` on close with no retry. So a single rejected `character.costumes` disables the pet's switch path for the rest of the window's life, silently.

**Not the cause:** the home side cannot wedge. `select` has no in-flight guard, `emitTo` keeps resolving, and the pet-side listener re-registers cleanly (the effect's dep `switchTo` only changes identity when `state.files`/`state.availability` change, which after the initial refresh does not happen on success — `onSuccess` spreads the same `files`/`availability` references, `use-costume-switch.ts:125`). Reopening the **home** window would not fix any of (i)–(iii); reopening the **pet** window would fix all three.

### B5. Feedback channel from pet back to home today

**There is none.** `lib/costume-switch-event.ts` defines exactly one event, `pet:costume-switch` (line 14), emitted home → pet only. The home costume page never subscribes to anything:
- it does not listen for avatar events (the avatar push handler is registered only in the pet window, `use-core-connection.ts:65`);
- it does not re-fetch after a switch (`refresh` is called only on connect, `use-costume-page.ts:43-45`, and after an import, `costume-page.tsx:71`);
- `character.costumes` does not report the worn costume anyway — `costumeListView` derives `current` from `loadLastCostume(...)` in localStorage (`costume-view.ts:38-39`), and `saveLastCostume` is written by the **pet** window only after a successful switch (`use-costume-switch.ts:80`).

That last point is a usable seam: localStorage is shared same-origin across the two webviews, so the pet already persists ground truth there — but the home page reads it once at refresh time and never re-reads, and localStorage writes in one webview do not notify another Tauri webview.

Both windows do have a working per-window toast surface (`components/toast/toast-store.ts:35`, hosts mounted at `pet-stage.tsx:66` and `home-shell.tsx:70`) — the pet window can already show a toast today without any new plumbing.

---

## C. Same-class sweep — did other migrated surfaces lose their edges?

| Surface | Old edge handling | New state | Verdict |
|---|---|---|---|
| **Costume switching** | spinner on the busy row, Cancel, error line, highlight only on success (`character-panel.tsx`) | no busy state; no cancel; pet-side `error`/`switchingId` computed and discarded (`use-costume-switch-event.ts:15`); highlight set optimistically (`use-costume-page.ts:51`) | **EDGES DROPPED** — all four. Manual checks #74 and #75 both regress |
| **Character import** | `isImporting` → button label/disable; `error` → red line; `result` → green line; `warnings` → amber line | identical set, all four rendered: `costume-page.tsx:34-38` (button), `:68` (error via `PageAlert`), `:72-76` (result), `:77-79` (warnings) | **INTACT.** Note `use-character-import.ts` exposes no progress fraction and never did — a large `.zst` shows only "导入中…"; that is unchanged, not a regression. Import failure and switch failure share one `PageAlert` slot (`costume-page.tsx:62`), so whichever is non-null wins |
| **Chat page move (batch 2)** | `windows/chat/chat-window.tsx`: StatusBanner, ToastHost, header | StatusBanner preserved verbatim (`chat-page.tsx:18-37`, `:46`); ToastHost relocated to the shell (`home-shell.tsx:70`) so `pushToast` from `use-chat-timeline.ts:83`/`:95` still renders; header replaced by shared `PageHeader`; own socket retained (`use-chat-connection.ts`) | **INTACT** — the only removal was the local ToastHost, which the shell now provides once |
| **Operations — tidy** | new surface | `runTidy` guarded by `tidying` and released in `finally` (`use-operations.ts:50-62`); failure → `setError` → `PageAlert` (`operations-page.tsx:22`); button shows "整理中…" | **INTACT** |
| **Operations — media clear** | new surface | two-step confirm; `mediaClear` failure → `setError` rendered at `storage-card.tsx:43`; `finally` resets phase and refreshes (`use-media-clear.ts:34-37`) | **INTACT** |
| **Operations — status/usage load** | new surface | `Promise.all([memoryStatus, mediaUsage])` failure → shared `error` banner (`use-operations.ts:41-43`); cards show "载入中…" | **INTACT**, with one wrinkle: the two calls share one catch, so one failure blanks both cards and the placeholder still says "载入中…" while the banner says it failed |
| **Perception — pause set** | new surface | `perceptionPauseSet` failure → `fail()` → `PageAlert` (`use-perception.ts:51-53`, `perception-page.tsx:44`); state is echoed from the server, never assumed | **INTACT** |
| **Perception — card/pause load** | new surface | same shared-catch shape as operations; "读取中…" placeholders | **INTACT** (same shared-catch wrinkle) |
| **Settings — config load** | new surface | `configList`/`subscribeConfig` failure → `error` → "读取配置失败：…" (`settings-page.tsx:19`) | **INTACT** |
| **Settings — config set** | new surface | refusals mapped to per-knob notices (`use-config.ts:49-53`) | **INTACT** (owner already confirmed) |

**Cross-cutting gap that is not a migration regression but bites every page:** neither connection hook reconnects (`use-home-connection.ts:39-52`, `use-core-connection.ts:42-56`). Every page's data seam fires exactly once, on the single `connected` transition. After a drop, the home window shows stale data with no banner (only the chat page has a StatusBanner, `chat-page.tsx:46`) and no page recovers without being reopened.

---

## D. Data-loading inventory and a stale-while-revalidate shape

### D1. What each page fetches and what it shows while waiting

| Page | Fetched on mount (gated on `connected`) | Rendering during the wait | Cacheable? |
|---|---|---|---|
| Costume | `character.costumes` (`use-costume-page.ts:36`) | `"尚未导入角色（开发环境使用内置模型）"` — **an empty state, not a loading state** (`costume-page.tsx:84`). Looks like a wrong answer, not a pending one | yes — costume ids, availability, missing packs, settings filenames |
| Operations | `memory.status` + `media.usage` in one `Promise.all` (`use-operations.ts:38`) | `"载入中…"` on both cards (`operations-page.tsx:39`, `storage-card.tsx:25`) | yes — counters and byte totals |
| Perception | `perception.card` + `perception.pauseGet` (`use-perception.ts:32`) | `"读取中…"` sampling card + `"暂无活动记录"` for activity rows + pause buttons rendered in a wrong-looking default state (`paused = pause?.paused ?? false`, `pause-controls.tsx:19`, so 恢复观察 is disabled and 暂停观察 enabled before the truth arrives) | **partly** — see privacy note below |
| Settings | `config.list` + `config.subscribe` (`use-config.ts:34`) | `"载入中…"` (`settings-page.tsx:20`) | yes — keys, values, provenance, apply mode |
| Chat | `timeline.subscribe` then `timeline.history` on its own socket (`use-chat-timeline.ts:19-23`) | timeline store `loaded` flag drives its own view | **no** — conversation content |

### D2. Lifecycle facts that constrain the cache

- The home window is a plain `WebviewWindow` created in `lib/open-home-window.ts:31-37`. There is **no** close interception anywhere in `apps/desktop/src-tauri/src` (grep for `prevent_close`/`hide` returns nothing relevant), so closing it destroys the webview: all React state and all module-level memory die. `openHome` calls `existing.show()` only for a window that is still alive.
- `localStorage` is per-origin, survives window close, and is already shared between the pet and home webviews — `lib/device-identity.ts` and `lib/last-costume.ts` both rely on this.
- So a memory-only cache buys nothing across a close/reopen, which is the exact case the owner is complaining about. Persistence has to be localStorage.

### D3. Privacy constraints per payload

Safe to persist to localStorage:
- costume list, availability, missing packs, settings filenames — model metadata already sitting on disk;
- config entries — keys, effective values, provenance. **One caveat**: `config.list` is the 34-knob registry; if any knob is ever a secret (an API key), caching it writes a credential into `localStorage`, which violates invariant 5. The registry is Core-side; a cache must either whitelist keys or honour a "sensitive" flag rather than blanket-store the list;
- `media.usage` byte totals and counts;
- `memory.status` counters — the method is documented as "never content" (`ws-client.ts:75`).

Do **not** persist:
- `perception.card` — `activityRows` renders foreground-window titles and recent activity stretches. That is observation content about the user; writing it to localStorage creates a second, unmanaged copy of exactly the data the Privacy Pause and retention policy exist to bound (see D46/D47 in `docs/deferred-decisions.md`). Cache the *sampling status* if useful, not the activity entries;
- anything from the chat timeline (conversation content, attachments);
- `perception.pauseGet` is cheap and safety-relevant — showing a stale "not paused" is worse than showing "读取中…". Fetch it fresh.

### D4. Recommended shape (recommendation only — not built)

Every page hook already has the same three lines:

```ts
const [x, setX] = useState<T | null>(null);
const refresh = useCallback(async () => { try { setX(await client.someCall()); } catch (c) { fail(c); } }, [client]);
useEffect(() => { if (connected) void refresh(); }, [connected, refresh]);
```

The natural seam is one small hook in `apps/desktop/src/lib/` that keeps that signature and adds a persisted seed, roughly:

```
useCachedFetch<T>(key: string, load: () => Promise<T>, options?: { persist?: boolean })
  -> { data: T | null, stale: boolean, error: string | null, refresh: () => Promise<void> }
```

- `data` seeds synchronously from `localStorage[key]` on first render (parsed through the same `@taki/shared` zod schema the WS layer already uses, so a corrupted or schema-drifted cache entry is dropped rather than trusted — the zod boundary rule holds for the cache too);
- `stale: true` until the live fetch lands, so pages can render real content immediately with a small "更新中" marker instead of "载入中…";
- `persist: false` (the default for anything content-bearing) keeps it memory-only, which is what perception's card and the chat timeline need;
- on fetch failure with cached data present, keep showing the cached data and surface the error in the existing `PageAlert` rather than blanking the card.

Adopting it would be a per-hook one-liner swap in `use-config.ts`, `use-operations.ts`, `use-perception.ts` and `use-costume-page.ts`. It also fixes the costume page's misleading empty state, which currently cannot tell "still loading" from "no character imported".

---

## E. Fix-design ingredients for the batch-6 design (inputs, not a design)

Raw materials the leader will need. Presented as the pieces that exist and the gaps between them, not as a chosen design.

**E1. What the pet already knows and could report**
- `switchingId` — which costume is mid-switch (`use-costume-switch.ts:96`)
- `error` — `"<costume>: <reason>"` (`use-costume-switch.ts:83`)
- success — the moment `onSuccess` fires and `saveLastCostume` writes (`use-costume-switch.ts:80-81`)
- the busy rejection — today `switchTo` returns at line 121 with no signal at all; there is no "I refused this because one is already running" output
- the ineligible rejection — line 120, same silence
- `cancelSwitch` — already implemented and correct, just unreachable

**E2. What the home page would need to render**
- a busy marker on the row actually being switched (it currently has no notion of "in flight" at all)
- a real failure line — today `costume.error` only ever holds an emit failure (`use-costume-page.ts:54`), never a switch failure
- a highlight that follows the pet, not the click: `selected` at `use-costume-page.ts:51` must not be set until the pet confirms, or it must be reverted on failure (manual check #74 requires the highlight stay on the pre-switch costume after a timeout)
- a cancel control that reaches `cancelSwitch` in the pet window
- a "pet window is closed" state, since `emitTo` cannot tell us (see B1 step 3) — the only way to know is either a reply that never comes or an explicit window-exists probe (`WebviewWindow.getByLabel("pet")`, the same call `openHome` already uses in `lib/open-home-window.ts:24`)

**E3. Transport options already in the tree**
- the reverse Tauri event: `use-home-navigate-event.ts` is the working template for a pet→home listener, and `costume-switch-event.ts` is the template for the parse-and-gate pattern (`parseCostumeSwitch`/`handleCostumeSwitch` with a pure, unit-tested body — `costume-switch-event.test.ts`)
- toasts: both windows already mount a `ToastHost`; the pet can surface its own failure with a single `pushToast` call and no protocol at all. This is the smallest possible improvement and is independent of any home-side change
- localStorage: the pet already writes ground truth (`saveLastCostume`), but writes do not notify the other webview, so it works as a seed, not as a channel

**E4. Where a timeout would have to live to actually bound the guard**
Today the 30 s guard wraps only the renderer load (`resolve-switch-report.ts:36`). Three awaits on the same code path are unbounded: `costumeResolution` (`:26`), `costumeAssetResolver` (`:27`), `reportAvatar` (`:45`). Bounding the whole `resolveSwitchReport` call — or giving `rpc.request` a deadline in `ws-client-methods.ts` — is what turns "the guard may never release" into "the guard always releases". Note the interaction with `abortSwitch`: the current `.catch` at `:37-40` aborts the renderer ticket specifically; a whole-call timeout needs the same abort so a late model still self-discards (Fix 1 must be preserved).

**E5. What "un-wedging" requires, minimally**
Three independent stuck states exist (B4), and they need different keys:
- stuck `inFlight.current.id` → needs `cancelSwitch` reachable, or a bounded timeout, or both
- wiped `state.files` (the `EMPTY` catch at `use-costume-switch.ts:107-109`) → needs a re-runnable `refresh` that is not gated on a one-time `connected` transition; `refresh` is already exposed by the hook and already discarded by `use-costume-switch-event.ts:15`
- dead socket → nothing reconnects in either window (`use-core-connection.ts:47`, `use-home-connection.ts:43`); every recovery path above assumes a live socket

**E6. Regression checks this must restore**
- `docs/devlog/manual-checks.md:154` (#74) — highlight, core vocabulary and last-costume all stay on the pre-switch costume after a timeout. **The optimistic `setSelected` currently breaks the highlight clause.**
- `docs/devlog/manual-checks.md:155` (#75) — only the switching row is busy, other rows stay clickable, Cancel available, recovery without reopening the window. **Currently regressed in full.**
- D39 (`docs/deferred-decisions.md`) is a known, accepted side effect of `abortSwitch` (idle motion briefly lost after a timeout/cancel); it is not part of this defect and should stay deferred.

---

## Caveats / Not found

- **Which of the three mechanisms in B4 the owner actually hit is not determined by code reading alone.** All three end at the same silent `return` and all three are cleared by a pet-window reload. Distinguishing them on a real machine takes the pet window's devtools console: mechanism (iii) leaves no trace at all; (i) and (ii) leave none either, which is itself the finding. A `console.warn` on the busy-rejection and on the `EMPTY` wipe would make the next occurrence self-diagnosing.
- The owner's phrase "until the page/window is reopened" is ambiguous. The code says reopening the **home** window cannot fix any of these — the home page holds no blocking state. If the owner observed recovery after reopening only the home window, then there is a fourth mechanism I have not found, and that fact is worth confirming with them before designing the fix.
- I did not run the app or the test suite; this is static reading of the working tree plus `git show` of the deleted panel.
- `emitTo`'s behavior for a non-existent target label is inferred from the installed JS wrapper (`@tauri-apps/api@2.11.1` `event.js:151-158`) plus the absence of any error path; I did not read the Rust `plugin:event|emit_to` handler to confirm it never errors on an unmatched label.

# Reactive Read-Models: Push, Generations, Visibility & Scroll Discipline

Background Monitor subscriptions follow the same physical-client and visibility rules. The normal and background
tabs have separate read demand. Normal cache/latest-primary panels never consume a selected maintenance record.
`MaintenanceMonitorController` retains a coherent last-good query snapshot across failed replacement reads, rejects
old query/generation/revision updates, installs notifications before subscribe, and withdraws data on mode disable.
Closing/hiding the page stops background membership without stopping Core work. On return/reconnect, read durable
state again; never replay tidy/compact commands. See backend/observability-projection.md for the exact population and
nullable progress/usage contracts. Per-call usage must disclose missing coverage and opaque identities stay internal.

> Home pages are disposable read-models over Core truth. These contracts include the event/demand refresh
> work in 09-08-uiux-triggered-refresh and the visual-continuity follow-up, retaining the accepted Chat/Monitor lifecycle and reading behavior.
> They create no second authority, polling loop or mutation replay (state-management.md).

## (a) Push-driven pages update from WS events through generation-guarded handlers

- The ONLY inbound-push seam is `src/lib/ws-client-routes.ts` `installRoutes()`: every notification frame
  is zod-parsed at the boundary and fanned out to registered handlers (`config.changed` → handler `Set`,
  `observability.event` → monitor handler `Set`, `timeline.appended`/`removed`, `avatar.command`,
  approval request/closed, and data-free `perception.changed` / `extension.changed`). A page never parses raw
  frames or registers a second routing path. Operator invalidation schemas and producer boundaries live in
  [server-push-and-connection-auth.md](../backend/server-push-and-connection-auth.md#scenario-operator-resource-invalidation).
- Handlers are registered per authenticated client generation and deregistered with it. Generation
  guards compare BOTH the local candidate and the client identity before applying:
  `MonitorControllerImpl.current(candidate, target)` (`monitor-controller.ts` — generation bumps in
  `bind`/`dispose`/`setVisible`), `read-coordinator.ts` behind `useCachedFetch` and affected resource controllers
  (physical loader/query scope plus lifecycle/read/update epochs), and the permission controller's token pass
  (`permission-controller.ts`). A retired client's late answer is dropped, never merged.
- Writes do not take the push path as their source of truth: a `config.set` applies its own server echo
  (`applyStored`), a `perception.pauseSet` returns the resulting server state — pushes only keep the
  list honest between writes.
- Scalar configuration echoes use `effectiveValue`, `origin` and `application` when present. A reset cannot infer
  the environment fallback from the built-in default; older-Core reset acknowledgements require a covering read.
  `config.changed` also covers application completion, so a visible observer reconciles the full projection with
  the existing one-flight/trailing-read coordinator. A delayed save echo must not regress a newer application observation.

### Model configuration and dependency-scoped Chat

- Main/Utility use the Shared `config.modelProfiles*` family, separate from scalar fields. Register invalidation
  handlers before subscription acknowledgement and list reads. Retain last-confirmed presence-only data across
  disconnects and read failures; only a current covering read or accepted current save echo is fresh.
- The editor retains local input across reconnect, visibility changes and competing revisions. Saved incomplete
  drafts are Core-owned and survive reopen; plaintext key input is never a read result or persisted browser cache.
- One Save action selects draft for incomplete configured input and apply for complete/disabled/inherited input.
  Optional Test sends the current unsaved form only on explicit cost-labelled action; saving never calls the model.
- Serialize saves/tests per editor, use expected revisions, and retain input on conflict. Unknown acknowledgements
  block resubmission until a fresh read reconciles the state; reconnect does not repeat a write or a test.
- Main readiness affects new Chat messages. History, navigation and configuration remain mounted and useful;
  active-model availability, saved-draft/application failure and actual test outcomes are distinct UI facts.

## (b) Each resource has an entry, change, demand and recovery policy

- Every resource scopes reads to its physical client and actual query identity. Ordinary React rendering,
  focus or pointer movement is not a refresh trigger. Duplicate demand joins one owned read; finite events
  during it create one trailing covering obligation. An unversioned response cannot clear a newer dirty mark.
- Perception, MCP/Skills lists and the shared extension strip install handlers, await the client's one
  successful subscription, then read. Actual targeted hints, local outcomes, manual retry and uncovered
  visibility/reconnection gaps invalidate the affected projection. Valid push-covered re-entry can reuse data.
- Operations, Costume, permission and durable-approval snapshots read on usable entry/re-entry, deliberate
  refresh and relevant local outcome; they have no invented event source. Status and storage failures are
  independently retryable. Skill Inspect remains an explicit validation/read; valid collapse/reopen is local.
- A reconnect or timeout NEVER replays a mutation. Mutations serialize (one at a time:
  `permission-controller`, `mcp-controller`, `skills-controller` `mutationLock`); a revision/policy
  conflict refetches Core truth and requires a fresh operator action; an interrupted write surfaces as an
  error, not a queued retry.

### Monitor's global cache statistic

- `useCacheUsage` owns a separate aggregate subscription: it is independent of the selected Run and browser filters.
  Gate its work with effective Monitor route/document visibility, preserving the existing trajectory lifecycle.
- Register the typed push handler before requesting the initial snapshot. Accept only the current client/generation
  and a strictly newer server revision; a late initial reply must not replace a newer push. Reset the local revision
  floor on physical-client replacement, never the server-owned summary window.
- Hidden/disabled/replaced bindings unsubscribe; re-entry subscribes and reads the durable current window. Duplicate
  retry demand joins the existing pending read. Keep last-good values visibly stale during transport/reconciliation;
  a known unavailable new summary window replaces old numbers with unavailable rather than relabeling them as current.
- Render the compact `CacheUsageStrip` above the Run workspace and below policy diagnostics. Show weighted rate,
  `本次摘要以来` / `首次摘要前`, global foreground/background scope, paired/observed coverage and actual calculation time.
  Never render internal summary revisions, request identities, fabricated 0%, or derive sums/reset events in React.

## (c) No polling intervals in home windows

- `setInterval` for data is forbidden (quality-guidelines.md). Data arrives via WS push: `chat.delta`,
  `timeline.appended`, `config.changed`, `observability.event`. If a page needs fresher data than the
  push stream provides, the answer is a Core push or an operator-triggered refetch — never a timer.
- Legitimate data-lifetime timers are ONE-SHOT deadlines and backstops, never re-arming fetch loops: RPC
  deadlines (`rpc-deadline.ts`), the timeline load-older backstop (`use-timeline-scroll.ts`
  `LOAD_BACKSTOP_MS`), costume result deadlines. Coalescing timers that BATCH already-pushed data
  (`chat-delta-coalescer.ts` ~40ms trailing edge) are allowed — they fetch nothing.
- Presentation-only one-shots may delay a busy indicator or expire a transient Toast. They fetch nothing,
  authorize nothing, never delay a ready result, and clean up with their signal/owner.
- Core's absolute pause-expiry projection wake-up is a producer-owned deadline, not a browser poll or a
  second pause writer. Browser time never authoritatively resumes observation.

## (d) Hidden keep-alive pages gate expensive live work; additive delta listeners stay live

- The shell publishes its actually rendered route (post Monitor fallback) and one document-visibility
  listener. Refresh-task consumers use `usePageActive(id)` / `isPageActive(id)`: shown route AND visible
  document. Blur is not hide. The route-only `usePageVisible` remains for existing owners that deliberately
  use it; Chat's background-settlement exception and Monitor's accepted lifecycle stay separate.
- Expensive live work gates on visibility: the monitor tears its subscription down while hidden
  (`setVisible(false)` → generation bump, handler removal, `unsubscribeMonitor`, no re-publishing;
  reactivation re-attaches and refetches). A hidden refresh-task consumer retires disposable read authority,
  retains the required gap and performs no recurring read/publication work.
- Cheap additive delta listeners stay live: the settings family keeps its `config.changed` subscription
  registered while hidden — BUT the local apply is skipped (`config-observer.ts` via `use-config.ts`): the
  state cannot be observed, so only its gap/version bookkeeping changes. Perception/extension hints also
  remain cheap and targeted. Return reconciles one uncovered gap; permission/approval snapshots instead
  follow their demand policy and do not pretend a permission push channel exists.
- Monitor also retains one cheap mode-authority listener on Home's already subscribed client. A valid live mode
  change retires affected detail even while hidden, without publishing hidden React updates. Physical binding and
  mode epochs reject retired callbacks and mode snapshots predating the push; no second subscription/read loop is added.
- HomeShell publishes the actual shown route in a layout effect. Monitor applies route visibility before client
  binding in layout effects, so a returning retained page reconciles the current controller snapshot before paint.
  Passive effects can expose the cached React view for one reveal frame even when hidden controller authority was
  already retired. Preserve Monitor's route-only semantics and verify this chain in the native renderer.
- A hidden page must not drive React renders: the monitor suppresses `emit` while hidden and
  reconciles from its page memory on reactivation.
- The Home-wide child-attention entry is an intentional lightweight status consumer across page navigation. Its
  bounded reads remain active while Home is visible even if Subagents is hidden; selected private transcript/activity
  work still follows its existing page gate. Document hiding retains hints without reads or React publication. Real
  child changes invalidate one flight plus one trailing obligation; a notification while paging returns attention
  demand to the first page so new escalations cannot remain behind an old cursor. Reconnect never submits recovery.
- Hiding must never rebind a mutation controller to null or discard its lock/outcome. A pending command
  settles once; after it settles, a visible consumer reads if its result was not covered. Preserve this
  obligation even if hide/show happened during the command's post-write read.

## (e) Reconnect recovery is a per-page restore seam, never a shared replay

Each page declares how a fresh generation becomes trustworthy; there is no global restore:

| Page | Restore seam |
| --- | --- |
| chat | `restore-chat-timeline.ts`: subscribe BEFORE history, then an authoritative newest-page reconciliation keyed by `seq` (tombstones for removed rows; raced live rows and older pages survive). `connected` publishes only after restoration. |
| monitor | Restore mode/list and the independently selected Run through an authorized tail query, even when it is outside the newest list. Keep older/live cursors separate, drain bounded forward pages before subscribing, and refresh committed-event summaries with one in-flight plus one trailing request. Inspector success/error/close has its own epoch. |
| perception | Handler -> `perception.subscribe` acknowledgement -> one coherent `perception.card`; no duplicate pauseGet. Current authority is stale during gaps; an old card cannot authorize resume. |
| mcp / skills | One client-level extension subscription, targeted visible list reads and retained dirty gaps. Drafts/disclosure stay local; inspection is never automatically replayed. |
| shared extension strip | One connection-keyed resource across interested page instances; only visible demand receives/reconciles changes. |
| settings (config) | Retryable shared config subscription then config.list; hidden gaps reconcile once. Recovered setup also reconciles the existing timing-policy owner, even with no later push. |
| permissions / approvals | Fresh authorized demand snapshot per generation and entry; conflict refetches; no persisted policy replica. |
| operations / costume | Independent schema-validated snapshots on usable entry/re-entry, explicit refresh or relevant outcome. Permitted prior content remains with truthful refresh/error state. |

Monitor summary replacement is guarded by durable cursor progress as well as request/client identity. A delayed
summary or forward page from an older cursor cannot overwrite a newer live/recovery summary. Accepted restoration
and catch-up update the selected Run's browser entry together with its trajectory summary; the latest list snapshot
is not an authority for selected-Run freshness. Preserve the one in-flight plus one trailing summary refresh.

## (f) Scroll discipline: bottom-pinning, pause-on-scroll-up, load-older hold

- Chat owns the canonical pattern (`use-timeline-scroll.ts`): an `atBottom` ref updated from scroll
  position (`NEAR_EDGE_PX`), a layout effect that pins `scrollTop = scrollHeight` on content change only
  while at-bottom, a prepend hold that preserves the reading position when an older page lands (keyed on
  the oldest mounted seq so it survives the P1b window trim), and a bounded backstop that re-arms the
  load guard if a page was fully trimmed.
- D68-B Monitor uses measured record keys and explicit older-page prepends (`use-trajectory-follow.ts`).
  Preserve the reading anchor when rows/group separators/history controls change. Initial tail placement
  and deliberate resume may scroll; content-only updates must not repeatedly force tail writes. Historical
  reading, text selection, range focus and Inspector inspection suspend following. A summary refresh
  replaces neither rows nor their reading position.
- Crossing the measured-virtualization threshold must preserve the existing native offset. Configure
  `initialOffset: () => scrollRef.current?.scrollTop ?? 0` when enabling the installed virtualizer above 100 items;
  its default zero otherwise moves a paused reader to the top and can trigger an unintended older-page request.
  Cover both disable/enable transitions and real-window 100-to-101 live append while paused, in addition to prepend.
- A pause/resume affordance is rendered ONLY when the user is genuinely paused-from-bottom AND it is a
  real control (`已暂停跟随 · 回到底部` ActionButton → scroll to bottom + re-pin). If the stream rarely
  pushes, the affordance simply rarely appears — that is correct, not a defect to paper over with an
  always-on "live" indicator.

## (g) Stale/busy indications come from real signals only — never invented states

- `PageHeader busy` and pending controls use actual request flags or `refreshing` from their read owner.
  `PendingIndicator` reveals work only after 250 ms in a reserved inline slot. No simulated work or minimum
  result delay is allowed; a request completing before the threshold never flashes a progress label.
- The monitor's `stale` flag follows actual connection retirement, invalidation or failed recovery and
  clears only through real restoration/reconciliation — never a timer or guess. The cached-fetch `refreshing` marker is driven by the load state machine
  (`cached-fetch-state.ts`), and its error line by the actual rejection.
- If a signal does not exist, the UI shows nothing rather than a plausible lie (batch-2 §9 ruling; the
  same honesty rule as costume phases and test-result truth in home-window.md).

## Memory review facts and invalidation

Home memory review uses `MemoryAuthorityStatus.review` and the existing
`memory.operations.subscribe` membership for `memory.replica.changed` hints. A hint
requests a fresh authority read through `createMemoryOperationsController`; it is
not a progress value. Keep its generation guard and in-flight dirty-read coalescing.
Missing review rows/counts stay unknown, measured zero remains zero, and unavailable
replica evidence must not erase independently supplied review rows or enable sync
controls. Refreshing, failed reads and disconnected retained frames identify the
last read and its observation time. `catchUpOccurrenceId` persists after completion:
display a historical inline record, without inferring that a later occurrence is
currently catching up. No notice ledger, polling, timer or frontend authority is
needed. Verify browser reconnect/remount and mid-read pushes separately from the
Core producer/WS test; neither substitutes for real concurrent review or owner UX
acceptance.

## Wrong vs Correct

```tsx
// Wrong: a hidden keep-alive page keeps applying pushes it cannot show, and polls to "catch up".
useEffect(() => {
  const id = setInterval(() => void client.configList().then(apply), 5_000); // polling (c)
  return client.onConfigChanged(apply); // applies while hidden (d)
}, [client]);

// Correct: one observer owns setup, field versions and hidden gaps; the shared reader owns the flight.
const observer = createConfigObserver({
  client: ready,
  visible: () => isPageActive("settings"),
  apply: applyConfigChange,
  demand: refreshConfig,
  gap: setObservationGap,
});
const stop = observer.start(); // install handler before observer.read() acknowledges subscription and reads
// Wire visibility to observer.setVisible and call stop when this client/observer retires.
```

## Future extraction rule

`use-timeline-scroll` (Chat) and `use-trajectory-follow` (Monitor) have different inputs: sequenced
Timeline/in-flight content versus measured, grouped, filtered trajectory records and range/Inspector
focus. Preserve those ownership boundaries. Revisit shared tail-follow logic when a third real consumer
establishes a coherent reusable contract; do not merge them merely because both scroll.

## Home Monitor availability across connection retirement

`use-monitor-availability.ts` distinguishes unknown availability from a confirmed Core mode. Initial
unknown exposes no Monitor surface and preserves an initially requested Monitor route. A transient
`client=null` or failed read keeps the last confirmed mode so HomeShell does not unmount the Monitor
controller and discard selection before restoration. Confirmed DISABLED still hides the page and
applies the existing Chat fallback. Valid config pushes supersede older snapshots; malformed modes and
retired-client callbacks cannot enable the page. This is disposable display state, not query authority.

Regression evidence must exercise enabled -> null -> replacement, old responses, initial route,
config/snapshot races and genuine disable. Actual WebView2 reconnect verifies mounted-page/selection
continuity beyond a controller-only test.

## Scenario: Stable editing during resource refresh

### 1. Scope / Trigger

Apply when an unchanged entity remains visible through loading, invalidation, failure, same-data reconciliation,
or an external config update. A React render is allowed; remounting its editor/reading subtree or discarding its
local draft is not an incidental refresh effect. Real entity deletion or changed selected text needs an explicit
transition rather than pretending the old record remains authoritative.

### 2. Signatures

`createReadCoordinator<T>(sink)` exposes `replace(load)`, `setActive(active)`, `demand()`, `invalidate()`,
`acceptUpdate()` and `retire()`. Binding does not read; feature policy owns demand. Its sink receives actual
`started`, current `loaded` / `failed` and read `retired` transitions.
Every actual trailing attempt restores `started`, including an invalidation raised synchronously by `loaded`.
Own the flight before invoking a sink callback and recheck its loader/active/epoch scope after `started` before
calling the loader; a reentrant retirement must not start an obsolete request.

Config save results come from `config-save-controller.ts`:

```ts
type ConfigSaveOutcome =
  | { kind: "saved"; display: string; current: boolean }
  | { kind: "failed" | "refused"; message: string }
  | { kind: "retired" };
```

This is a local result contract. The existing `config.set` RPC has no compare-and-swap field.

### 3. Contracts

- Keep component type, entity key and parent position stable. MCP's editor stays in the same master/detail
  parent even when the list becomes empty. Busy/error metadata is separate from permitted prior data.
- Config owns latest server display, draft/base value, focus, composition, dirty state and save/draft epochs
  separately. An unrelated refresh does not replace focused/dirty/composing text or its selection.
- Unchanged, composing or observed-conflict blur sends no write. `使用最新值` changes only local draft state;
  `确认覆盖保存` deliberately submits the retained value. Field lock/removal/authority loss still constrains saves.
- A caught failure is not persistence success. Clear dirty state only for a current successful save whose draft
  has not changed. Failed/refused/retired results, same-field external updates and edits during an earlier save
  retain the draft. Do not auto-queue another write after settlement; expose a deliberate remaining-save action.
- MCP keeps its original expected revision across background reads. Its editor session and immutable draft identity
  are separate: an old completion cannot clear a newer draft or a cancelled/reopened editor. A confirmed commit
  may advance the same server/session's next explicit retry revision, including a surviving partial commit; take
  that value only from the submitted mutation result. Recheck the physical client after all post-write and
  hide/show reconciliation awaits before exposing success or that committed revision. Further typing never
  automatically sends another mutation. A prior save notice must not imply that a newer draft is already saved.
- Skills associates inspection with the actual
  package/revision/content identity; valid collapse/reopen costs no RPC and unrelated packages do not reset it.
- Keep unchanged DOM Range, input focus/selection and viewport-relative reading anchors through intermediate
  refresh states. A final screenshot alone cannot establish this. No blanket memo/Transition or new query/animation
  dependency is needed; existing tokens and reduced-motion behavior remain in force.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Initial read failure / successful empty | Error+retry / actual empty state; neither is a permanent skeleton. |
| Read failure with permitted prior data | Retain content and expose stale/error metadata plus working retry. |
| Same-data refresh or unrelated entity update | Stable nodes, disclosure, focus, selection and reading position. |
| Same-field external config change while dirty | Keep draft, block blur write, expose explicit conflict actions. |
| Composition blur / no-op blur | No write; finalized unsaved text remains deliberate user intent. |
| Old save/read settles after new draft, scope retirement or stronger update | Cannot clear the new draft/error or restore old authority. |
| Hide/show during a post-write read | Command settles once; retain the covering-read obligation for the visible page. |

### 5. Good/Base/Bad Cases

- Good: a user selects text in an expanded Skill result; another package changes; the list updates without a new
  inspection, remount, collapsed-state reset or scroll jump.
- Base: first usable entry performs one required read and ends in ready, empty or retryable error.
- Bad: key a form by request revision, replace last-good content with a skeleton, copy each server update into
  draft state, or clear dirty text because a `Promise<void>` resolved after internally catching a save failure.

### 6. Tests Required

- Deferred controller tests cover demand joins, invalidation bursts, old success/failure, stronger update,
  hide/show/disposal and mutation settlement. Feature tests cover each resource's actual state/action branches.
- Config draft/save/observer tests cover no-op/conflicted/composing blur, explicit use-latest/overwrite, failed or
  retired saves, newer edits and same-client config subscription recovery without another timing push.
- Real `WsClient` plus Settings observer tests cover a verified push before a newly opened observer while timing
  still owns an older list. That observer cannot join the pre-change flight or mark it covered; its late completion
  cannot retire a newer shared request. Successful writes and recovered subscription gaps use the same rule.
- MCP editor/controller regressions cover editing during a deferred post-write read, client retirement at that
  read or subsequent visibility reconciliation, cancelled/reopened sessions, and commit-derived explicit retries.
- Native WebView2 evidence uses frozen production assets and records before/during/after node identity, focused
  input value/selection, DOM Range and viewport anchor. Include errors, selected details, native visibility and
  reduced motion. Label composition-event automation separately from a real operating-system IME trial.

### 7. Wrong vs Correct

```tsx
// Wrong: each refreshing branch removes the user's existing editor subtree.
return loading ? <Skeleton /> : <Editor key={requestRevision} data={data} />;
// Wrong: a push overwrites unfinished local input, and caught save failure appears successful.
useEffect(() => setDraft(serverValue), [serverValue]);
await save(); setDirty(false);

// Correct: stable parent/key and a fixed metadata slot; explicit local outcome/draft epoch.
return <PageCard title="Configuration" action={<PendingIndicator active={refreshing} label="Updating configuration" />}>
  <Editor key={entityId} data={permittedData} />
</PageCard>;
// The draft owner applies a saved/current result only to its matching unchanged attempt.
```

## Scenario: Coherent target replacement and transient feedback

### 1. Scope / Trigger

Apply to a same-authority Run/detail change, warm card/list refresh, or one-time operator action outcome.
Keep first load, successful empty results, persistent read failures and authority loss distinct.

### 2. Signatures

```ts
import type { JSX } from "react";

type PendingIndicatorProps = { active: boolean; label: string; className?: string };
declare function PendingIndicator(props: PendingIndicatorProps): JSX.Element;

type ToastTone = "error" | "info" | "success" | "warn";
type ToastOptions = { eventKey?: object; replaceKey?: string };
declare function pushToast(message: string, tone?: ToastTone, options?: ToastOptions): void;
declare function dismissToastGroup(replaceKey: string): void;
```

Monitor separates `requestedRunKey` / `requestedRowKey` from committed `selectedRunKey` /
`inspectedRowKey` and their trajectory/Inspector payloads. UI actions carry the displayed Run identity
so a callback from older DOM cannot silently act on a newly committed Run.

### 3. Contracts

- Stage a different target independently; publish matching identity, payload, cursors and related detail reset
  together. Never reuse A's warm trajectory path/cursor for B merely because some trajectory exists.
- Keep the committed entity key and subtree until a valid replacement is ready. Same-entity refresh preserves
  mounted editors, rows and reading state. A new committed entity may deliberately reset entity-local state.
- React's batching/reconciliation handles the coherent tree. Do not wrap every imperative controller notification
  in `startTransition`: controller state could advance before the displayed DOM/action bindings. Transitions and
  `useDeferredValue` address measured React rendering cost; they do not supply RPC readiness or request ordering.
- Close, hide, replacement clients and newer candidates retire old success and failure. Real deletion, forbidden
  access and known downgrade of detail visibility take effect immediately; visual retention does not grant access.
- Ordinary pending metadata lives in an existing header/control slot. Keep action labels stable and disable them
  from actual readiness immediately. Perception does not insert temporary warning paragraphs above its activity card.
  Reserve both the slot dimensions and its alignment: a PendingIndicator in a baseline-aligned flex row must use
  its own center alignment, so adding the SVG cannot change the header baseline or downstream card positions.
- Notify from a guarded action outcome, never from render, `useMemo`, a state updater or every loaded snapshot.
  Reuse an event object to deduplicate delivery; the window-local WeakSet consumes that event even after its Toast
  is dismissed. A later distinct attempt gets another object even if its message is identical. `replaceKey` and
  explicit group dismissal remove superseded feedback for the same operation/target.
- Chat file-pick results belong to their draft lifetime. Sending/clearing or unmounting retires in-flight decoding
  for both attachments and notifications; multiple picks within the same still-active draft remain additive.
- Default unheld Toasts expire after six unpaused seconds. Hover/keyboard focus pause the remaining timer;
  deliberate click-to-hold retains A4's reading affordance. Cleanup, labelled close, Escape/outside dismissal and
  selectable text remain required. Expiration or appearance changes no normal-flow page height.
- Validation, unsaved drafts/conflicts, partial-commit diagnostics and useful operation results stay with their
  owning views. A Toast cannot be the only retained explanation or retry path for a continuing failure.
  A conflict does not prove that its following reconciliation succeeded: retain the conflict and any read failure
  separately, without promising that Core state was refreshed before a successful read establishes that fact.
  An interrupted submitted write's unknown-outcome diagnostic survives the null-to-replacement client transition;
  restored transport alone cannot confirm the prior operation. Never replay it or publish its retired completion.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Loaded A; B pending; then C wins before B | A remains coherent until C commits; B success/failure cannot overwrite C. |
| Displayed A action fires after B commits | Reject the mismatched displayed identity; never issue an A-row request against B. |
| Missing pending target vs missing displayed target | Keep separately permitted old content / remove the actually missing projection. |
| Known detail downgrade or monitoring disabled | Retire pending detail and remove affected content immediately. |
| Populated same-resource refresh | Same nodes/reading geometry; no skeleton or temporary blank frame. |
| Fast pending vs slow pending | No flashed label / delayed reserved indicator; ready content is never held back. |
| Repeated event vs new same-message attempt | One consumed notification / a fresh notification with its own lifetime. |
| New failure after an old success | Supersede the old operation feedback; retain needed diagnostics and retry. |

### 5. Good/Base/Bad Cases

- Good: retain one committed snapshot, atomically replace it, and notify once from the actual mutation callback.
- Base: a cold read displays truthful local loading and ends in data, empty or a retryable failure.
- Bad: clear data at request start, change only a payload's label/key, insert transient banners in flow, or
  enqueue a "saved" message whenever a server snapshot is re-read.

### 6. Tests Required

- Monitor controller/presentation cases cover candidate races, title/payload/cursor identity, stale action callbacks,
  close/deselect, unavailable scope and mode downgrade. Existing live recovery and history tests remain mandatory.
- `resource-state-pages.test.tsx`, Perception and Skills tests cover retained content and quiet fast metadata;
  `home-action-readiness.test.tsx` verifies disabling independently of decorative pending indication.
- Toast queue/timer and mutation-controller tests cover replay after dismissal, distinct attempts, replacement,
  guarded completion, keyboard/pointer pause combinations and deterministic expiry.
- Native/browser evidence covers actual frames across held and settled reads, original nodes, card rectangles,
  scroll/focus/selection, notification height/expiry and reduced motion. Static markup does not prove these properties.

### 7. Wrong vs Correct

```ts
// Wrong: an ordinary list read replays a previous operation's success.
loaded(snapshot) { apply(snapshot); pushToast(snapshot.previousOutcome.message); }

// Correct: the guarded action owner consumes one event; reads only reconcile data.
completed(outcome) { pushToast(outcome.message, "success", { eventKey: outcome, replaceKey: operationKey }); }
loaded(snapshot) { apply(snapshot); }
```

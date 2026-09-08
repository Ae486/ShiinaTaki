# Page state and event-triggered refresh design

Status: **implemented and engineering accepted on 2026-09-08**, code commit `7d89191`.
The [implementation evidence](implementation-evidence-2026-09-08.md) records independent review and final runtime acceptance.
The source studies retain their planning-baseline scope.
Baseline: `b251474` in `H:/TakiAgent-worktrees/t4`.

## 1. Decision and responsibility

Final review tightened the same design at three existing boundaries: each real read attempt publishes its busy
state and rechecks synchronous retirement; verified config changes/commits/subscription recovery retire old
shared-list reuse eligibility; MCP completion belongs to its physical client, editor session, save attempt and
unchanged draft. A retained same-target draft advances its retry version only from its actual submitted commit.
Older successful-save notices are explicitly qualified while a newer draft is unsaved.

Extend the existing React hooks, feature controllers, typed WebSocket routes and guarded snapshot
cache. Add small producer invalidation channels only for verified changing Perception/extension facts.
Keep component identity and local editing/reading state independent of the data being refreshed.

React 19.2.7 already reconciles changed output into the existing DOM. A component render does not
mean that the DOM was rebuilt. The identified defects come from dropping previous data, moving or
unmounting its subtree, resetting drafts, and incomplete asynchronous lifetimes. The goal is correct
bounded work and stable interaction, not zero React renders. Do not install a query library, enable
a compiler, put every component behind `memo`, or wrap every external-store update in a Transition.

Alternatives considered in [framework research](research/react-refresh-continuity.md):

| Approach | Decision |
| --- | --- |
| Extend existing hooks/controllers and share repeated pure coordination rules | Selected. Preserves typed RPC, privacy/cache rules, mutation ownership and existing tests. |
| One existing-Zustand owner for a resource demanded by multiple consumers | Use only where identical concurrent reads need a single owner. No universal Home store or mirrored controller truth. |
| Migrate reads to TanStack Query | Not selected. A new dependency/migration still needs all domain authority, visibility and draft rules; no demonstrated benefit justifies that scope. |

Core remains the source of record. The UI owns disposable snapshots, query lifetimes, selected IDs,
drafts, disclosure state and reading anchors. A notification means a view may be outdated; it does
not mean that a command succeeded, grant permission, or start/cancel/replay an operation.

## 2. Trigger policy

The complete page/section mapping and baseline defects are in
[the Home inventory](research/home-refresh-inventory.md). These policy classes govern implementation:

| Class | First use | Subsequent trigger | No-demand behavior |
| --- | --- | --- | --- |
| Existing live stream: Chat, Monitor, config changes | Existing subscribe/restore baseline | Existing ordered events and recovery, with established cursor/visibility rules | Preserve Chat's background-settlement exception and Monitor's proven unsubscribe/backfill behavior. |
| Changing snapshot: Perception, MCP/Skills list, extension strip | Register handler, acknowledge subscription once per client, then one needed read | Actual producer invalidation, relevant own-write settlement, explicit retry | Cheap handlers retain only dirty/version state; no hidden reads or data-driven React publications. |
| Demand snapshot: Operations, Costume, permission and durable-approval sections | One read when first usable; safe prior content may render immediately | Entry/re-entry where no continuous change coverage exists, explicit Refresh, relevant completed write | No timer. A hidden command still settles; a later visit reconciles its affected projection. |
| Demand detail: Skill inspection | Explicit Inspect requests the real validation/read | Explicit Inspect again, or user demand after a known incompatible result | Collapse/reopen reuses a valid result. A hidden/list update never triggers filesystem inspection. |
| Already loaded disclosure: MCP selected tools and other snapshot fields | Parent snapshot supplies the data | Local open/close; parent refresh only when its own policy requires it | Opening already valid data costs no extra RPC. |

Rules that apply across classes:

- An equivalent in-flight or already restored read satisfies a coincident entry trigger. Re-render,
  pointer movement and ordinary focus changes are not refresh triggers.
- Re-entry is a deliberate trigger for query-only management snapshots. Push-covered resources
  reuse current data when their subscription covered the hidden period; a dropped/unobserved period
  creates a gap that must be reconciled once.
- Gate ordinary work by the shell's actually shown route and effective document/native visibility.
  An unfocused but visible window stays visible. Verify WebView2 minimize/hide events before choosing
  any necessary Tauri visibility adapter; no OS polling or assumptions based on blur.
- Keep initial load and re-entry distinct from identity changes. Replacing the authenticated Core,
  Character/query scope or selected detail retires the previous read authority.
- Mutation completion and captured outcomes survive page hiding. Do not implement visibility by
  rebinding a mutation controller to null, which would discard its lock/outcome.

The existing config channel also needs recoverable setup: its current memoized request keeps a
rejected promise forever, while Settings only logs the failure. A deliberate Retry/re-entry may retry
that same client's idempotent subscription; do not clear a newer setup attempt from an older rejection.
Retain observation-gap feedback until setup and reconciliation succeed. Because timing sync shares
this subscription, recovery must reconcile missed timing values through its existing owner once,
even if no new config event follows. Share an actually concurrent identical config read where needed;
do not create another timing authority, broad reconnect or recurring retry loop.

## 3. Resource state and read coordination

Adapt existing unions/reducers rather than creating a second cache. Each owner needs snapshot
presence, actual request phase, error, dirty coverage, observation status, and immutable request scope.
Loading is not inferred solely from `data === null` or an empty array.

| Actual condition | Required display |
| --- | --- |
| No snapshot; initialization/read running | Local loading skeleton; truthful initialization status. |
| Successful empty result | Empty state and its applicable action. |
| Permitted snapshot; read running | Same mounted content with a small refreshing indicator. |
| Initial read failed | Error and retry; no "no records" assertion or permanent loading animation. |
| Read failed with a prior snapshot | Same permitted content, qualified stale/error state and retry. |
| No usable connection | Connection/unavailable state, disabled unavailable actions; no invented active read. |
| Authority loss, actual deletion or privacy clear | Retire affected reads and remove/qualify affected content immediately according to its contract. |

The read-only coordination invariant is one owned in-flight read per resource scope and one pending
trailing invalidation. Reuse the established algorithm in `lib/timing-policy-sync.ts` and the Monitor
summary owner where applicable; share only the repeated mechanics, not their domain controllers.

1. Define scope from physical client identity, Core authority and actual entity/query arguments.
   Keep consumer/request/write epochs internal; never use them as React keys.
2. Duplicate demand joins the current read. A real invalidation or successful write advances a
   dirty counter. Any finite burst during a flight leaves one trailing obligation, not one RPC per event.
3. Register the typed handler before subscribing/reading. Notifications during initialization remain
   pending; a subsequent read must cover them before the view claims freshness.
4. Capture client, scope, lifecycle, request, write and invalidation identities. Check both successful
   and failed completion. A superseded response cannot clear a newer error, overwrite a newer echo or
   accepted push, reopen a detail, or confirm current privacy state.
5. Existing read responses have no aggregate invalidation revision. If a relevant change arrives
   during a read, retain the newer/previous permitted view as stale and perform the required trailing
   reconciliation. Do not mislabel a bare response as an atomic versioned snapshot.
6. Clear dirty coverage only after a successful current reconciliation. Failure ends the running
   flag, retains a retryable error and does not itself schedule a loop. A new external event, re-entry
   or explicit retry may cause a new bounded attempt.
7. Hiding/closing suppresses read/display work and retires the affected read/detail epoch. An existing
   transport request may still settle; ignoring it is mandatory even if cancellation is unavailable.
   On return, read once when there is a gap. No Host/Core command cancellation is sent for this cleanup.
8. Coalesce the initiating operator's mutation notification and post-outcome read. It may hold read
   invalidations while its write is pending, then reconcile once. Other visible operators may observe
   genuine intermediate states. Timeouts and reconnects never replay the write.

Development StrictMode setup/cleanup must not create duplicate live owners, leaked subscriptions or
replayed writes. An already retired non-cancellable read is not a second current owner and must not
publish. Request-count assertions distinguish stable-scope demand from a real generation retirement.

## 4. Stable rendering and editing

- Keep HomeShell's stable page wrappers. Keep list, editor and detail components in the same parent
  position during refresh; a real list becoming empty must not move an active editor into a new branch.
- Use existing stable entity/record keys. New response arrays may render while React preserves keyed
  nodes. Reuse unchanged derived references where useful; do not write an incomplete equality test
  based on a revision that does not cover all displayed fields.
- Keep request metadata separate from data. A refreshing marker can change without resetting rows,
  inspection, filters or search. Reserve its control space where it otherwise moves reading targets.
- MCP editor drafts retain their base revision and text. Background updates never silently advance
  that mutation revision. Existing Core conflict and partial-commit results remain authoritative.
- Config fields separate the latest server value from a dirty/focused/IME draft. Unrelated refreshes
  cannot replace the draft or selection. An unchanged focus/blur sends no write; composition cannot
  submit an intermediate value. If the same field changes externally while dirty, blur sends no RPC.
  Show the latest non-sensitive server value with `使用最新值` (discard locally, no write) and
  `确认覆盖保存` (explicitly submit the retained draft through the existing validated save path).
  Mask secret values using the current field contract. This is local observed-conflict handling,
  not a new Core CAS guarantee against an unobserved concurrent write.
- Give the local save seam an explicit success/refusal/retirement outcome; existing `Promise<void>`
  resolves after caught failures and must not be treated as successful persistence. Clear dirty state
  only for the current successful attempt whose draft epoch is unchanged. Failure, replacement and
  further editing retain the draft. Serialize a field's in-flight save without automatically queuing
  or replaying another write; retain a newer unsaved draft with a deliberate save action after settlement.
- Confirmed authority changes, field locking and actual deletion immediately constrain actions.
  Draft retention cannot bypass those constraints. Secret inputs remain memory-only and never enter
  an added cache, diagnostics or notification.
- Skills inspection is associated with the actual package/revision/content identity. An unrelated
  list change preserves its component and collapsed state. Replacement/removal makes the affected
  result stale/unavailable; re-opening does not silently perform a new inspection.
- Preserve scroll anchors, selected IDs, input focus/selection and unaffected DOM Ranges. If the
  selected text itself changes or its record is deleted, exact old selection cannot be promised;
  define the local transition without jumping unrelated content or faking the old record as current.
- Use existing CSS/motion tokens for necessary local changes. No whole-list entrance replay,
  mandatory loading delay, per-frame measurement/fetch loop or new animation dependency. Reduced
  motion and interruption must settle. Data authority never waits for an animation.

## 5. Perception facts and notification contract

The [producer study](research/perception-producer-refresh.md) is the detailed source/coverage map.
Core already requests foreground samples on its existing 30-second cadence. The new UI follows those
accepted results; it neither increases capture cadence nor installs a raw foreground-window listener.

Proposed additive operator-only protocol:

```text
perception.subscribe({}) -> { status: "ok" }
perception.changed       -> { revision: <nonnegative safe integer> }
perception.card({})      -> existing strict PerceptionCard
```

- The revision is process-local invalidation ordering, not a stored event, timestamp, snapshot cursor
  or permission. Keep existing strict card/pause response shapes unchanged; no Rust mirror is needed.
- One memoized subscription per physical WsClient, first requested when Perception is usable. Failed
  subscription promises may be retried; duplicate subscriptions are idempotent. Connection close
  removes membership. Hidden feature handlers keep only a dirty flag, not a background read loop.
- Publish only after admitted activity push/effective seal/prune, actual sampler scheduling changes,
  and successful pause state transitions. No raw/declined identity, screenshot, text or reason is sent.
- Use one fresh `perception.card` read to obtain activity, scheduling and `pauseState` together.
  Eliminate the independent mount-time card/pause duplicate reads. Keep mutation echoes as confirmed
  operation results and reject older read/write responses; reconcile any uncovered concurrent change.
- Retained activity is a past accepted observation. Pause controls cannot be rehydrated from an old
  cached card after a gap, failed revalidation or client retirement. A browser clock never confirms
  resume. Show uncertainty until current Core evidence exists.
- An ordinary same-generation refresh can retain the last confirmed pause presentation with an
  updating qualification; do not blank/rebuild the controls on every sample. It remains prior evidence,
  not a newly confirmed state. A lost authority/freshness boundary uses the stronger uncertainty rule.
- Correct wording to the existing field guarantee: `current` is the latest sampled activity, and
  `samplingStatus` describes scheduled loops. "Unpaused" does not prove active capture or Host availability.
  Do not derive an exact last-capture time from the card's extrapolated duration.
- Key activity rows from their existing stable sampled-entry identity, not `current`/`recent 1`,
  their current position or growing duration. Preserve an unchanged observation's identity as it moves
  into the recent list; a genuinely new sampled stretch is a new row.
- Timed pause expiry needs one Core projection deadline while interested connections exist. It reads
  the existing absolute-deadline state, emits the effective invalidation once, and never calls resume,
  writes the DB, starts sampling or invokes a model. Guard replaced/hydrated/long deadlines, suspend
  delays, last-subscriber cleanup and shutdown; no periodic UI fallback.
- Existing capture screening, D50 dwell, retention and in-flight pause behavior remain unchanged.
  This notification work does not claim stronger cancellation of already in-flight capture. The
  research records that pre-existing verification boundary and D48 separately.

## 6. Extension facts and notification contract

[Extension research](research/extension-refresh-producers.md) maps each actual producer transition.
Root selects **one opt-in aggregate extension channel**, rather than the research's passive broadcast
alternative or three separate channels. It follows the existing backend subscription convention,
adds one initialization acknowledgement, avoids unsolicited frames to older consumers and gives the
new client a concrete way to detect unsupported automatic refresh. No new global event bus is added.

```text
extension.subscribe({}) -> { status: "ok" }
extension.changed       -> { revision: <nonnegative safe integer>,
                             targets: <nonempty unique subset of mcp | skills | extension-status> }
```

Subscribe once per physical WsClient on first extension-page use; use one connection-keyed registry
and close cleanup. Register typed local handlers before acknowledgement and initial reads. Each
consumer invalidates only matching targets; all resources use the read coordination in section 3.
The revision has the same process-local, non-snapshot meaning as Perception's, independently scoped.
As with Perception, clear a failed setup promise so the same physical client's Retry can subscribe
again. The existing config memoization is a pattern reference, not code to copy with its permanently
cached rejected-promise behavior. Server subscribe remains idempotent after a lost acknowledgement.

| Producer | Targets / timing |
| --- | --- |
| Committed desired MCP change, including disabled add and surviving partial commit | `mcp`, after the actual change. |
| Current candidate start, final success/failure and coherent removal; boot/secret background replacement | `mcp`; stale candidates cannot publish new current truth. |
| Active MCP publication/replacement/withdrawal | `mcp` and `extension-status`. |
| A draining generation that can affect displayed phase/tool count becomes closed | `mcp` at the actual `closed = true` transition; do not wait for deferred transport-close cleanup. Include `connecting` with a draining fallback supplying tool count; never gate solely on phase being `draining`. |
| Committed Skill list change, including rejected imports without a catalog-generation change | `skills`. |
| Skill catalog publication | `skills` and `extension-status`, after coherent commit/publication. |
| Accepted HostCatalogStore set or actual matching deletion | `extension-status`; includes current invalid-candidate retirement and generation replacement. Forged/stale writes do not notify an invented change. |

Do not publish for ordinary MCP lease churn, Skill resource reads/GC, or a test's private diagnostic
result. A last-lease release that actually closes a displayed generation is a lifecycle transition.
A conservative single MCP invalidation per actual closed generation is acceptable; a premature
phase-only optimization must not miss a visible fallback change.
No notifications contain config, secrets/markers, IDs, paths, raw errors or execution I/O. Isolate a
failed subscriber from the producer and other subscribers. Zero subscribers causes no extra query,
MCP connection, test, reconcile or model call. A small microtask union of already-produced extension
target flags is permissible; it must not postpone source correctness or become a polling timer.

Continue using `mcp.list`, `skill.list` and `extension.status`; splitting desired/runtime reads adds an
unnecessary merge race at this stage. Separate connection binding from view invalidation in the
extension strip. Only visible interested projections read; do not refresh both hidden keep-alive
copies. Share an identical concurrent read only where actual overlapping consumers require it.

The current MCP adapter does not independently report every remote transport death or remote tool-list
change. The new channel publishes actual Core-observed changes; it does not add probes, auto-reconnect
or unsupported liveness claims. Filesystem changes similarly require explicit Skill inspection/reconcile.

## 7. Compatibility, errors and rollout

- Keep current reads, writes, generations, bindings and strict result objects intact. New notifications
  and subscription requests live in Shared zod with explicit exports and the existing Core registration
  and Desktop parse/fan-out seams. Classify their existing RPC deadlines; no new port or socket.
- Use the existing authenticated operator gate. Nodes and unauthenticated peers cannot subscribe;
  close cleanup, failed subscribers and unsupported messages cannot alter command outcomes.
- Deploy matching Core/Shared producers before the new Desktop consumer. Older consumers do not
  subscribe and continue using existing reads. A new client receiving the recognized JSON-RPC
  method-not-found result retains bounded entry/manual reads and reports automatic refresh unavailable.
  Authentication/forbidden/invalid-response failures are not an unsupported-feature shortcut.
- Use existing safe error contracts. This task fixes request-state truth and retry behavior, not D77's
  broader taxonomy. Read retry never becomes mutation retry or an unknown-outcome success claim.
- No dependency, migration, sampling/retention knob, raw-data store, Host routing or execution-policy
  change is required. Roll back consumer wiring independently; unused producer hooks remain harmless.
  Preserve canonical data, pause persistence and approved G1-G5 contracts.

## 8. Verification and remaining boundaries

[implement.md](implement.md) defines ordered batches and gates. Required evidence combines deterministic
request/producer tests with real-WebView2 delayed-refresh interaction checks. Assert reads/subscriptions,
not merely component names; measure node identity and reading position during transitions, not only a
final screenshot. Publish exact measured counts and results; do not invent a performance threshold.

Long-CJK Markdown profiling, D77, Avatar Lab/OpenBiliClaw and actual T4 initiative/Heartbeat/cross-device
work remain separate. This planning record does not change historical acceptance checkboxes, activate
implementation, certify concurrent Lab work or claim personal owner inspection.

## 9. Planning review

Two focused read-only reviews checked the frontend lifecycle/draft contract and the selected extension
subscription/producers. Their actionable findings are incorporated: explicit config conflict/save
outcomes, retryable rejected subscription setup, and close notifications for a connecting candidate
whose tool count still comes from a draining fallback. See the appendices in the respective research
files. This is design review, not a completed production Trellis check or runtime acceptance.

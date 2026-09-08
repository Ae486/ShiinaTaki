# Research: Perception producer events and visible refresh

- Query: Keep an open Perception page current from accepted capture/privacy facts, without UI polling, new sensing, broader disclosure, or mutation replay.
- Scope: internal; producer, protocol, connection, and Perception read-model seams only.
- Date: 2026-09-08
- Task: [Page state and event-triggered refresh](../prd.md), planning only; supplied worktree baseline `b251474`.
- Evidence: live files in `H:/TakiAgent-worktrees/t4`. One `jbcontext search` returned revision `258b35b3b70f`; its results were locators, not implementation evidence. No narrowed retry was needed.

## Findings

### Recommendation

Add a content-free, operator-only invalidation channel over actual card-input changes; use one bounded `perception.card` read, which already includes `pauseState`. Preserve old strict card/pause wire shapes. The [final design](../design.md) owns cross-task coordination decisions.

Core initiates existing 30-second foreground requests; there is no Shell foreground-change stream. Activity/descriptions are memory-only, pause is durable, and ambient files have separate retention. The UI is an observation snapshot, not an OS monitor or durable event log.

### Files found

Path prefixes: `core/` = `packages/core/src/`, `ui/` = `apps/desktop/src/`, `shared/` = `packages/shared/src/`, `shell/` = `apps/desktop/src-tauri/src/`. Basename anchors below refer to these groups.

| Live file(s) | Responsibility |
| --- | --- |
| `CONTEXT.md`; `core/main.ts`; `core/perception/perception-layer.ts` | Vocabulary and single privacy composition. |
| `shell/capabilities_impl/foreground_window.rs`; `shell/ws_client.rs` | Bounded observation and final Host enforcement. |
| `core/capabilities/{route-capability,capability-broker,capability-response}.ts`; `core/server/methods/capability-respond.ts` | Host selection, sealed lineage and response acceptance. |
| `core/activity/{activity-layer,activity-sampler,activity-state}.ts` | Cadence/dwell, scrubbed acceptance, coalescing and pruning. |
| `core/perception/{perception-card,privacy-pause,ambient-screenshot-sampler,foreground-screen,screen-context,ambient-shot-gc}.ts`; `core/db/privacy-pause-repo.ts` | Card/pause authority and separate capture/retention sources. |
| `shared/perception-schema.ts`; `core/server/methods/perception-*.ts` | Strict operator methods and registration. |
| `core/config/config-subscriptions.ts`; `core/server/timeline-subscriptions.ts`; `ui/lib/timing-policy-sync.ts` | Fan-out, sink isolation and serialized refresh precedents. |
| `ui/lib/ws-client*.ts`; `ui/windows/home/pages/perception/*.ts[x]` | Client parsing, page reads, controls and wording. |

### Verified producer and trust boundary

1. Core's unattended route and persisted-pause wiring are at `main.ts:264-291`; existing 30-second cadence, two-sample dwell, two-hour span and 240-entry cap are at `activity-layer.ts:16-25`. No new Shell event or sampling is needed.
2. `route-capability.ts:74-93,119-132` seals Host/connection/catalog/policy generations and refuses ambiguous Host selection. Shell `ws_client.rs:541-583,292-332` separates preflight from final enforcement/execution. Node-only `capability-respond.ts:21-31` and `capability-response.ts:15-26,56-75` verify current provenance, lineage and governance.
3. Shell `foreground_window.rs:14-16,43-58,84-109` bounds titles and returns nullable availability/idle facts. Core domain validation, sensitive skip and scrub precede accepted activity publication:

   ```ts
   // core/activity/activity-sampler.ts:172-173
   if (sensitiveSkip(rt, parsed.data)) return;
   rt.deps.state.push(scrubSample(parsed.data), at);
   ```

4. `activity-state.ts:75-109` merges on process, full scrubbed title, idle and sample gap. `current()` exposes the accepted entry before dwell; `entries()` requires dwell. `perception-card.ts:28-44` preserves this and returns at most ten recent rows. D50 remains open (`docs/deferred-decisions.md:78`); no relaxed dwell or unfiltered transition feed.
5. Activity/descriptions are memory-only (`activity-state.ts:3-5`; `screen-context.ts:5-8`); pause alone has its DB row (`privacy-pause-repo.ts:18-38`). Ambient files are separate: sensitive verdicts force discard and accepted descriptions are scrubbed before memory publication (`ambient-screenshot-sampler.ts:165-182`). Neither files nor descriptions are card fields (`perception-schema.ts:60-65`).

### Complete invalidation coverage for the current projection

The proposed hint means only that the existing projection may have changed. Its payload must not identify a sensitive app, refused capture, title, image, description, path or reason for sealing.

| Real event | Existing projection affected | Required hook / consequence |
| --- | --- | --- |
| Accepted ordinary foreground sample: new stretch, title/process/idle switch, or merge | `current`; possibly `recent`, samples/duration and pruning | Notify after the accepted `ActivityState.push` update. A same-title sample still changes accepted sample count/duration; it is not a UI-generated refresh tick. `activity-state.ts:75-100`. |
| Sensitive foreground or `available:false` seals an existing live stretch | `current` becomes null; the former reportable live stretch can enter `recent` | Notify only the effective state transition, with no refused identity/reason. Repeated seal of an already sealed/empty state need not emit. `activity-sampler.ts:90-100`; `activity-state.ts:70-78`. |
| Activity span/cap pruning | `recent` | Included in the accepted push notification. Pruning currently runs on accepted available samples, not a wall-clock retention timer. `activity-state.ts:52-60,100`. |
| Foreground sampler actually starts/stops, including `DENIED` | `samplingStatus.foreground` | Notify on a changed `running()` result. Do not restart a stopped sampler merely to refresh the UI. `activity-sampler.ts:110-131,197-205`. |
| Ambient sampler actually starts/stops, including capture denial or fresh-screen denial | `samplingStatus.ambientScreen` | Same scheduling-state hook; off/no-VLM paths remain unscheduled. `ambient-screenshot-sampler.ts:125-145,197-202,285-300`. |
| Successful operator pause/resume/deadline replacement | Card `pauseState` and `pauseGet` projection | Notify after the owner module's successful durable write/effective state transition; continue echoing the mutation result. No new pause writer. `privacy-pause.ts:58-73`; `perception-pause-set.ts:18-30`. |
| Timed pause expiry, including hydrated future deadlines | Card `pauseState` and `pauseGet` projection | Existing `settle()` is lazy (`privacy-pause.ts:47-55`). Add a bounded Core projection wake-up, described below, so expiry is observable even if both samplers stopped. |
| Core restart / replacement Home client / page reactivation | Entire snapshot trust/freshness | Re-subscribe where needed and perform one guarded read. Do not replay a pause mutation; hydrate Core pause from its existing repo. |
| Node disappearance, reconnect, catalog change, failed/malformed sample, transient backoff | No immediate field change in the current card unless a sampler stops or a new state is accepted | Preserve routing/generation checks. `running()` means scheduled, not Host availability or capture success. Do not invent an availability/current-process field or publish raw Host changes as activity. |
| Config write/reset: ambient enablement, ambient retention, attachment TTL | No current card/pause field changes before restart | All three knobs have `apply: "restart"` (`config/knob-registry.ts:157-167`). Existing `config.changed` covers configuration surfaces; this page only links to Settings. Do not claim saved config is running policy. |
| Ambient capture/description success, sensitive VLM refusal, raw-file inline deletion/GC, description becoming stale | No current card field beyond an independently changed scheduling flag | No new card hint is required. These are separate sources; a semantic refusal must not become a sensitive-content event. `ambient-screenshot-sampler.ts:165-182`; `screen-context.ts:33-38`; `ambient-shot-gc.ts:29-42`. |
| `media.clear` or config row deletion/reset | No activity or pause deletion | `server/methods/media-clear.ts:10-15` clears the attachment store only. Config reset already publishes via `config-writer.ts:59-65`. No Perception activity-clear/delete RPC or ambient-file history view was found. Do not add one. |

**Time is not automatically an event.** The card extrapolates live duration during a read (`perception-card.ts:23-25,41`); no new per-second notification or React timer is warranted. Its activity rolling span is sample-driven. Do not silently turn this task into stricter wall-clock activity eviction.

**Pause deadline notification:** retain the timer-free pause state semantics and sole operator mutation writer. A small Core read-projection owner may arm one unref'd deadline timer while there are interested connections. On wake it calls the existing `pause.state(now)` to settle the already-authorized absolute deadline, then publishes the effective transition once. It never calls `resume()`, writes the DB, routes a capability or invokes a model. Arm from restored state on first subscription; replace/cancel when the operator changes the deadline, resumes, or the last subscriber closes. Recheck current time and deadline identity when waking; a replaced deadline must not resume the replacement pause. Handle long deadlines by bounded timer scheduling against the same absolute deadline, and clock/suspend delays by another state read, not a repeating refresh interval. If a sampler/read already settled expiry, the projection's one pending deadline invalidation must still be delivered once or marked satisfied by that observed transition.

### Protocol alternatives and selected minimal contract

| Approach | Tradeoff |
| --- | --- |
| **Content-free hint + existing card read (selected)** | Demand-read sensitive content, compatible old reads, coalesced snapshots; local guards are needed because bare card replies have no revision. |
| Full card snapshot on subscribe/change | Could avoid rereads and stamp snapshots atomically, but repeatedly pushes titles, requires stronger hidden/unsubscribe/coalescing controls, and exposes unneeded intermediate snapshots. |

Additive operator-only shapes (proposed):

```ts
perception.subscribe({}) -> { status: "ok" }
perception.changed -> { revision: number } // strict nonnegative safe integer; no content/reason
perception.card({}) -> PerceptionCard    // existing strict shape
```

Revision is one Core Perception instance's memory-only invalidation sequence, compared only inside one physical WsClient generation. It is not a timestamp, permission, durable event ID or snapshot cursor. Bare card/echo responses have no server revision; local invalidation/request/write guards remain mandatory. No Character/Host ID, replay buffer or Rust mirror is needed.

Reuse config-style membership: subscribe once when Perception becomes usable, memoize per physical client, and clean up on socket close. Hidden visited pages retain only dirty/version refs, without RPC/render publication. Local handlers deregister on disposal. No wire unsubscribe is required; if zero hints after page unmount is separately required, reuse Monitor's explicit-unsubscribe pattern. See [final design section 5](../design.md#5-perception-facts-and-notification-contract).

### Subscription, race and privacy decisions

[design.md sections 3-5](../design.md#3-resource-state-and-read-coordination) owns final coordination/rendering rules. Source anchors:

- Compose data-free callbacks in `perception-layer.ts`, register through `perception-methods.ts:13-16`, and reuse `config-subscriptions.ts:19-35` connection keys plus `timeline-subscriptions.ts:73-75` failed-sink isolation. No global broadcast bus.
- Preserve operator gating (`method-registry.ts:89-96`), WS pre-auth rejection (`ws-server.ts:115-123`) and close cleanup (`config-subscribe.ts:18-25`). No additional Perception field-level or per-Host operator filter exists. Node producer provenance is separate authority.
- Install the guarded handler, await subscription, then read; remove duplicate effects (`use-perception.ts:49-68`). Reuse Sets/retirement (`ws-client-routes.ts:44-106,108-149`), memoization (`ws-client-methods.ts:225-230`) and one-flight/trailing refresh (`timing-policy-sync.ts:22-49`). Clear failed setup promises for Retry. Local client/scope/lifecycle/request/write/invalidation guards must cover bare card/echo success and failure. Never replay `pauseSet`.
- Fresh `card.pauseState` supplies controls; cached state cannot restore privacy authority after a gap. Same-generation refresh may retain qualified prior confirmation without rebuilding controls. A browser clock cannot confirm resume. `page-visibility-store.ts:20-27` only identifies the shown page: combine Home visibility and suppress hidden reads/publication.
- Preserve Host checks in `capability-respond.ts:25-31`, `capability-response.ts:21-26`, `hosts/host-generation-retirement.ts:16-23`. Wrong/retired Host output cannot create accepted activity. UI epochs/revisions grant no execution authority; `hasNode` can be true while routing correctly refuses ambiguity.

### Minimal cross-layer implementation plan

Follow [design.md](../design.md): add shared schemas/exports; wire accepted-state callbacks and deadline observation through Perception registration; extend existing WS parsing/fan-out/memoization/retirement; replace duplicate page reads with one owner; verify the matrix below. Keep native RPC deadlines explicit (`ui/lib/rpc-deadline.ts:54-61`). Shared exports are explicit (`shared/index.ts:200-209`); the JSON-RPC envelope already accepts string methods (`json-rpc-schema.ts:23-27,57-61`).

Affected groups: `shared/{perception-schema,index}.ts`; `core/activity/{activity-state,activity-sampler,activity-layer}.ts`; `core/perception/{privacy-pause,ambient-screenshot-sampler,perception-layer}.ts`; `core/server/methods/perception-methods.ts`; `ui/lib/{ws-client,ws-client-methods,ws-client-routes,rpc-deadline}.ts`; `ui/windows/home/pages/perception/{use-perception,perception-page,perception-view,pause-controls}.ts[x]`; matching tests/indexes. Proposed new modules: change/deadline owner, connection registry, subscribe method and page read controller. No DB schema, Shell capability, raw store, cadence or config-policy change.

### Race/privacy test matrix

These are required future verification cases; no tests were executed during this research.

| Case | Required assertion | Existing evidence / test seam |
| --- | --- | --- |
| Ordinary sample and merge | Exactly accepted changes invalidate; card preserves current-before-dwell and recent-after-dwell | `activity-state.test.ts:18,51`; `perception-card.test.ts:36-57`. |
| Sensitive/unavailable foreground | Data-free seal can invalidate; no rejected title/process in payload/log; repeated no-op seal emits nothing | `activity-sampler.test.ts:171-205`; `activity-state.test.ts:77-100`. |
| PII/malformed sample | Scrub precedes storage/notification; malformed sample never becomes activity | `activity-sampler.test.ts:208-243`. |
| Ambient off/no vision/pause/denial | Subscription/read does not start a sampler, route a request or call the VLM; scheduling changes publish accurately | `ambient-screenshot-sampler.test.ts:115,126,136,366-377`; extend source callback tests. |
| Fresh pre-capture and semantic privacy gates | Sensitive/unreadable live foreground prevents transmission; sensitive VLM result is discarded without a content event | `ambient-screenshot-sampler.test.ts:214-242,330-363`. |
| Two operators plus unauthorized Node | Both subscribed operators learn the change; non-subscriber/Node receives none; duplicate subscribe and close cleanup remain idempotent | `server/methods/perception-card.test.ts:44-51`; `perception-pause-set.test.ts:53-64`; add subscribe/fan-out tests. |
| Pause persistence and single writer | Mutator publication follows successful persistence; no new production mutator caller; no expiry DB write | `privacy-pause-writer.test.ts:10-28`; `privacy-pause.test.ts:85-112`; `perception-layer.test.ts:107-120`. |
| Deadline expiry when all samplers stopped | One effective invalidation and fresh unpaused read; no UI timer, sampling, provider call or resume mutation | Extend pause/projection tests with fake clock and stopped samplers. |
| Replaced/manual/past/hydrated deadline | Old timer cannot lift a later pause; no timer for indefinite pause; settled deadline survives restart semantics; last subscriber cleanup removes wake-up | `privacy-pause.test.ts:38-78,96-102`; new projection tests. |
| Source change before subscribe / during read | Subscribe-before-read has no lost gap; at most one in-flight and one trailing read; stale response never confirms pause | `timing-policy-sync.ts:28-49`; new controller deferred-promise tests. |
| Event burst, failure, manual retry | Constant-size dirty state, no overlapping reads, no self-retry loop, error clears only after successful replacement | `use-perception.test.ts:7-31`; extend controller tests. |
| Hidden, shown, disposed, StrictMode lifecycle | Hidden hints cause no reads/renders; show performs one required read; cleanup prevents late apply; subscription is memoized per physical client | `ws-client.test.ts:671-719`; new lifecycle tests. |
| Client and Host generation replacement | Old reads, mutation echoes and queued hints are ignored; old/wrong Host response cannot feed activity | `ws-client.test.ts:372,689-707`; `capability-broker.test.ts:53,71,92`; `connection-registry.test.ts:15,37,47`. |
| Write races and unknown outcome | Older read cannot overwrite pause echo/new truth; second local write is serialized; reconnect/timeout never replays mutation | Existing method echo tests plus new controller deferred-read/write tests. |
| Settings reset, retention sweep, media clear | No false change to active sampler policy, activity history or pause; no raw capture/description exposed | `config-writer.ts:59-65`; `ambient-shot-gc.test.ts:29-44`; `ambient-shot-store.test.ts:36-53`; `media-clear.ts:10-15`. |
| Privacy cache and cold/error states | No Perception/pause persistence; initial failure stops Skeleton; stale content stays readable without asserting fresh privacy state | `cache-persist.test.ts:53-69`; new page/render tests. |

### Rollout and rollback compatibility

- Roll out Core/shared additive methods first, then the desktop consumer. Older clients continue using unchanged `card`, `pauseGet` and `pauseSet`; they receive no new channel until they subscribe.
- A new client talking to an older Core may receive JSON-RPC `METHOD_NOT_FOUND`. Preserve bounded entry/show/manual reads and clearly report that automatic refresh is unavailable; never silently claim a healthy live channel or introduce a timer fallback. Authentication/forbidden errors are not unsupported-feature fallbacks.
- Roll back the consumer independently. The unused source callbacks/subscription channel must be harmless with zero subscribers. Preserve existing pause persistence and capture/retention code during rollback.
- Do not add optional metadata to the existing card object casually: it is a `z.strictObject`, so older clients would reject additional fields. If a future requirement truly needs atomic snapshot revisions, introduce an explicit new read envelope/version instead.

### Related specs and external references

- [Server push/auth](../../../spec/backend/server-push-and-connection-auth.md): `:7-33`, fan-out, no-producer gap, reconnect and no Rust mirror.
- [Agent runtime](../../../spec/backend/agent-runtime.md): `:175-217`, fail-closed screen/seal, durable pause/single writer, retention and D48.
- [Reactive read models](../../../spec/frontend/reactive-read-models.md): `:8-60`, typed route, generations, no polling/replay and hidden-work rules.
- [State management](../../../spec/frontend/state-management.md): `:73-86`, persistence allow-list and no pause cache.
- [Connection recovery](../../../spec/frontend/operator-connection-recovery.md): `:84-116,132-159`, native deadlines and revalidation.
- No external API/documentation lookup was needed for this internal audit; React research is separate. Declared ranges, not installed versions: React `^19.2.0` / JSON-RPC `^1.7.1` (`apps/desktop/package.json:17-19`); WS `^8.21.0` / Zod `^4.4.0` (`packages/core/package.json:25-28`); Tauri `2.11`, xcap `0.9`, sysinfo `0.39` (`apps/desktop/src-tauri/Cargo.toml:34,53-54`).

## Caveats / Not Found

- **Existing wording exceeds the evidence.** `samplingStatus` is scheduled-loop state, even while a loop skips for pause/offline/backoff (`activity-sampler.ts:145-155,204`; `ambient-screenshot-sampler.ts:229-251,300`). `perception-view.ts:11-20` currently maps an unpaused flag to "observation ongoing" and scheduled booleans to "in progress". Use wording grounded in pause/scheduling facts; neither fact proves a capture happened.
- **`current` is a last accepted sampled stretch, not an always-live process fact.** There is no `observedAt`, capture outcome, Host identity, revision or availability field in the card. The builder extrapolates duration; after pause/offline, that can outlive fresh evidence. Do not calculate a supposedly exact last-observed time from `startedAt + card.durationMs`, or invent a replacement process name. Display it as the latest observed activity and keep snapshot freshness explicit. Additional active-capture status/expiry fields would need a separate reviewed projection contract.
- **Baseline asynchronous privacy limitation remains visible.** The inspected sampler loops check pause before awaiting their route; the foreground push and ambient capture/describe continuation do not repeat the pause check after every await (`activity-sampler.ts:145-173`; `ambient-screenshot-sampler.ts:229-257,165-182`). This research does not prove cancellation of work already in flight when the operator pauses. The new notification must describe accepted Core state, not claim that stronger guarantee. Do not expand this task into unreviewed capture-policy changes; record any required follow-up explicitly.
- Fresh foreground screening and actual capture remain separate routed operations (D48). Neither a UI refresh nor a content-free hint closes that gap. Host/policy generation checks remain authoritative upstream.
- No activity-delete RPC, live retention-setting application, complete capture-status producer, durable Perception event log, or independent foreground-window push stream was found. Hooks should be added only for the verified projection inputs above.
- The child session's `task.py current --source` returned no active binding; the supplied task path and seeded PRD were used. The legacy pointer was only inspected as required by the researcher workflow, then left untouched. No task lifecycle operation was performed.
- Completed: source trace, protocol alternatives, recommended minimal plan, race/privacy matrix and artifact checks. Unverified: runtime/WebView2 behavior and all proposed implementation tests. No production/spec/config/task metadata or dependencies were changed, no Git operation was run, and no real database/provider/window was accessed.

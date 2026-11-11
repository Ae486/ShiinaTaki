# Reactive Read-Models: Push, Generations, Visibility & Scroll Discipline

> How home-window pages stay current with Core truth without polling, replaying writes, or inventing
> states. Consolidates what the app actually does after batches 1–7 of the 08-30 UI/UX task; every rule
> below cites the seam that enforces it. Home pages are disposable read-models over Core state — nothing
> here creates a second authority (state-management.md).

## (a) Push-driven pages update from WS events through generation-guarded handlers

- The ONLY inbound-push seam is `src/lib/ws-client-routes.ts` `installRoutes()`: every notification frame
  is zod-parsed at the boundary and fanned out to registered handlers (`config.changed` → handler `Set`,
  `observability.event` → monitor handler `Set`, `timeline.appended`/`removed`, `avatar.command`,
  approval request/closed). A page never parses raw frames and never registers a second routing path.
- Handlers are registered per authenticated client generation and deregistered with it. Generation
  guards compare BOTH the local candidate and the client identity before applying:
  `MonitorControllerImpl.current(candidate, target)` (`monitor-controller.ts` — generation bumps in
  `bind`/`dispose`/`setVisible`), the `generation` ref inside `useCachedFetch` (`use-cached-fetch.ts` —
  a newer load supersedes an older answer), and the permission controller's token pass
  (`permission-controller.ts`). A retired client's late answer is dropped, never merged.
- Writes do not take the push path as their source of truth: a `config.set` applies its own server echo
  (`applyStored`), a `perception.pauseSet` returns the resulting server state — pushes only keep the
  list honest between writes.

## (b) Request/response pages refetch per authenticated client generation; writes never replay

- Read pages key their load on the client generation: `load` changes identity when `ready` changes and
  `useCachedFetch`'s effect re-runs it (`use-config.ts`, `use-perception.ts`). Controller-owned pages
  refetch in `bind()` → restore (`monitor-controller.ts` `attach` → `monitorState`) or reset to loading
  on bind (`skills-controller.ts`, `mcp-controller.ts`). There is no fetch outside this per-generation
  rhythm except an explicit operator action (refresh/retry/load-more) or the visibility gate in (d).
- A reconnect or timeout NEVER replays a mutation. Mutations serialize (one at a time:
  `permission-controller`, `mcp-controller`, `skills-controller` `mutationLock`); a revision/policy
  conflict refetches Core truth and requires a fresh operator action; an interrupted write surfaces as an
  error, not a queued retry.

## (c) No polling intervals in home windows

- `setInterval` for data is forbidden (quality-guidelines.md). Data arrives via WS push: `chat.delta`,
  `timeline.appended`, `config.changed`, `observability.event`. If a page needs fresher data than the
  push stream provides, the answer is a Core push or an operator-triggered refetch — never a timer.
- The only legitimate timers are ONE-SHOT deadlines and backstops, never re-arming fetch loops: RPC
  deadlines (`rpc-deadline.ts`), the timeline load-older backstop (`use-timeline-scroll.ts`
  `LOAD_BACKSTOP_MS`), costume result deadlines. Coalescing timers that BATCH already-pushed data
  (`chat-delta-coalescer.ts` ~40ms trailing edge) are allowed — they fetch nothing.

## (d) Hidden keep-alive pages gate expensive live work; additive delta listeners stay live

- The signal is `windows/home/page-visibility-store.ts` (`usePageVisible(id)`), written once per change
  by the shell from its RENDERED output (post monitor-disabled fallback). The chat page deliberately
  ignores it (the stream must settle while hidden).
- Expensive live work gates on visibility: the monitor tears its subscription down while hidden
  (`setVisible(false)` → generation bump, handler removal, `unsubscribeMonitor`, no re-publishing;
  reactivation re-attaches and refetches), and perception keys its reads on visibility (a hidden page
  performs no Core reads).
- Cheap additive delta listeners stay live: the settings family keeps its `config.changed` subscription
  registered while hidden — BUT the local apply is skipped (`config-gate.ts` via `use-config.ts`): the
  state cannot be observed, so the delta is dropped locally, the gap is recorded, and reactivation
  refetches instead of replaying a delta queue. Permission listeners stay live ungated (rare, small,
  correctness-sensitive). The gate's reactivation refetch is deduped: while a load is already in flight
  it waits for that load to settle and then issues exactly one refetch — requests never stack.
- A hidden page must not drive React renders: the monitor suppresses `emit` while hidden and
  reconciles from its page memory on reactivation.

## (e) Reconnect recovery is a per-page restore seam, never a shared replay

Each page declares how a fresh generation becomes trustworthy; there is no global restore:

| Page | Restore seam |
| --- | --- |
| chat | `restore-chat-timeline.ts`: subscribe BEFORE history, then an authoritative newest-page reconciliation keyed by `seq` (tombstones for removed rows; raced live rows and older pages survive). `connected` publishes only after restoration. |
| monitor | `bind` → `attach` → `monitorState` restore re-reads mode + list + the selected run's trajectory (selection memory survives hide/show and client swaps); an `invalidated` live event re-reads from the durable cursor (`recoverLive`), and the surfaced `stale` flag clears only on real recovery. |
| perception | Reads are keyed on visibility; reactivation (or reconnect via a new generation) re-runs them. Pause state is never cached. |
| mcp / skills | A fresh `mcp.list` / `skill.list` per generation; state resets to loading on bind. |
| settings (config) | Per-generation `config.list` via `useCachedFetch`, plus the one deduped on-show refetch when deltas were skipped while hidden. |
| permissions | Fresh snapshot per generation from the controller (`replace(ready)`); conflict refetches; nothing persists. |

## (f) Scroll discipline: bottom-pinning, pause-on-scroll-up, load-older hold

- Chat owns the canonical pattern (`use-timeline-scroll.ts`): an `atBottom` ref updated from scroll
  position (`NEAR_EDGE_PX`), a layout effect that pins `scrollTop = scrollHeight` on content change only
  while at-bottom, a prepend hold that preserves the reading position when an older page lands (keyed on
  the oldest mounted seq so it survives the P1b window trim), and a bounded backstop that re-arms the
  load guard if a page was fully trimmed.
- The monitor trajectory ledger follows the same pattern with fewer inputs
  (`use-trajectory-follow.ts`): content changes are row appends only (no prepend, no top-reach load), so
  it keys on the mounted row count and additionally EXPOSES the paused state (`following`) so the UI can
  render a truthful affordance. Opening the inspector changes layout, not row count — the follow never
  fights it.
- A pause/resume affordance is rendered ONLY when the user is genuinely paused-from-bottom AND it is a
  real control (`已暂停跟随 · 回到底部` ActionButton → scroll to bottom + re-pin). If the stream rarely
  pushes, the affordance simply rarely appears — that is correct, not a defect to paper over with an
  always-on "live" indicator.

## (g) Stale/busy indications come from real signals only — never invented states

- `PageHeader busy` is fed by actual in-flight loads (`loadingRuns || loadingTrajectory` in the monitor;
  `refreshing` from `useCachedFetch` for cached pages). No simulated busy state, no artificial delay.
- The monitor's `stale` flag is set ONLY by a Core `invalidated` monitor event and cleared ONLY by real
  recovery (`refresh`, `recoverLive`, re-select, restore's disabled-reset, or a contiguous live `onLive`
  row append from the subscribe cursor) — never by a timer or a guess. The cached-fetch `refreshing` marker is driven by the load state machine
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

// Correct: the push keeps the visible page honest; hidden gaps are recorded and refetched ONCE on show.
const unsubscribe = ready.onConfigChanged((changed) => {
  const decision = onConfigDelta(gateRef.current, isSettingsShown());
  gateRef.current = decision.state;
  if (!decision.apply) return;
  mutate((prev) => ({ ...prev, entries: applyChanged(prev.entries, changed) }));
});
// …and on reactivation, onConfigReactivation() issues exactly one refresh() when no load is in flight.
```

## Future extraction rule

`use-timeline-scroll` (chat) and `use-trajectory-follow` (monitor) deliberately duplicate the
at-bottom/pin skeleton because their inputs genuinely differ (prepend hold + top-reach loadOlder +
in-flight length vs row-count-only + an exposed paused state) and a parameterized merge would contort
the chat seam. Extract ONE `useTailFollow` when a THIRD consumer materializes with a superset of these
inputs — not before.

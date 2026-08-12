# D59/D61 WebSocket Reconnection and Request Deadlines

## Status

- Phase: Trellis Phase 3 (spec/documentation closeout; owner manual acceptance pending).
- Owner approved implementation on 2026-08-08.
- Owner decision recorded 2026-08-07: renderer attachment is the worn-costume commit boundary (Decision Gate A,
  option A).
- Owner decision recorded 2026-08-08: reconnect and request timing values remain configurable during development;
  the first implementation uses a test profile, and runtime evidence determines the final defaults.
- Owner decision recorded 2026-08-08: every D59/D61 duration is visible and editable through the existing home
  settings panel and Core config registry. Bootstrap fallback remains mandatory while Core is unreachable.
- All statements below are labeled as verified facts, decisions, proposals, or explicit gaps. Unsupported timing values
  must not enter production code.
- Production implementation and the single formal `trellis-check` completed on 2026-08-08. D59/D61 remain OPEN until
  owner manual acceptance and a task commit exist; no finish/archive/push has occurred.

## Goal

Make every desktop operator window recover from an Agent Core WebSocket interruption without reloading its webview,
and ensure request/response work cannot remain pending forever. Close D59 and D61 together because a reconnectable
client still wedges on a half-open request without deadlines, while request deadlines alone leave a dead window with
no replacement client.

## Scope Map

### D59: operator connection lifecycle

- Pet operator socket.
- Shared home settings-family operator socket.
- Chat page's independent streaming operator socket.
- Fresh transport/client generations, authentication, reconnect, status, and per-generation restoration.
- Initiator-owned deadlines for JSON-RPC request/response work.
- Settlement of old-generation open waiters, pending requests, and D29 active chat turns.

### D61: pet costume operation lifecycle

- One total pet-side operation budget across Core resolution, Tauri path composition, renderer load, and the terminal
  presentation result.
- Stage-aware cancellation so an abandoned pre-render continuation cannot later start and attach a model.
- Preservation of the existing renderer ticket and `abortSwitch()` late-load protection.
- A truthful commit policy after renderer attachment, where rollback is not available in the current renderer API.
- Recovery of the committed costume report after a connection generation changes.

## Verified Current State

1. `createBrowserTransport(url)` creates one browser `WebSocket`; it has no reconnect or replacement surface.
2. `createWsClient({ transport })` binds one JSON-RPC client, one active chat-turn slot, and one set of push callback
   slots to that transport generation.
3. Pet, shared home, and chat each create one client in a mount-only effect. Home intentionally owns two independent
   sockets: settings-family and chat streaming.
4. A real close calls `rejectAllPendingRequests` and D29's `abortTurn`, but no window creates another generation.
5. `whenOpen()` waiters are not rejected when a socket closes before opening.
6. Avatar, timeline, and config subscriptions are keyed by the live Core connection and are removed on close. A new
   socket must authenticate and subscribe again.
7. Mounted consumer hooks already re-run most reads when the authenticated `WsClient` identity changes. Mutations must
   not be replayed.
8. Timeline restoration already uses the safe order: install local handlers, subscribe, then fetch/merge history.
   A partially streamed old turn is failed through D29 and is not resumable across sockets.
9. Every ordinary method in `ws-client-methods.ts` currently calls bare `rpc.request(...)` and can wait forever while
   the browser socket remains apparently open.
10. Installed `json-rpc-2.0@1.7.1` provides a native timeout requester. Its installed implementation deletes the
    request ID from its pending map before producing the timeout error, and ignores a later response for that ID.
11. An outer `Promise.race` does not clean the JSON-RPC pending entry. A direct probe against the installed package
    reproduced that leak.
12. The installed JSON-RPC API has no `AbortSignal`, cancel-by-ID, or forget-by-ID API. Whole-generation retirement
    can use `rejectAllPendingRequests`; one-request deadlines must use the native timeout requester.
13. Only the renderer stage of a costume switch has a 30-second timeout. Core resolution, Tauri path composition, and
    `avatar.report` are unbounded.
14. Home's result-bearing costume command already has a separate 45-second initiator deadline, Cancel flow, and typed
    result. Owner manual checks #74 and #75 passed; D61 must preserve this contract.
15. Cancel or timeout before `scene.switchCostume()` starts does not stop the abandoned chain from later obtaining a
    new renderer ticket. A generation check currently suppresses React state updates, not renderer/report side effects.
16. `PetScene.switchCostume()` destroys the previous model and attaches the new model before `avatar.report` runs.
    `abortSwitch()` cannot roll back an already attached model.
17. A report failure after attachment currently leaves an impossible presentation: new model visible, but the home
    result, hook state, and `last-costume` can remain old.
18. Pet and non-chat home pages have no persistent connection presentation. Chat has a banner, but its composer remains
    usable while disconnected.
19. Native browser WebSocket does not prove a silent half-open connection is unhealthy until an event or traffic
    exposes it. This task can bound active requests; passive heartbeat detection remains T4/out of scope.
20. Owner-reported runtime observation, not yet reproduced: after a long idle period, local Live2D click/proximity and
    home-page chat still worked and avatar tools still executed, but remote motion/expression commands no longer changed
    the model. Owner clarification on 2026-08-08 confirms the working chat used the independent home-chat socket; pet
    bubble health is unknown. The failure mechanism is source-proven: if the independent pet socket closes, Core removes
    its avatar subscription, current pet code never reconnects, home chat remains healthy on another socket, and
    fire-and-forget avatar tools still return `{ ok: true }` with zero subscribers. The exact long-idle transport trigger
    remains unverified, but no additional reproduction is required before fixing this permanent-recovery defect.

## Research References

- [`research/ws-reconnect-current-state.md`](research/ws-reconnect-current-state.md) - current-generation maps for
  pet/home/chat, subscription restoration, D29, pending work, tests, and stale-record corrections.
- [`research/ws-library-and-deadline-options.md`](research/ws-library-and-deadline-options.md) - installed
  `json-rpc-2.0` behavior, runtime leak probe, reconnect-library comparison, backoff evidence, and test strategy.
- [`research/ws-recovery-ux-and-costume-contract.md`](research/ws-recovery-ux-and-costume-contract.md) - D59 window
  UX, D61 stage/cancel/commit analysis, current cross-window contract, and manual boundaries.
- [`research/avatar-command-idle-disconnect.md`](research/avatar-command-idle-disconnect.md) - owner-reported long-idle
  remote avatar-command failure, remote/local path split, ranked hypotheses, D59 scope, and accelerated regression seam.

## Requirements

### R1. Independent connection generations

- Preserve one independent lifecycle owner for pet, shared home, and chat. Do not share a client across windows or
  merge chat streaming state into the settings-family client.
- Every attempt creates a fresh browser transport and fresh `WsClient`.
- A candidate is not published as connected until its WebSocket is open and its `connect` handshake succeeds.
- Every async continuation is guarded by lifecycle generation and disposal state. Late outcomes from generation N
  cannot update generation N+1.
- Unexpected close retires the old generation and schedules reconnect. Component/window disposal closes the current
  candidate/client and cancels all future attempts.
- Authentication or pairing refusal remains distinct from transient transport failure; it must not become a blind
  retry loop.

### R2. Bounded reconnect policy

- Use capped exponential backoff with full jitter and injected clock/RNG for deterministic tests.
- Retry transient transport/open/handshake failures indefinitely with a capped delay because a user may intentionally
  stop Core for longer than any fixed attempt count.
- Reset the retry exponent after a successful authenticated generation.
- No disconnected request buffering or offline command replay is allowed.
- Exact base delay, cap, and open/handshake deadline are configurable design parameters, not current project facts.
  The owner approved the first development test profile on 2026-08-08; runtime evidence is still required before
  choosing final defaults.

### R3. Old-generation settlement

- A close before open rejects all `whenOpen()` waiters.
- Retiring a generation settles every JSON-RPC pending request once and settles an accepted active chat turn once via
  the existing D29 error path.
- A late response/message/open/close callback from a retired generation is ignored.
- The lifecycle must not rely on listener removal alone; already queued callbacks still require generation guards.

### R4. Request deadlines

- Route ordinary request/response calls through one internal request helper backed by
  `json-rpc-2.0@1.7.1`'s native timeout requester.
- Translate a native timeout into one stable typed desktop error while preserving non-timeout JSON-RPC application
  errors and zod result parsing.
- Use a small method-policy table rather than one universal timeout. At minimum distinguish connection/interactive
  work, long-running maintenance/import work, and chat acknowledgement.
- A timed-out mutation has an unknown outcome and is never replayed automatically. Its UI must release local busy state
  and allow an explicit reread/retry.
- A chat acknowledgement can be bounded; the accepted stream itself remains governed by complete/error/D29. This task
  does not invent a stream-completion timeout or resume protocol.
- One request timing out must not reject unrelated concurrent requests. A late response after timeout must be ignored.
- An active request timeout may mark its connection generation unhealthy and trigger replacement, but that policy must
  be applied consistently and must never replay the timed-out operation.

### R5. Per-generation restoration

- Reuse the newest locally stored operator credential and authenticate before restoration.
- Pet: install the avatar callback, report the live scene vocabulary and truthful committed costume identity when one
  exists, subscribe once, and re-read costume metadata.
- Pet avatar report/subscribe restoration is observed work, not fire-and-forget. A timeout or failure cannot leave the
  generation labeled healthy while its remote command channel is absent.
- Shared home: expose the replacement client to the mounted page. Config registers its local callback before one
  subscribe; current idempotent page reads re-run from the new client identity.
- Chat: install timeline callbacks, subscribe, then fetch/merge history. Clear the old partial streamed row through D29;
  do not reconstruct it from deltas.
- Preserve last-good cached/read state during reconnect. Only successful replacement reads replace it.
- Restore only idempotent subscriptions, reports, and reads. Never replay chat send, import, config set, tidy, media
  clear, pause set, or costume commands.

### R6. Honest window-level connection UX

- Extend the discriminated connection union with a reconnecting state rather than overloading a terminal disconnected
  label.
- Use one semantic status-to-copy mapping across surfaces; connected renders no notice.
- Non-chat home pages show the shared home socket's persistent slim status at the page-frame boundary. The chat page
  shows only its independent chat-socket status there, not the unrelated shared-home status.
- Pet shows a compact persistent overlay in the existing notice area without making the transparent root opaque.
- Connection-dependent actions fail fast or are disabled while no authenticated client exists. The shared status is the
  explanation; do not add a special warning only to Refresh or any other single button.
- Existing cached data and local drafts remain visible during reconnect.

### R7. Stage-aware costume deadline and cancellation

- One attempt owns a cancellation/deadline token from guard acquisition through its terminal presentation result.
- Each stage checks the token after its await and before starting the next stage. A Cancel/timeout while resolution or
  Tauri path composition is pending cannot later start renderer work or `avatar.report`.
- The total pet-side operation budget remains less than the effective home result deadline (currently 45 seconds).
- The renderer retains its ticket and `abortSwitch()` behavior. Cancel, renderer timeout/failure, and supersession call
  it so a late load self-discards before replacing the old model.
- Deadline and Cancel races produce one terminal pet result and release the single-flight guard exactly once.
- The existing result event names, refusal vocabulary, home reducer, row-level pending state, Cancel-first release, and
  #74/#75 behavior remain unchanged.

### R8. Truthful post-attachment semantics

- The current renderer cannot roll back after attachment. The owner selected Decision Gate A option A on 2026-08-07:
  successful renderer attachment commits the worn costume, while Core report acknowledgement is a separate bounded
  synchronization step.
- On attachment, update the window-local committed scene identity, `last-costume`, pet state, and the result-bearing
  home flow before treating a later report outcome as synchronization health.
- A failed or outcome-unknown `avatar.report` does not relabel the visibly committed switch as failed. The current
  in-memory scene snapshot, including its committed costume ID, is re-reported on the next authenticated generation.
- The rejected current behavior - report `failed` while leaving the new model visible and old identity persisted - is
  not allowed.
- `last-costume` must represent an actually attached model, never a click intent or a timed-out/discarded renderer load.

### R9. Narrow reconnect-dependent costume recovery

- If initial promotion is interrupted before a definitive outcome, a later authenticated generation may retry it.
  A successfully attached promotion must not reload on every reconnect.
- A transient costume-metadata refresh failure must retain last-good metadata; it must not convert every later request
  to `unknown-costume` until another manual refresh.
- The fresh-Core reconnect report must not claim a persisted costume that has not attached in the current scene.

### R10. Long-idle remote avatar-command recovery

- Treat the owner-reported symptom as a concrete D59 acceptance case: local click/proximity may keep working while a
  dead pet socket has lost its connection-scoped `avatar.subscribe`, home chat remains healthy on another socket, and
  fire-and-forget avatar tools still return success with zero subscribers.
- Owner confirmation that home-page chat remained healthy is consistent with, and does not falsify, this mechanism;
  home chat and pet avatar push intentionally use different clients.
- After a pet generation closes, a replacement generation must authenticate, install its local avatar callback,
  report the current committed scene, and subscribe exactly once before it is considered fully restored.
- A known remote expression and motion sent after restoration must each reach the current scene exactly once without a
  pet webview reload. A late command from the retired generation cannot reach the scene.
- Manual verification distinguishes the two chat surfaces: home-chat success proves only the independent chat socket;
  a complete pet-bubble turn proves bidirectional traffic on the pet socket.
- Do not add periodic avatar resubscription, avatar-only heartbeat, or a renderer reset without runtime evidence. The
  current Core has no time-based avatar subscription expiry, and working local reactions make a general renderer
  freeze the lowest-ranked current hypothesis.
- If the symptom remains while a post-failure pet-bubble turn succeeds, trace subscriber count, Core notify, browser
  frame receipt, route callback, vocabulary validation, and model call in that order before choosing another fix.

## Feasible Approaches

### Connection lifecycle

| Approach | How it works | Advantages | Costs / risks | Decision |
| --- | --- | --- | --- | --- |
| A. Local generation manager | A small framework-free manager owns transport/client attempts, generation guards, backoff, disposal, and state publication. Browser WebSocket and `json-rpc-2.0` retain protocol mechanics. | Fits current seams and fake transports; no dependency; all Taki-specific auth/restoration remains explicit. | We own a small amount of retry policy code. | **Recommended.** |
| B. `websocket-ts@2.3.0` plus host manager | The package retries physical sockets; a local manager still owns client generations, auth, restore, deadlines, D29, and UX. | Maintained focused package; listener/retry utilities included. | New dependency and compatibility spike; no built-in jitter/open timeout; does not remove the hard application logic. | Not justified for current scope. |
| C. React reconnect hook | Move transport ownership into a React WebSocket hook. | Familiar component API. | Conflicts with the framework-free client seam; still needs JSON-RPC cleanup and host generation semantics; common buffering defaults are unsafe. | Rejected. |

**Connection decision:** use Approach A with current dependencies. Reconsider a raw-socket dependency only if the
local code grows into generic buffering, URL failover, heartbeat, or multiple transport support.

### Request deadline

| Approach | Pending entry cleanup | Concurrent request isolation | Decision |
| --- | ---: | ---: | --- |
| `rpc.timeout(ms).request(...)` | Yes, verified in installed source/probe | Yes | **Use.** |
| Outer `Promise.race` | No; verified leak until response/close | Caller only | Reject. |
| Timeout + `rejectAllPendingRequests` | Clears all entries | No | Reject for one-request deadlines; retain for generation retirement. |
| Host-owned second ID/pending map | Host-defined | Possible | Reject as duplicated library ownership. |

### Decision A: costume commit boundary (owner-approved 2026-08-07)

#### A. Renderer attachment commits the worn costume (selected)

- Split renderer attachment from Core report acknowledgement.
- On successful attachment, synchronously record the window-local committed costume and `last-costume`, update the pet
  state, and publish a successful home result.
- Start a bounded idempotent `avatar.report` sync immediately. If it fails or its outcome is unknown, do not relabel the
  visible switch as failed. Re-report the current scene snapshot, including the committed costume ID, on the next
  authenticated generation.
- The in-memory scene snapshot, not `localStorage` alone, determines what can truthfully be reported after reconnect.

Consequences: matches what the operator can see; preserves the existing load-before-teardown renderer; requires a
small explicit "attached but report pending" synchronization state and an observable recovery path for report failure.

#### B. Add renderer prepare/commit/rollback (not selected)

- Keep the old model recoverable until `avatar.report` succeeds; commit the new model only after the report.
- On report failure, tear down the candidate and retain/restore the previous model.

Consequences: stronger cross-layer transaction semantics, but current renderer APIs destroy the previous model before
reporting. This is a substantial renderer redesign, increases memory/lifecycle risk, and is disproportionate to D61.

#### C. Keep current ordering and call `abortSwitch()` after report failure

Rejected: `abortSwitch()` cannot restore a destroyed previous model, so this preserves the proven contradiction.

## Recommended Technical Design

### 1. Deadline substrate

- Add a typed internal deadline error and method-policy selector around the installed JSON-RPC timeout requester.
- Use it in handshake and all request/response methods while leaving schema parsing at the current boundaries.
- Keep chat stream completion separate from request acknowledgement.
- Make lifecycle retirement idempotent and fix close-before-open settlement.

### 2. Framework-free connection lifecycle

- Add one lifecycle controller under `apps/desktop/src/lib/` with injected transport/client factories, scheduler, and RNG.
- Maintain a monotonic generation ID, one candidate/current generation, and explicit dispose state.
- Publish window-local status transitions: initial connecting -> connected, or reconnecting during transient recovery;
  pairing/auth errors remain specific terminal states.
- Retire on close and on owner-approved unhealthy deadline classes. Never queue frames for a later socket.

### 3. Window adoption and restoration

- Replace duplicated one-shot connection effects in pet, home, and chat with one controller instance per owner.
- Publish a fresh authenticated `WsClient` identity per generation so current page hooks revalidate naturally.
- Keep window-specific restoration in their current ownership layer; do not centralize every page read in the manager.
- Add shared status semantics with home/chat frame presentation and a compact pet overlay.
- Gate chat composer and other clearly actionable controls on authenticated readiness; retain cached data/drafts.

### 4. Costume attempt controller

- Replace the React-only generation guard with an explicit attempt object carrying cancellation/deadline state and
  stage checks.
- Apply the total remaining budget across resolution, Tauri composition, and renderer work. Use the JSON-RPC native
  deadline for resolution; use a local elapsed-time guard plus cancellation check for Tauri APIs that expose no abort.
- Keep renderer ticket invalidation for an already-started load.
- Implement the owner-selected post-attachment policy and make reconnect report the current in-memory committed scene
  snapshot rather than inferring it from stale persistence.
- Convert initial promotion's pre-I/O boolean into a minimal idle/running/committed outcome so only interrupted work can
  retry after reconnect.

## Timing Policy Configuration

The repository contains only two relevant existing values: a 30-second renderer timeout and home's 45-second
cross-window result deadline. It contains no approved reconnect base/cap, open/handshake timeout, or general RPC
deadline. External libraries provide examples/defaults, not evidence for this localhost product.

The owner decided that development must not scatter or freeze final values. Implementation must define one typed,
bootstrap-safe policy object that the connection lifecycle and request helper receive through injection. Tests can
replace the full policy without changing production logic. The policy source cannot depend exclusively on a live Core
connection because open/handshake/reconnect values are required precisely while Core is unreachable.

The configurable policy covers:

1. reconnect base delay and cap;
2. physical open/handshake deadline;
3. interactive/read/subscription/report deadline;
4. long-running mutation/maintenance deadline;
5. chat acknowledgement deadline;
6. a total pet costume budget strictly below the effective home result deadline.

The visible registry rows cover the complete D59/D61 timing family, including reconnect base/cap/stability reset,
open+authentication, interactive RPC, long RPC, chat acknowledgement, pet costume total, renderer load, and the home
cross-window result deadline. Shared key/schema definitions are single-source; Core registry validation and desktop
consumption must not hand-declare the same vocabulary independently.

Bootstrap and live application contract:

1. A typed desktop fallback is available before any WebSocket exists. It is the only policy used for the first
   open/authentication attempt or when Core cannot be reached.
2. After authentication, each independent connection owner reads the effective timing rows from `config.list` and
   subscribes to config changes. A relevant change causes a bounded re-read of the full effective policy so reset and
   environment precedence remain truthful.
3. The current authenticated generation uses the refreshed request policy, and future retry attempts use the refreshed
   reconnect policy. An in-flight timer keeps the value captured when that operation began.
4. Timing policy push handlers must coexist with the settings page's config consumer; one callback must not overwrite
   another. Each socket sends at most one `config.subscribe` request per generation.
5. Invalid or cross-field-inconsistent policy input keeps the last-good in-memory policy and surfaces a diagnostic;
   it never prevents bootstrap reconnect. Pet total/renderer/home-result relationships are validated together.
6. Core remains the sole persisted authority. No timing value or last-good policy is written to `localStorage`.

The rows are live only after production consumption observes `config.changed` and re-reads effective values as above.
Until that path is implemented and tested, their apply class must not claim `live`.

The first test profile uses the previously proposed balanced values (500 ms reconnect base, 10 s cap and stability
reset, 10 s open+handshake, 15 s interactive/chat acknowledgement, 120 s long work, and 40 s pet costume total with
the existing 30 s renderer cap). These are test inputs, not final product constants. Automated fake-clock/stress tests
and real Core stop/start, long-operation, sleep/resume, and costume checks must produce the evidence used to finalize
defaults. No call site may embed an independent numeric literal.

## Implementation Plan

### Batch 1: visible timing policy and deadline substrate

- Add shared single-source timing keys/schema, Core config-registry rows, and automatic rendering in the existing panel.
- Add the bootstrap fallback plus authenticated config-list/change consumption without UI-owned persistence.
- Add request policy/error helper backed by the installed timeout requester.
- Migrate handshake and ordinary RPC methods without changing their result schemas.
- Fix close-before-open settlement and make generation retirement idempotent.
- Add policy validation, reset/environment-precedence, callback fan-out, and deadline cleanup tests.

### Batch 2: generation lifecycle, three window owners, restoration, and status UX

- Add framework-free lifecycle manager with deterministic transport-factory, timer, jitter, stale-generation, and
  disposal tests.
- Adopt the lifecycle in pet, shared home, and chat while preserving three independent sockets.
- Re-authenticate and restore avatar/timeline/config behavior exactly once per generation.
- Preserve D29 and timeline subscribe-before-history behavior.
- Add home/chat frame status, compact pet status, and readiness-aware actions.
- Prove reconnect revalidation preserves last-good cached values and does not duplicate handlers/subscriptions.
- Add the accelerated avatar regression: close the pet generation while the independent home chat remains usable,
  reconnect without pet remount, then prove one known expression and motion reach the scene exactly once.

### Batch 3: D61 costume truth and cancellation

- Add whole-attempt deadline/cancellation checks and retain renderer ticket abort.
- Implement the approved post-attachment commit policy.
- Repair fresh-Core scene reporting, interrupted initial promotion, and last-good costume metadata only as required by
  reconnect/costume correctness.
- Preserve the result-bearing Tauri protocol and all #74/#75 behavior.
- Add stage-by-stage unresolved-promise, Cancel/deadline race, late-renderer, and report-failure tests.

### Batch 4: proportional convergence and durable closeout

- Run focused tests after each batch and package typecheck/lint at convergence.
- Use one formal `trellis-check` only after the complete production diff converges; do not repeat a full check for
  documentation-only follow-up.
- Run the strictly manual Core stop/start, real window, transparent-pet, chat, settings push, and costume paths below.
- Update reusable specs, D59/D61 rows, HANDOFF, task closeout, and manual-check records with actual evidence.

## Formal Verification Evidence (2026-08-08)

The one planned formal `trellis-check` reviewed and repaired the complete D59/D61 production diff. No second formal
check is required for documentation-only closeout.

- `pnpm -r test`: 238 files / 1,793 tests passed (Shared 217, CLI 32, Desktop 353, Core 1,191).
- Desktop and full-workspace typecheck: passed.
- Root `pnpm lint`: passed.
- Desktop production build: passed.
- Real Core boot smoke: passed; observed `ws server listening`.
- `git diff --check`: passed.
- Production header/index/size audit: passed.
- Check repairs covered Home action readiness, reconnect timeline reconciliation, last-good timing across Home client
  generations, Pet bubble reconnect draft gating, stale perception errors, exact-once `media.clear`, and function caps.
- Pet bubble submission is readiness-gated and a stale closed client fails fast. The unproven event-loop edge where a
  socket closes immediately before React publishes `reconnecting` is assigned to manual check 99; it is not recorded as
  a confirmed defect unless the owner observes draft loss or a wedged turn.
- Remaining evidence is strictly manual: real three-window Core stop/start, Pet transparency, packaged Tauri path ACL,
  long-idle/sleep-resume behavior, and D59/D61 reruns of #74/#75.

## Automated Acceptance Criteria

- [x] Pet, shared home, and chat each create generation N+1 after generation N closes, without webview reload.
- [x] Retry delay follows the approved full-jitter/cap policy and disposal prevents every future attempt.
- [x] Open/handshake completion from a stale generation cannot publish status or client.
- [x] Close before open, pending ordinary RPCs, and an active D29 turn each settle exactly once.
- [x] A non-answering request rejects at its native JSON-RPC deadline, removes its pending entry, and ignores a late
      response without affecting a concurrent request.
- [x] Authentication precedes restoration; avatar, timeline, and config subscribe once per successful generation.
- [x] Pet avatar report/subscribe failure is observable and prevents a falsely healthy restored state.
- [x] After a simulated pet close/reconnect, a known remote expression and motion each reach the current scene once;
      local reactions remain independent and old-generation frames are ignored.
- [x] Timeline restoration retains handlers -> subscribe -> history ordering and never resumes a partial stream.
- [x] Reads revalidate against the replacement client; mutations and chat sends are never replayed.
- [x] Connected hides the status; reconnecting/pairing/error states remain persistent and map consistently across pet,
      non-chat home, and chat.
- [x] Cached values and unsent chat draft remain visible while reconnecting; unavailable actions do not silently wedge.
- [x] Cancel/timeout in every pre-render costume stage prevents all later renderer/report side effects.
- [x] A renderer timeout invalidates its ticket; a late model self-discards and does not change scene, persistence, or
      home selection.
- [x] Cancel/deadline races emit one terminal pet result and release the single-flight guard once.
- [x] Post-attachment report failure follows the owner-selected truthful commit policy and cannot reproduce the current
      visible-new/identity-old contradiction.
- [x] Interrupted initial promotion can recover; committed promotion does not rerun on ordinary reconnect.
- [x] Existing chat, settings, avatar, timeline, config, costume, #74, and #75 regression tests remain green.

## Strictly Manual Acceptance

The operator-facing execution checklist is maintained as items 96–105 in `docs/devlog/manual-checks.md`; the numbered
criteria below remain the task-level source for what those checks must prove.

1. Open pet and home with chat active; stop Core. Confirm pet, the current non-chat home page, and chat show the status
   belonging to their own socket without reloading.
2. Restart Core. Confirm all three recover automatically and hide status only after authentication.
3. After recovery, verify one avatar command, one streamed/persisted chat, one timeline append, one config push, and
   current settings-page rereads. Each push appears once.
4. Verify both chat controls separately during the avatar scenario: home chat may remain healthy on its independent
   socket; the pet bubble must fail/settle during pet disconnection and work again after pet recovery.
5. Keep cached data visible through stop/start; confirm it stays visible during reconnect and refreshes afterward.
6. Re-run #74 and #75: real renderer timeout, no late attach/identity drift, one pending row, Cancel, retry, and correct
   `last-costume` across pet restart.
7. Exercise the pet's Tauri path composition in dev/packaged runtime because ACL failure is window-specific and not
   proven by TypeScript tests.
8. Keep the pet idle for the owner-observed duration, then invoke one known expression and motion. If it still fails
   while a pet-bubble turn succeeds, capture the ordered avatar-channel checkpoints before closing D59.
9. If practical, sleep/resume Windows while windows remain open. Record this as environment evidence, not as the sole
   proof of half-open handling.
10. Visually verify the pet status preserves root transparency, does not overlap controls incoherently, and creates no
   interactive dead region.

## Definition of Done

- Owner confirmed the configurable timing policy, complete requirements, and implementation plan on 2026-08-08.
  Decision Gate A is confirmed as option A.
- `implement.jsonl` and `check.jsonl` contain curated specs and all four research artifacts.
- Trellis implement -> one proportional check -> update-spec is completed with honest test evidence.
- Automated acceptance is green; manual-only items are marked passed only from owner-observed evidence.
- D59 and D61 become DONE only with task/commit evidence; HANDOFF describes the resulting lifecycle and remaining
  passive-half-open/T4 boundary.

## Decision Record (ADR-lite)

**Context:** physical reconnect libraries do not own TakiAgent authentication, logical JSON-RPC generations,
subscription restoration, D29, method deadlines, or costume commit truth. The installed JSON-RPC package already owns
the only required per-request cleanup primitive.

**Decision:** use current dependencies, add a small framework-free connection-generation manager, use the installed
native timeout requester, restore by fresh authenticated client identity, and use renderer attachment as the
worn-costume commit boundary. The owner approved the costume boundary on 2026-08-07 and the complete configurable
development timing profile on 2026-08-08. Final product defaults still depend on runtime evidence.

**Consequences:** no new dependency or offline queue; three sockets remain independent; the application owns explicit
generation/restoration policy; mutations can have timeout-unknown outcomes and require reread; passive half-open
detection without traffic remains outside this task. The first configurable development profile is approved, while
final defaults remain pending runtime evidence.

## Out of Scope

- Resuming/replaying a partially streamed model response or automatically resending any operator mutation.
- Offline request queues, buffered frames, durable reconnect state, or connection authority in `localStorage`.
- Application heartbeat/passive half-open detection (T4), scheduler/proactivity work, or server ping protocol changes.
- Periodic avatar resubscription or a Live2D engine workaround without evidence that authenticated generation restore
  and vocabulary synchronization failed to solve the reported symptom.
- Rust node-to-Core transport changes, legacy `main` status/pairing consolidation (D62), or shared cross-window sockets.
- Renderer prepare/rollback transaction work unless owner explicitly selects Decision Gate A option B.
- New SWR cache keys, perception/chat persistence, broad page-state redesign, or unrelated settings fixes.
- New reconnect, state, or cancellation dependencies.

## Primary Code Anchors

- `apps/desktop/src/lib/ws-transport.ts`
- `apps/desktop/src/lib/ws-client.ts`
- `apps/desktop/src/lib/ws-client-routes.ts`
- `apps/desktop/src/lib/ws-client-methods.ts`
- `apps/desktop/src/windows/pet/use-core-connection.ts`
- `apps/desktop/src/windows/home/use-home-connection.ts`
- `apps/desktop/src/windows/home/pages/chat/use-chat-connection.ts`
- `apps/desktop/src/lib/connection-generation-controller.ts`
- `apps/desktop/src/lib/rpc-deadline.ts`
- `apps/desktop/src/lib/timing-policy.ts`
- `apps/desktop/src/lib/costume-switch-attempt.ts`
- `apps/desktop/src/lib/costume-report-sync.ts`
- `apps/desktop/src/features/character-import/use-costume-switch.ts`
- `apps/desktop/src/windows/pet/use-initial-costume.ts`
- `apps/desktop/src/renderer/pet-scene.ts`

## Source Grounding Caveats

- Research is a static audit of the 2026-08-07 working tree plus installed package source and one direct package probe.
- Candidate reconnect packages were not installed or executed in TakiAgent; they are comparisons, not compatibility
  claims.
- Real Core stop/start, packaged WebView2 behavior, Windows sleep/resume, and hung Tauri IPC remain manual evidence.
- Timing values and the post-attachment product contract are decisions. They are deliberately not presented as facts.

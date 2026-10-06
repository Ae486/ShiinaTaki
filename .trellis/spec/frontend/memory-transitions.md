# Home Memory Transitions

W7 extends Operations with repeated healthy return/reentry and a separately selected offline emergency action.
Initial Local onboarding and first Hindsight activation remain distinct. The surface is mounted under Local,
Hindsight and committed-but-unavailable runtime states.

## Authority and read model

- `memory.transitions.overview` is operator-only and returns current authority, three closed preview actions and
  up to 50 original transition operations, active first. `hasOlder` discloses the history bound.
- Actions come from Core. Its marker/epoch/receipt identity projection opens a preview; it does not certify a
  complete candidate or authorize COMMIT. Preview/admission/publication retain independent complete proofs.
- Recovery uses original transition identity, current selection, quarantine/foreign isolation, original/executor
  terminal state, lease expiry, configuration and exclusive-family checks. Cancellation uses the actual
  `transitionStorage.canCancel` predicate plus the operation's admitted state. Never derive these gates in React.
- A terminal unknown operation with a nonterminal selected transition obligation still blocks a fresh healthy
  transition (and a fresh emergency if the old obligation is already emergency). Only explicit original recovery
  continues it; an eligible emergency may still quarantine an old healthy Hindsight obligation.
- Emergency may quarantine eligible old Hindsight operations; unrelated exclusive work still blocks it. The
  read model and actual quarantine share the same pure operation eligibility predicate.
- Historical target retirement is distinct from current runtime failure. Display commit, runtime availability,
  Native proof/release and queued intent results separately. Settled intentions include refusal/conflict outcomes.
- Wrong-provider copy distinguishes an already selected target from an uninitialized authority; missing baseline
  alone is not evidence to direct an initialized authority through first activation. Context only refines wording,
  never permission. Native progress uses exhaustive Chinese labels for the closed shared phases.
- Emergency never waits for Native release. Show original sealed disclosure (or original admitted preview before
  sealing), nullable backup age/coordinates, paired surviving evidence and explicitly unknown remote loss.

## Confirmation and transport

- A selected normal preview has one confirmation for the entire healthy transition. Emergency uses a separate
  preview and explicit `emergency-takeover` confirmation. Never automatically select it after healthy failure.
- Version 2 refused emergency previews retain readable disclosure and `expected:null`; no request may be made.
- One preview owns one request identity, consumed synchronously before awaiting submission. Double activation,
  reconnect, remount, stale callback and observer replacement cannot submit that confirmation again.
- Reuse `memory-operations-controller` for subscription-before-read, coalesced invalidation pushes, serialized
  mutations, last-good snapshots, retired generations and refetch after every mutation outcome. No polling.
- Preview selection/client changes invalidate pending preview replies. Inline confirmation focuses cancellation;
  Escape dismisses and restores the opener. Preview entry controls stay enabled during a read so focus is not
  lost before the confirmation mounts, and changing the selection can retire an old read.
- `memory.transitions.preview/status/overview` use bounded `longRpcMs` read deadlines. Only transition requests
  on generic `memory.operations.submit` use that long mutation deadline; other operation policies are preserved.
  Use `json-rpc-2.0` native timeout cleanup. Timeout/closed submit results are unknown and never auto-replayed.
- Production defaults remain 120 seconds for long RPCs. Real W6 recovery preview was 90.868 seconds; bind and
  queue settlement were 178.172 and 256.554 seconds. These are not exact submit ACK durations. The bounded deadline
  does not promise timely admission at that corpus size. Authority leases are unchanged.

## Verification

Cover Core permissions and safe refusals, shared refused-preview schemas, one-request confirmation, read failure,
expired/stale preview, late retired responses, last-good frames and unchanged onboarding/activation/backup controls.
Actual authenticated WS and browser tests must use production W5/W6 operation/runtime/publication services on
new synthetic fixtures. Native transport in those fixtures is explicit deterministic evidence, not live Native
acceptance. Count requests and compare original operation IDs across lost ACK/close/second observer/reconnect.
Browser tests use installed Playwright/Chromium, real timers and isolated contexts. Their pinned synthetic
wall-clock matches fixture identities. Browser/Vite evidence is separate from packaged WebView2/CSP and owner AC.
Keep a running producer behind an explicit fixture release until the second observer has read it and the initiator
has closed. A fixed sleep alone cannot prove this ordering on a loaded machine. Always release during teardown.

The framework-free `createMemoryTransitionsController` closure has an exact-path 60-line lint allowance: it owns
one disposable client/preview lifetime around the existing generic controller, not a second operation ledger.

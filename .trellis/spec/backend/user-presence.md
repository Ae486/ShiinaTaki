# User Presence and Message Presentation

## 1. Scope / Trigger

Use this contract when changing authenticated operator Presence, committed Timeline presentation, or Class B
invitation feedback. `presence/` owns evidence and durable dispositions; it does not own Host availability,
Wake Policy, model admission, hard delivery budgets, or a claim that a human read a message.

Sources: [C2 design](../../tasks/09-11-initiative-presence-feedback/design.md),
[presence research](../../tasks/09-11-companion-initiative-implementation/research/presence-contracts.md),
and [Initiative Runtime and Delivery](./initiative-runtime.md).

## 2. Signatures

- Shared `PresenceReportParamsSchema`: `sourceId`, monotonic `sequence`, `observedAgeMs`,
  `surface: home | chat | pet | phone`, `state: active | retired`, visibility/focus booleans,
  nullable `lastInput: { sequence, kind: pointer | keyboard | touch, ageMs }`, and the optional C3
  `inputContinuity: tracked | suspended` producer evidence (missing means suspended).
- Shared `TimelinePresentationReportParamsSchema`: the same source/sequence/age binding plus
  ordinary `characterId`, `timelineSeq`, and `exposed`. There is no client-supplied device identity or wall clock.
- `createPresenceService({ db, connections, feedback, now?, nativeEvidence?, onSourceChanged? })` exposes
  `reportPresence`, `reportPresentation`, `snapshot`, `recentReturn`, `sweep`, `retireConnection`, `observeUserTurn`, and `close`.
- `createInitiativeFeedbackRepo({ db, now?, commitFact, publishFacts? })` owns
  `syncPublished`, `present`, `observeInterval`, `engage`, `settleDue`, `get`, and bounded `list`.
- Additive migration 051 stores `delivery_presentations` and `initiative_feedback`; existing delivery/Timeline
  foreign keys remain authoritative. Live sources, leases and exposures are process-local only.

## 3. Contracts

### Source authority and intervals

One source binds to one registered authenticated operator connection and its exact authentication state object.
Identity comes from that object. Re-authentication, role changes, removal, explicit retirement or service close
cannot inherit the old source's evidence. Home/Chat/Pet have independent sources even on the same operator device.
Do not infer association between a Node/Host ID and an operator device ID.

Bootstrap requires sequence 1, active state and null input. A reconnect cannot replay cached input as new.
Presence and exposure share the source's monotonically increasing report sequence and rate bucket. Core derives
observation time from receipt minus bounded elapsed age; old observation time and sequence regressions refuse.
Renewal retains the original input instant, and a repeated input sequence cannot reduce its elapsed age.
Client age is measured before network transit, so its increase need not equal Core receipt-time elapsed duration.
Same-input renewals validate nondecreasing age and the same input kind without advancing the stored input instant;
even a frozen age cannot extend its original freshness deadline. Distinct input sequences may reconstruct the same
millisecond instant (the Desktop coalescer can produce this); equality preserves the deadline, while an older instant refuses.

Presence and exposure are separate. Focus or visibility alone never establishes presence. A valid accepted
nullable native idle observation can inform qualified global presence, but cannot prove which operator display
is attended. Overall state is `present | unknown`; native covered inactivity is not global absence.

Direct-input intervals start at receipt, never at a retrospectively claimed input instant. Their end is bounded
by both input freshness and source lease. A null-input update or known source removal clips the existing interval.
An unobserved authentication change discards the old source's unconfirmed history because its end time is unknown.

An exposure report may reference only nonblank ordinary committed assistant content belonging to the Character.
JavaScript whitespace validation is required; SQLite `trim()` alone accepts newline/tab-only content. A hidden
report only ends existing exposure; it never emits `delivery.presented`. The client supplies actual rendered-text
evidence after its visibility threshold, not a store update, Skeleton, private delta, transport receipt or ACK.
Once a source hide/retirement or known message end passes the authentication/sequence/observation checks, its live
exposure is cleared before durable synchronization, settlement or interval confirmation. A later SQLite failure remains
an explicit operation failure, but cannot preserve old live exposure or allow a later show to bridge the hidden gap.

Each accepted exposure starts at Core receipt. A timely subsequent report confirms only the old interval through
the new observation time; transport-delay gaps remain gaps. An expired exposure or source is never backfilled.
Timer sweeps retire/settle state but cannot confirm that text stayed visible. Same-device fresh input intersects
confirmed exposure; intervals union across sources/devices so concurrent displays do not multiply duration.

### C3 source-local return evidence

`recentReturn()` is independent from aggregate presence and per-message opportunity. It returns a defensive copy
of a genuine new-input occurrence only after one authenticated source has maintained explicit old-input sequence,
kind and nondecreasing age under uninterrupted leases. A real initial input anchors the chain. The first explicit
old-input report at or beyond the 60-second freshness boundary starts a receipt-forward known-inactivity interval.
At least ten minutes of that interval plus a genuinely newer, fresh input are required. Renewal, null, visibility,
focus, socket uptime, bootstrap and unknown gaps alone never produce a return. This is source-local inactivity,
not proof of global user absence or native hardware-only input.

The optional `inputContinuity` field is a compatibility exemption: C2 clients may omit it and retain all existing
presence/exposure behavior, but cannot establish C3 return continuity. `tracked` asserts actual trusted-input
listeners remained attached. The updated Desktop producer explicitly sends `suspended` on true hidden/minimized,
blur, route detach or listener teardown. Routine native refresh still withdraws display evidence, while independently
attached input listeners may remain tracked and capture real input during the query. Null or omitted continuity
breaks the return chain; it never fills inactivity. Expired leases, authentication/source replacement and retirement
also break the chain. A cached input repeated after such a gap cannot re-anchor it.

Return facts preserve their first event identity/input time across renewals and further activity. They expire after
60 seconds and disappear immediately on source retirement. `onSourceChanged` is an optional data-free, observer-isolated
notification of a changed return/availability fact; it does not dispatch work. Pattern matching and Wake Policy remain
the only admission path. C2 presence still expires at 60 seconds regardless of the retained old input age, and its
exposure/feedback intervals retain their existing negative-transition, same-device and no-backfill rules.

### Durable feedback and accounting

Only a charged, published Class B `speak` decision with `responseExpectation: invitation` creates a pending feedback
observation. Class A, non-invitations, held/expired speech, silence and expression-only outcomes do not create it.
Presentation uses the original delivery/Run/Attempt/Timeline identity and is emitted once. Ordinary presentations
without an eligible feedback record omit `opportunityMs`; absent measurement must not become zero.

The interval union and derived capped duration update in one SQLite transaction. Settlement and its required
RunEvent commit together; post-commit observers cannot roll either back. One feedback row settles at most once.
At the deadline, qualifying accumulated overlap may produce `weak_non_engagement`; insufficient/unknown time
produces `unknown`. A qualifying duration before the deadline cannot settle weak feedback early.

Engagement requires an actual persisted `user` Timeline row with the same Character, a greater Timeline sequence,
and `publishedAt <= createdAt < deadlineAt`. A callback alone proves nothing. The sequence distinguishes an old
row from a later row sharing the exact publication millisecond. Sweeps query those persisted rows to recover a
missed callback after restart. Later historical presentation or post-deadline user input never reopens settlement.
Durable observed history survives restart; no live lease or outage duration does.

### Engineering defaults and bounds

These are explicit implementation/calibration defaults, **not owner-ratified feature-enablement values**:

| Limit | Current value |
| --- | --- |
| Direct-input freshness / known native freshness | 60 seconds |
| Source/exposure lease / routine client renewal | 30 seconds / 15 seconds |
| Known native idle cutoff | 180 seconds |
| Qualified opportunity / feedback deadline | 120 seconds / 60 minutes from publication |
| Retained sources / active exposures per source | 128 / 64 |
| Disjoint intervals per source or feedback row | 128 |
| Shared report token bucket per source | Burst 128, refill 8 per second |
| Feedback sync/settlement batch / Character read | 100 rows / 100 rows |

Oversized and rate-limited positive observations refuse rather than widen limits. Valid negative lifecycle evidence
is exceptional: an existing exposure's end, a visible-to-hidden transition, or source retirement must close its own
evidence even when its token bucket is exhausted. Authentication, source, sequence and observation-age validation still
apply. A valid source hide/retirement drops attached input independently of whether that input is fresh or stale;
the positive input cannot veto closure or piggyback on it. Positive observations retain their normal input checks and
quota. Repeated hidden reports without an active transition do not receive the exception. Connection removal
remains immediate regardless of report rate. Source history is pruned after the bounded retention window. Feedback interval fragmentation beyond
the cap is ignored conservatively; reaching the qualification threshold stops further duration accrual. No timing
constant here can loosen the independent Heartbeat opportunity or Class B delivery budgets.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Unknown fields, content/device claims, unsafe sequences or invalid ages | `invalid-report` |
| Wrong role or unregistered/removed socket | `unauthorized` |
| Wrong source, changed authentication/surface, retired source, expired presentation lease | `stale-source` |
| Replayed report sequence / regressed observation / reset input age | `stale-sequence` / `stale-observation` / `stale-input` |
| Source, exposure or report bucket exhausted | `source-limit` / `exposure-limit` / `rate-limited` |
| Valid existing exposure end or source hide/retirement at empty bucket | Close own evidence; no attached positive input admitted |
| Valid source hide/retirement with stale attached input | Ignore attached input and close; do not relax source/report fencing |
| Wrong Character, absent/non-assistant/blank Timeline content | `unknown-message` |
| Hidden-only report | No presentation fact or opportunity interval |
| Missing native idle or unassociated device | Unknown; no fabricated response opportunity |
| Deadline reached without qualified evidence | One `unknown` disposition |
| Required fact/SQLite COMMIT fails | Roll back durable state and evidence; no live publication |
| Durable write fails after a validated hide/end | Preserve the already-closed live exposure; never roll it back open |
| Post-commit observer fails | Durable result retained |

## 5. Good / Base / Bad Cases

- Good: phone input establishes global presence while an unattended Desktop message contributes no overlap.
- Good: two windows display one invitation for the same 15 seconds; the durable union gains 15 seconds once.
- Base: a connected visible window renews without fresh input; its state remains unknown.
- Bad: infer input from reconnect/focus, use the currently connected Host as an old sample's source,
  count hidden/offline time, parse question marks as an invitation, or treat a callback as a persisted reply.

## 6. Tests Required

- Strict Shared rejection of identities/content, age/sequence bounds, reading acknowledgements and global absence.
- Real service tests for independent windows, phone/Host separation, re-authentication retirement, source/rate/exposure
  caps, null input, same-input aging, expired leases, hidden reports and whitespace-only Timeline content.
- Exhaust the source bucket, hide/retire, then show again before lease expiry: no interval may cross the hidden gap.
  Verify malformed/replayed/foreign-source reports still refuse and another source remains unaffected.
- Block feedback synchronization with a real SQLite trigger during message/surface hide, then retry after recovery:
  old exposure must already be closed, even while another same-device source still supplies fresh input.
- Clock-injected overlapping/disjoint/transport-delay intervals; no timer, disconnected or null-input backfill.
- Actual SQLite once-only facts, required-fact rollback, interval/total atomicity, fragmentation bounds and row parsing.
- Same-millisecond sequence ordering, callback without a row, other Characters, exact deadline and historical views.
- File-backed reopen preserving observed duration, recovering missed user callbacks and producing no outage evidence.
- Fresh/recorded-049/recorded-050 migration paths, preserved old receipts/data and rollback on receipt or COMMIT failure.
- Integration owners additionally verify authenticated server methods, Monitor replay and real native Chat/Pet rendering.
  Unit tests do not satisfy the native visibility, occlusion, reading-position or owner acceptance criteria.

## 7. Wrong vs Correct

```ts
// Wrong: callback occurrence is treated as proof of a user reply.
feedback.engage(characterId); // then unconditionally settle all pending rows

// Correct: callback and sweep use the same durable Timeline evidence query.
// WHERE role='user' AND character_id=:character AND seq>:deliverySeq
//   AND created_at>=:publishedAt AND created_at<:deadlineAt
service.observeUserTurn(characterId, committedUserRow.createdAt);
```

```ts
// Wrong: last report receipt substitutes for the real input instant.
inputAt = now();

// Correct: validate sequence/age and preserve the instant on same-input renewals.
if (input.sequence > source.inputSequence) inputAt = now() - report.observedAgeMs - input.ageMs;
```

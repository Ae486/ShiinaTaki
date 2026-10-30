# Finite source-bound Intentions

## Ownership and source authority

- `initiative/intentions/` owns one-shot automatic follow-up plans. Migration 054 adds domain state to Core SQLite;
  execution remains in the existing Run/Attempt/Delivery owners. It does not add a Scheduled Task, Memory writer,
  second admission queue, expired-thought inbox or extraction model.
- `plan_follow_up` is exposed only to an actual primary turn. The Core captures the appended user Timeline row and
  active Run/Attempt; model arguments contain only purpose, `notBefore`, `expiresAt`, and nullable `reportedEventTime`.
  It reuses the immutable C3 primary-source witness rather than querying arbitrary recent history.
- Source currentness compares the exact existing C3 SQL-row `patternDigest`. The Memory adapter receives
  `{characterId, userTimelineId, userTimelineSeq, sourceDigest}`. This digest is not `primaryEntryDigest` from ingestion.
  `unavailable` prevents admission/output while preserving the original finite window; `withdrawn` closes the plan
  when the owning lifecycle service observes it. A new authority or unavailable provider cannot promote source truth.
- One source-opportunity key hashes Character plus actual Timeline identity/sequence independently of generated
  wording, tool call, Attempt and proposed times. An existing terminal key cannot be renewed by source replay.

## Finite windows and factual time

- The default maximum active window is seven days for `expiresAt - notBefore`, configurable through the service's
  `maximumWindowMs` dependency wired to `TAKI_INITIATIVE_INTENTION_MAX_WINDOW_MS`. The positive-safe-integer setting
  applies to newly formed plans; changing it never rewrites an existing window. It is not a maximum future scheduling horizon. Explicit reminders retain Scheduled
  semantics; an automatic plan is never silently converted to a Scheduled Task.
- Window start is inclusive and expiry is exclusive. Formation rejects expired, malformed, empty and oversized
  windows and normalizes window timestamps to UTC. Due/admission/currentness checks enforce the exact original
  expiry without depending on a sweeper.
- A non-null reported event time must literally occur in the actual user message's visible text. Vague/relative
  timing remains null. A follow-up time is a plan; it never proves an event or outcome.
- Source correction/deletion and expiry remove prospective purpose/event-time content from the terminal plan,
  retaining source identity, deadline, linkage and disposition for deduplication. They do not resolve, delete or
  copy the underlying matter in Memory or Timeline.

## Claims, recovery and delivery

- `listDue` returns at most 100 active valid plans with actual bounded purpose and source identity. Claimed plans
  leave that list but remain current for their own exact canonical Run key through held non-silent delivery.
- `nextWakeAt(characterId)` is a read-only paged query for the earliest `max(now, notBefore)` among active unexpired
  plans with an intact primary row and no proven source withdrawal. Temporarily unavailable Memory witnesses remain
  schedulable for a bounded availability recheck, while `listDue` and admission still require current evidence.
  It acquires no sources, writes no state and owns no timer. The common WakeEngine owns finite reevaluation,
  including future due times when periodic wakes are disabled; no outage renews the original deadline.
- Claim is a single SQLite state transition. Link/recovery accepts only an existing heartbeat Run with the exact
  Character and idempotency key. An admission-before-link crash repairs that linkage without creating a Run.
- `releaseUnadmitted` restores active state only while no canonical Run with the claimed key exists. The original
  times remain immutable. A lost unlinked claim on restart closes as unknown; it is not replayed.
- Canonical terminal Run state settles failures/cancellation/unknown. Completed silence consumes the opportunity.
  Completed expression consumes once its executable continuation is completed, even though its non-text delivery
  row remains staged and has no Timeline publication transition.
  Completed non-silent staged/held output keeps the claim/currentness fence until publication settles or the source
  expires/withdraws. The Run and Delivery owning writers remain the source of execution/publication events.
- A live `delivery.dispatch_committed` event is an intermediate publication boundary, not a terminal transport
  result. Keep the original claim while the existing sender awaits its result; `sent` consumes speech and `unknown`
  retains actual uncertainty. On restart, an unresolved dispatch commitment closes as unknown without replay,
  reopening the opportunity or refunding its committed charge. Test the post-commit live callback sequence, not only
  a final delivery row read after all transitions have completed.
- Database constraints reject active linked state, foreign source/heartbeat Runs, source/deadline mutation and
  terminal rearming. Service changes commit in short synchronous transactions; bounded data-free invalidation
  follows commit and observer failure cannot undo durable state.
- Source witnesses and plan identities are capped at 10,000 per Character; reads page through at most 1,000 open
  rows at a time. Capacity refusal preserves old tombstones rather than evicting replay protection.

## Verification anchors

- Shared Intention schema tests cover strict required-nullable inputs, finite time, scoped canonical claims and
  removal of prospective content from terminal records.
- Intention service tests use real SQLite and canonical Run/Delivery repositories for future/exact boundaries,
  source replay/retry/correction/deletion, provider availability, rollback/observer isolation, canonical-key mismatch,
  claim release, claimed currentness and file reopen/reconciliation.
- Tool tests exercise the installed AI SDK object-root JSON schema, actual primary source, readable results,
  stale/aborted/invalid sources and contained persistence failures.
- Migration tests upgrade a populated recorded-053 database, compare original schema/receipts/Timeline, reopen 054,
  and verify additive schema rollback when its receipt fails.
- Complete Wake/Memory/Monitor/process/native behavior and owner acceptance require their independent integration
  evidence; passing these domain tests does not establish those outcomes.

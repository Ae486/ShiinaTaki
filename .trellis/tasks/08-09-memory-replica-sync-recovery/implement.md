# Memory Replica Synchronization and Recovery - Execution Plan

## Current checkpoint

- Task remains `in_progress`. Waves 0-2 are implemented and independently reviewed offline; code, specs, and planning
  artifacts are committed as `69ca779` on `main`.
- The owner approved the next Wave 3 plan, with organization, commit, and stage-record archival first. Wave 3 has not
  started at this checkpoint. Real provider calls, existing-user-data migration, and authority activation remain gated.
- Keep one direct `gpt-6-astra / high` implementation agent followed by one `gpt-6-astra / xhigh` check agent. No recursive
  delegation. Leader waits use explicit 30-minute intervals.
- Keep the active authority unchanged. Use isolated SQLite fixtures and injected transports; preserve B2 evidence and
  the protected legacy backup. Pending recovery is explicit orchestration, never generic blind Effect replay.

## Completed waves

| Wave | Delivered scope | State |
| --- | --- | --- |
| 0 | Canonical pending/completed/superseded result receipts and governed error classification | Independently checked offline |
| 1 | Complete journal transactions, fenced replica/FTS/checkpoint publication, trusted full-record projection and reopen | Independently checked offline |
| 2 | All-Bank scheduler, manual/automatic retry, snapshot reset, verified selective reconciliation and truthful status | Independent pass with five fixes |

The final Wave 2 check passed Shared 378, Core 1950, CLI 47, and Desktop 548 tests, all five TS typechecks, root lint
(one existing warning), task/file audits, and isolated Core startup through migrations 1..34. Startup evidence does not
claim graceful shutdown, Rust/Host gates, a real Hindsight service, or live activation. The five review repairs cover
supervisor wake storms, cache witness binding, malformed FTS cleanup, transaction deadlines, and admitted Bank binding.

## Evidence index

The following record is the complete, unabridged `implement.md` from commit `69ca779`. It is historical evidence and
must not receive later progress entries. Read it when a previous proof or residual needs investigation; routine context
loads use this compact plan and the executable spec.

| Evidence | Location |
| --- | --- |
| Full Waves 0-2 plan, implementation and independent checks | [Archived execution record](research/waves-0-2-execution-record-2026-09-06.md) |
| Wave 0/1 independent check | [Review](research/waves-0-2-execution-record-2026-09-06.md#independent-wave-01-check-2026-09-06) |
| Wave 2 implementation | [Recovery evidence](research/waves-0-2-execution-record-2026-09-06.md#wave-2-recovery-evidence-2026-09-06) |
| Wave 2 independent check | [Review](research/waves-0-2-execution-record-2026-09-06.md#independent-wave-2-review-2026-09-06) |
| Executable contracts | [Memory Replica Sync](../../spec/backend/memory-replica-sync.md) |
| Historical runtime reconnaissance | [2026-09-05 baseline](research/runtime-baseline-2026-09-05.md) |

Cold, corrupt, or journal-updated records without current provider-page evidence require downloads; verified unchanged
record pages can be reused after reopen. Preserve the 512 KiB response/manifest cap, complete 10,000-record journal-page
cap, 60-second execution default and 61-second lease default. Unknown telemetry remains null. No live policy/provenance
binding may be fabricated to bypass B4/B6 readiness.

## Wave 3 - Pending and recovery

**Ownership:** durable Pending Memory repository, explicitly unconfirmed overlay projection, ordered recovery
coordinator, expected-revision replay, derived-completion wait, second pull, and superseded diagnostics.

**Implementation order:**

1. Persist idempotent write intents with Bank/operation identity, safe payload, original timestamp, expected target
   revision where applicable, retry state, and bounded terminal diagnostics.
2. Keep confirmed replica rows separate from the optional unconfirmed overlay, including across restart.
3. Authenticate and verify provider/Bank lineage; pull and apply remote changes; replay eligible retains and mutations;
   await derived completion; pull the resulting changes again.
4. Mark stale or missing mutation targets `superseded` without forced overwrite, merging, or blocking independent rows.
5. Verify shutdown/restart, interruption, duplicate delivery, partial Bank failure, supersession, and recovery ordering.
   Keep Authority unchanged and preserve the prior verified replica on failure.

**Proof:** outage writes survive restart; confirmed/unconfirmed states never merge silently; compatible operations
converge in order; retries are idempotent; one bad row cannot block the remainder. Read `design.md` and the curated
manifests before editing, and recheck the live migration registry before assigning the next version.

## Wave 4 - Full B5 quality gate and activation handoff

Run meaningful focused tests, full TS package tests/typechecks, root lint with protected-backup exclusion, task/context
validation, staged and unstaged whitespace checks, and isolated Core startup when migrations/imports change. Run any
additional affected-layer gates; record unrun platform/manual checks accurately. Update executable specs after check.

Remaining live prerequisites are B4 current-Local coverage and final fence, accepted provider compatibility/derived
completion, trusted policy/provenance bindings, B6 runtime provider wiring, and owner-approved real activation. No B5
completion or manual acceptance is implied by the Waves 0-2 checkpoint. Keep later wave evidence in linked research
records so this execution plan stays below the 32 KiB context limit.

# Memory Replica Synchronization and Recovery - Execution Plan

## Current checkpoint

- Task remains `in_progress`. Waves 0-2 are implemented and independently reviewed offline; code, specs, and planning
  artifacts are committed as `69ca779` on `main`.
- The owner approved Wave 3 execution on 2026-09-06 after the Waves 0-2 organization, commit, and stage-record archival
  checkpoint (`c3f8bc4`). Wave 3's implemented offline mechanics passed independent review on 2026-09-07 after three
  fixes; the changes remain uncommitted. That historical baseline implemented the older derived-wait rule. G1 now
  completes the accepted factual-write rule and safe native-result/append recovery, with independent review and
  final native 69 / Shared 396 / Core 2036 passing. The approved actual-source Rust build and four generated-model
  contracts pass as well. Real provider calls, existing-user-data migration, and authority activation remain gated.
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

The Waves 0-2 archive is the complete, unabridged `implement.md` from commit `69ca779`. It is historical evidence and
must not receive later progress entries. Stage-specific reports preserve later implementation and review evidence;
routine context loads use this compact plan and the executable spec.

| Evidence | Location |
| --- | --- |
| Full Waves 0-2 plan, implementation and independent checks | [Archived execution record](research/waves-0-2-execution-record-2026-09-06.md) |
| Wave 0/1 independent check | [Review](research/waves-0-2-execution-record-2026-09-06.md#independent-wave-01-check-2026-09-06) |
| Wave 2 implementation | [Recovery evidence](research/waves-0-2-execution-record-2026-09-06.md#wave-2-recovery-evidence-2026-09-06) |
| Wave 2 independent check | [Review](research/waves-0-2-execution-record-2026-09-06.md#independent-wave-2-review-2026-09-06) |
| Wave 3 offline implementation and provider limits | [Implementation](research/wave-3-implementation-2026-09-06.md) |
| Wave 3 independent review, three fixes and final gates | [Review](research/wave-3-review-2026-09-07.md) |
| Completed G1 native-result/append amendment and actual provider/SQLite/SDK evidence | [Validation](../09-07-hindsight-recovery-evidence/research/g1-validation-results.md), [independent review](../09-07-hindsight-recovery-evidence/research/g1-independent-review.md) |
| Executable contracts | [Memory Replica Sync](../../spec/backend/memory-replica-sync.md) |
| Historical runtime reconnaissance | [2026-09-05 baseline](research/runtime-baseline-2026-09-05.md) |

Cold, corrupt, or journal-updated records without current provider-page evidence require downloads; verified unchanged
record pages can be reused after reopen. Preserve the 512 KiB response/manifest cap, complete 10,000-record journal-page
cap, 60-second execution default and 61-second lease default. Unknown telemetry remains null. No live policy/provenance
binding may be fabricated to bypass B4/B6 readiness.

## Wave 3 - Pending and recovery

**Status (2026-09-07):** the implemented offline mechanics passed `hindsight_b5_wave3_check` after three fixes and
14 review regressions. Final review covers 38 source/test/index files and passed Shared 392, Core 2016, CLI 47,
Desktop 548, all five TS typechecks, root lint (one existing warning), source/context audits, and isolated native Core
startup through migrations 1..35 with zero provider requests. Owned resources were cleaned; graceful Windows shutdown,
Rust/Host, live provider and manual acceptance were not claimed by that historical checkpoint. G1 subsequently
closed the routine native-result/append implementation gaps; runtime integration and live acceptance remain separate.

The fixes put Authority/current Bank-scope checks inside journal and snapshot publication transactions, continue
same-lease Pending stages after reset without repeated native work, and preserve unknown outcomes after generation
replacement of a dispatched write. Exact RED/GREEN evidence and final commands are in the linked review report.

**Reviewed baseline:** native retain completion and conditional-mutation receipts do not prove operation-scoped
derived completion. The existing implementation therefore stays `awaiting_derived` when that evidence is unavailable
and preserves successful receipts. Injected completion tests prove that older ordering, not a live producer contract.

**Completed G1 amendment:** routine writes now confirm after native-result proof and local factual application,
with derived work continuing independently. The implementation negotiates the versioned contract, freezes dispatch,
verifies exact paged native results and uses the actual second-pull SQLite checkpoint. Existing rows preserve their
old protocol; no blanket awaiting-derived promotion was added. Safe append, restart, zero-result, pruning and
independent-row progress regressions pass. Authority cutover retains its independent stronger completeness gate.

The owner authorized [Hindsight recovery evidence and append mapping](../09-07-hindsight-recovery-evidence/prd.md)
on 2026-09-07, requiring sufficient modification reasons, a clear minimal direction and upgrade-oriented patch records.
That child's implementation and offline validation are complete. `H:/hindsight/TAKI_PATCHES.md` is its live provider-maintenance ledger;
historical compatibility and B5 evidence remain preserved. This authorization does not open live activation gates.
The later [confirmed direction](../09-07-hindsight-recovery-evidence/grill.md) prioritizes native API/extension reuse
and aligned Local/Hindsight logical data. G1 now explicitly revises the routine derived wait; the older strict
provider proposal is not the selected routine design. The child indexes prior grill rulings to avoid repeat questions.

**Append compatibility:** the older path refuses append without a trustworthy historical result. Negotiated G1
now freezes the native append plan and proves the complete resulting document/fact mapping under concurrency and
restart. Lost acknowledgements reuse the original identity without appending twice. Legacy/unsupported paths retain
their honest refusal and diagnostics; append is never silently reinterpreted as replace.

**Ownership:** durable Pending Memory repository, explicitly unconfirmed overlay projection, ordered recovery
coordinator, expected-revision replay, native-result evidence, second-pull confirmation, separate derived freshness,
and superseded diagnostics.

**Implementation order:**

1. Persist idempotent write intents with Bank/operation identity, safe payload, original timestamp, expected target
   revision where applicable, retry state, and bounded terminal diagnostics.
2. Keep confirmed replica rows separate from the optional unconfirmed overlay, including across restart.
3. Authenticate and verify provider/Bank lineage; pull and apply remote changes; replay eligible retains and mutations;
   verify native results and pull/apply factual effects before confirmation. Synchronize later derived writes normally.
4. Mark stale or missing mutation targets `superseded` without forced overwrite, merging, or blocking independent rows.
5. Verify shutdown/restart, interruption, duplicate delivery, partial Bank failure, supersession, and recovery ordering.
   Keep Authority unchanged and preserve the prior verified replica on failure.

**Completed offline end-to-end proof:** outage writes survive restart; confirmed/unconfirmed states stay
separate; supported writes confirm with real native-result/checkpoint evidence even when derived work is unfinished;
retries preserve identity, unknown native outcomes remain unresolved, and one bad row cannot block independent rows.
G1's actual PostgreSQL HTTP -> typed Core -> file-backed SQLite fixture proves this routine contract, including
lost-ACK append, failed second pull, reopen and mutation. Its explicit source/policy/provenance bindings do not
implement B4/B6 product adapters or establish live/model quality. Read the G1 validation report for the exact limits.

## Wave 4 - Full B5 quality gate and activation handoff

The reviewed routine code has passed its offline source, native/SQLite, TS and SDK gates, including the actual Rust
build. Full B5 integration/acceptance waits for the runtime and live prerequisites below; unchanged broad suites
need not be repeated during documentation-only work.

Run meaningful focused tests, full TS package tests/typechecks, root lint with protected-backup exclusion, task/context
validation, staged and unstaged whitespace checks, and isolated Core startup when migrations/imports change. Run any
additional affected-layer gates; record unrun platform/manual checks accurately. Update executable specs after check.

Remaining live prerequisites are B4 current-Local coverage and final fence, accepted provider compatibility/derived
completion, trusted policy/provenance bindings, B6 runtime provider wiring, and owner-approved real activation. No B5
completion or manual acceptance is implied by the Waves 0-2 checkpoint. Keep later wave evidence in linked research
records so this execution plan stays below the 32 KiB context limit.

# D78 First and Second Actual Runs — Retained Evidence

This record preserves the detailed first/second-run history and native correction gates. Both actual runs were stopped
and retained as failures; the [current validation report](d78-real-data-validation-2026-09-09.md) records the passing
third full-source run, final source/resource audits and remaining scope. The sections below retain their original
chronology and evidence rather than replacing earlier failures with the final result.

## First actual HTTP run: import passed, certificate refused

The native target used its ordinary Broker, MaintenanceLoop and WorkerPoller with the actual configured models.
B3 configured both Banks through its production service. Both exact requests had zero gaps:

| Bank | Documents | Units | Request bytes | Mapping records / pages |
| --- | ---: | ---: | ---: | ---: |
| Global | 160 | 160 | 340,586 | 321 / 3 |
| Character | 562 | 562 | 1,229,489 | 1,125 / 9 |

Global's response was deliberately lost only after the native import returned its committed result. Reopening the
same SQLite copy recovered that operation and all mapping pages without a second dispatch. The two Banks together
used exactly two transfer dispatches. Canonical/B2/source digests and the active Local epoch stayed unchanged.

Global verification prepared 157 source/scope requirements and one model, then returned `stale`, revision 3,
`candidate_changed`. Character preparation then returned `accepted_work_unresolved`. The runner exited 1 and released
its copy lock/lease. No certificate, raw replica or B4-ready result was fabricated.

Read-only native evidence identifies the exact competing write:

- Candidate cursor: 325. Forty-seven D78 action receipts cover journal cursors 326–347.
- Ordinary consolidation was accepted by the periodic scheduler at `2026-09-09T11:42:05Z` while D78 was awaiting models.
- The first unreceipted, non-bookkeeping change is cursor 348: an observation upsert at
  `2026-09-09T11:42:58.762664Z`. It belongs to batch `053491bb-5955-408e-8912-a7b73b9607e9`.
- The existing candidate guard correctly rejects that unknown derived change. Ordinary source-bookkeeping exceptions
  cannot explain it. Existing offline fixtures used synchronous tasks and disabled periodic reconciliation, so they
  did not exercise this normal-worker competition.

The strict candidate cannot be repaired merely by choosing another verification ID: the import-bound capture also
refuses subsequent unknown derived writes. The first target, all receipts and its journal remain intact. The owned
API/PG processes were stopped with exit 0, and the original frozen snapshot still has its initial SHA.

Provider observations for this retained first target (including startup/B3/D78 and ordinary background work): 120
attempts, 116 HTTP 200 responses; returned usage totals 921,315 prompt and 652,159 completion tokens, or 1,573,474 known
tokens. Four attempts have no returned usage; this is not a priced bill or a claim that their charge is zero.

Supporting runtime artifacts: `consumer-real-run-1.log`, `consumer-result.json`, `native-status-after-run-1.json`,
`native-unreceipted-journal-run-1.json`, `stopped-resource-audit.json` and `native-output-summary.json`.

## Correction and separate full-source rerun

The correction establishes a finite, durable, fenced maintenance owner per Bank in the same transaction as import.
Native calls renew valid admitted ownership while their finite work is active, including another imported Bank waiting
in the same Local manifest cohort. Ordinary scheduling/admission/worker/producer writes respect that owner without
changing auto-consolidation settings or forging completion. Expiry, explicit proven supersession and terminal release
fence old writes; retryable incomplete work retains a bounded recovery window. Strict accepted-work and drift guards
remain in force. Native patch `TAKI-HS-011` records the exact provider footprint and validation.

An ordinary Broker/MaintenanceLoop/WorkerPoller regression reproduced the failure before the repair. Its owned PG
fixture was stopped and cleaned by the existing resource guard; the real failed target was not changed.

A second private directory, `.trellis/.runtime/d78-real-data/cd01c5453b1e/`, contains a fresh byte-identical copy of the
original untouched snapshot, rather than edited contents from the failed target. Its actual 036–040 migration and
full preflight passed: 722 sources/722 units, 2 Banks, 2,893 witnesses, 1,449 Taki artifacts, 746 catch-up entries, zero
gaps and identical original digests. The runner explicitly allowlists the two independent run IDs; it does not reuse
or overwrite the first run's state. Fourteen TS and seven Python harness regressions now pass with strict TS/scoped lint.
The second target executed the real-model verification described below. It is now stopped and retained after a
consumer transport failure; its partial native success does not establish complete actual-data acceptance.

### Correction checks completed on 2026-09-10

The independent source review closed the capability, repeatable-read admission and maintenance-retry findings.
The final admission ordering also covers task submission, late file conversion, the owner-lock database clock,
and checking old-attempt fences before interpreting a newer attempt's candidate changes. This source review is
separate from the remaining complete regression gate and the actual-model rerun.

| Check | Result | Owned runtime evidence |
| --- | --- | --- |
| RR admission barrier before repair | Reproduced: prepare incorrectly accepted a newly committed pending task | `g1-validation/taki-hindsight-g1-9be7cac036db/pytest.log` |
| RR prepare/claim, lease expiry, late results, heartbeat cancellation and existing capability checks | 15 passed, 73.04 seconds | `g1-validation/taki-hindsight-g1-e2859a6f83c7/pytest.log` |
| Fresh/previous-head migration, exact old evidence preservation and resume, missing owner, actual incomplete schema, all operation-type/terminal/bank-move MVCC signals | 22 passed, 115.53 seconds | `g1-validation/taki-hindsight-g1-529b929a3f86/pytest.log` |
| Maintenance/non-maintenance retries, two-submit ordering, completion/outbox, late file conversion, owner-lock expiry and supersession fences | 13 passed, 53.61 seconds | `g1-validation/taki-hindsight-g1-1c481d53fccd/pytest.log` |
| First complete corrected native-results matrix | 176 passed / 4 failed, 501.91 seconds; not accepted | `g1-validation/taki-hindsight-g1-d8a3aa7f5130/pytest.log` |
| Final complete native-results matrix after the corrections | 186 passed, 471.82 seconds | `g1-validation/taki-hindsight-g1-e3c8c798e9cb/pytest.log` |
| Affected ordinary admission/worker/completion/consolidation/observation paths, backup inventory and migration shape | 252 passed / 102 conditional skips, 65.86 seconds | `g1-validation/taki-hindsight-g1-39643adf150a/pytest.log` |
| Canonical OpenAPI generation from the corrected production source | Passed; 665,488 bytes, SHA-256 unchanged at `cf999d5b9fd8bcdfe1b19ece108a6183a6a82c8545a574c1d0b87340b36e1419` | `g1-codegen/13c9fd53e27e/openapi.log` |

All runtime paths above are relative to `.trellis/.runtime/`. The 22-case migration fixture was stopped and its
owned PG data/registry removed. Its new test file passed scoped Ruff and `ty` with the actual `.venv` interpreter;
an initial direct `ty` invocation selected the unrelated system environment and could not resolve Alembic.
No public schema changed, so this correction does not require another SDK regeneration.

The full matrix found two cases of one compatibility regression: maintenance replacement recognized only prior
current-state receipts, rejecting an otherwise fully validated native-result supersession. The correction must retain
the complete baseline and every-object proof checks before replacing an owner. Two other failures came from old
two-arrival test barriers placed after the newly serialized owner lock; only those synchronization points are to move
before lock contention, preserving their original concurrency/replay assertions. The failed fixture was stopped and
cleaned. Subsequent corrected runs passed before the actual target was launched.

The affected ordinary-path run explicitly admitted three reviewed files and nine class-qualified worker methods.
The task harness rejects broader worker selectors before collection and checks the collected items again; an
unreviewed method was deliberately refused in `g1-validation/taki-hindsight-g1-b55a830b0b7e/`. Its 102 skips are
exclusively the migration-shape check for migrations without concurrent DDL, not skipped worker or ownership tests.
Both owned PG fixtures were stopped and cleaned.

The corrected targeted round then passed 26 cases but exposed one actual serialization conflict in the winning
same-revision attempt. Test-only traceback collection located the conflict in the initial repeatable-read input
transaction while its own native heartbeat updated the owner tuple. A deterministic real-renewal regression also
reproduced the analogous final-sealing conflict. The correction is limited to one retry of those short SQL stages,
with a new input view/certificate binding, full fence checks and explicit operational refusal after exhaustion.
Models and already committed actions remain outside the retry boundary. Generic logical snapshots are unchanged.

The final matrix has two websockets deprecation warnings. It also emitted an asyncpg `Connection._cancel` pending-task
diagnostic during the original HTTP-to-Taki consumer fixture's teardown, after engine/pool closure. The fixture's
PG process was stopped and its data/registry removed. This is recorded separately from its passed assertions and is
not claimed as graceful-shutdown acceptance or an established harmless baseline.

The required whole native hook ran in `d78-validation/maintenance-972ee5257f6c47659a08491d218a42f6/`, taking 19.08 seconds.
Its exit 1 is limited to the same 27 API and 3 embed Windows type diagnostics. Two `worker/poller.py` locations moved
from line 1547 to 1550; an exact unchanged-line mapping confirmed the same messages/types/columns, with zero new
diagnostics. Every other hook task passed. The audit restored its 185 automatic format changes to the frozen tested
bytes, verified 4,155 files, all 120 dependency manifests and the protected CLI hash, and removed only its verified
temporary directory. The source tree was frozen for the actual run.

### Second actual HTTP run

The new target uses the same real providers, normal scheduler and full unchanged frozen source. Its first startup
exposed a task-harness portability issue: PostgreSQL's localized Windows authentication error became an asyncpg
connection-closed error rather than the expected wrong-password type. The same empty owned cluster with only
`lc_messages=C` correctly rejected the durable candidate with `InvalidPasswordError`, accepted the bootstrap candidate,
and reported UTF-8 client/server encoding and the exact owned data directory. The harness now sets that diagnostic
locale; its strict authentication fallback and directory checks are unchanged. Seven harness regressions and scoped
Ruff passed again, and independent review found no issue. This happened before any memory import or model call.

The restarted target became ready at `http://127.0.0.1:3953`; its actual configured-model startup call returned HTTP 200
with 87 prompt and 22 completion tokens. `real-run-2` then completed real B3 setup and imported both full Banks:
Global 321 mappings in 3 pages, Character 1,125 mappings in 9 pages. Global's committed import ACK was deliberately
lost and recovered after SQLite reopen with no redispatch; exactly two transfer dispatches served both Banks.
At the initial progress checks, the waiting Bank received real cohort lease renewal and only the two completed B3
refresh operations were present. During that correctly owned interval, the first run's competing ordinary
consolidation was not reintroduced.

The consumer nevertheless exited 1 at `2026-09-09T19:31:37.528Z`, approximately 306 seconds after starting Global
verification, reporting `HINDSIGHT_UNREACHABLE` despite its configured one-hour request deadline. The exact transport
cause remains under controlled diagnosis. The native request continued: Global completed revision 3 at
`2026-09-09T19:56:55.353690Z`, with a certificate, 20 completed consolidation batches covering all 157 requirements,
one completed model step, 314 action receipts, 107 observations and all 157 valid sources marked consolidated.

The supervisor did not treat consumer exit 1 as a reason to stop the target. Its historical `consumer-result.json`
also incorrectly set `remote_outcome_unknown: false` because it considered only an explicit stop request. Preserve
that original file as failure evidence; this report corrects its interpretation. The operator monitoring also failed
to notice the consumer exit promptly. Once Global finished, cohort renewal ended; Character's lease expired at
`2026-09-09T20:01:37.126484Z`, and ordinary consolidation was admitted. At the final read-only check, Character had
87 observations and 136 consolidated sources without a D78 certificate. Those derived writes cannot be cleared or
retroactively accepted as candidate proof.

The owned target was stopped at `2026-09-09T20:21:39Z`. A subsequent live resource check on 2026-09-10 found neither
owned API PID nor either target's `postmaster.pid`; both ownership markers report stopped. Both frozen source copies
still have SHA-256 `e0347289db3004be5778be7d0805177e2e596930c248a6547173de6b915e3977`.
Final provider observations for the second target: 76 returned attempts, 75 HTTP 200 responses, 564,247 known prompt
and 368,439 known completion tokens (932,686 known total), and one attempt without returned usage. Unknown usage is
not zero cost. Global's genuine certificate is useful partial evidence, but all-Bank reconciliation and B4 readiness
were not reached. The second actual-data run is failed/incomplete, not passed.

Supporting private artifacts include `consumer-real-run-2.log`, `consumer-result.json`,
`native-status-after-header-timeout.json`, `model-usage.jsonl`, `ready.json` and `native/ownership.json`.

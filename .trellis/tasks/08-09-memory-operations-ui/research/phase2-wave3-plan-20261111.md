# Phase 2 wave 3 - truthful waiting and bounded backup admission

## Authority and scope

The owner selected recommendation B + 2B on 2026-11-11: implement D103 and D104,
run lightweight checks, update the phase log, then notify the owner when memory
is needed for full-stack verification. This resumes the existing task after the
wave-2b small-stage stop. Work stays in `H:/TakiAgent`, `main`, HEAD `ba5be72`;
preserve all inherited changes. No commit, push, archive, original-data operation,
credential access, deployment, new dependency or full-stack run is authorized
by this increment. Existing wave-2b source and evidence are retained.

Continuation session `01a1c9cc-27b4-77e3-8c5f-24507fc8b376` recovered session
`01a1c958-fb20-7703-beca-49092263d594` and bound this existing task on 2026-11-11.
The predecessor ended on provider errors after dispatching D104. Its completed
[D104 source and report](phase2-wave3-d104-20261111.md) are retained; recovered
logs contain 25 service, 47 related Core and 21 Home test passes. D103 had not
been dispatched or implemented at recovery. Resume D103, integrated checks and
documentation, then retain the same stop point before full-stack verification.

Performance and complexity remain delivery requirements. Reuse the existing
Pending aggregate, scheduler timer, write fence and publication boundaries.
Do not add row/payload scans, repeated validation or a generic retry framework.

### Verification continuation, 2026-11-11

The owner has freed memory and authorized testing, result recording and statistics,
followed by an assessment of a checkpoint commit and baseline alignment with T4.
This supersedes the preceding memory stop for verification. Session
`01a1ca07-857f-7ec2-9adb-11c14229c334` remains bound to this existing task; the live
preflight observed 8.7 GiB available physical memory. Run lightweight gates and
then one isolated stack at a time: the complete controlled Home journey and the
existing copied 1,690-source replay with backup, with resource sampling. Original
data and deployments remain untouched. Commit, merge, rebase, push and task
finish/archive are assessment subjects only, not actions in this continuation.

The task harness is updated from the old head-060 expectation to the explicit
phase-2 head-063 checkpoint for restart, capture and immutable restore. Its Home
operation observer uses the Shared terminal-state contract, including waiting.
These adaptations retain the assertions; they do not waive failed product tests.

## D103 - accepted Native work is waiting, not failed

An independent advisor verified that `HINDSIGHT_PENDING_REMAINS` alone does not
prove accepted-only waiting: a Bank can contain mixed failures, and tracked
Native `unavailable` can carry the same diagnostic. Extend the existing scoped
Pending aggregate used for retry selection to classify the entire unresolved
Bank without loading payloads or probing Native again. Preserve real failed,
unknown, unaccepted and other-diagnostic outcomes. Saved Native status must
support the claimed waiting meaning.

- Add explicit waiting outcomes to Bank/full-reconciliation, exact manual request
  and replica operation state. A manual waiting outcome is terminal evidence for
  that sync attempt, not completion of the Native write. It releases the operation
  family; later checks use independent runs while retaining the original Native ID.
- Waiting preserves real prior failure counters, does not increase failure backoff
  or invent success/reconciliation timestamps. Automatic Banks use the existing
  earliest row retry; manual-only Banks stay manual-only and show the next action.
- Add a new migration for the 051 manual request table CHECK/terminal trigger;
  retain every old row, ID and JSON. Do not rewrite historical failures or old
  migrations. Schedule/operation JSON tables need no second migration.
- Extend existing Shared state invariants and Home labels/read models. Only
  `replica.sync` may settle as a waiting MemoryOperation. No fake success/unknown
  outcome, long-lived claimed operation, extra polling or new result family.

## D104 - bounded wait inside one backup

Use the existing single `writeFence.quiesce` with a 120-second total admission
budget (previously 30 seconds), passing its existing service AbortSignal. The
already admitted owner and its children can finish while the fence is closed;
reopening between attempts would admit more work and add no required progress.
This satisfies the one-click bounded-wait outcome without retrying capture or
repeating identity reads, SQLite copies, Native calls or verification.

Keep the existing timeout override and all capture/pair/release/epoch contracts.
Shutdown or epoch retirement must interrupt admission without starting capture.
Home describes waiting honestly. The explicit tradeoff is up to 120 seconds of
write refusal during admission instead of 30; it is tolerance, not a speedup or a
guarantee that arbitrary work finishes in that time. Subsequent copy and Native
capture extend the total paused window; Native's separate capture budget stays.

## Ownership, checks and stop point

- D103 implementer: Shared schedule/request/operation contracts, Core Pending
  classification/settlement/migration and Home waiting projections with tests.
- D104 implementer: backup service, existing backup fixture/tests and backup Home
  labels/tests. Shared schemas and generic write fence are outside its ownership.
- Leader: context/phase/spec/index records, integrated review and final report.
- Tests serialize with one worker and a 1.5 GiB Node heap; temporary/evidence paths
  use G:. No Core/Native/PostgreSQL stack until the owner arranges memory. The
  preceding measured target was about 6 GiB available physical memory for one stack.
- Required cases: accepted-only versus mixed failure/unavailable, future-row early
  wake, manual-only, terminal waiting request reopen and family release, migration
  history preservation; delayed backup admission succeeds once, timeout creates no
  artifact, stop/retirement prevents late capture and preserves fence lifetime.
- Verify actual registered protocol/UI paths with controlled providers where
  practical, then one bounded independent review. Preserve real-service, installed
  and manual acceptance as unperformed. After implementation and lightweight
  checks, stop and tell the owner the memory needed for the remaining real tests.

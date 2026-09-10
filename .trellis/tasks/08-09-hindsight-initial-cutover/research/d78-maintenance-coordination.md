# D78 Native Maintenance Coordination Correction

## Demonstrated failure

The first owner-approved actual-data run imported every source/unit in two Banks. Global verification then became
stale when ordinary periodic consolidation wrote an observation outside that verification's action receipts:
candidate cursor 325, receipt range 326–347, first ordinary observation at cursor 348. Character verification could
not prepare because ordinary consolidation had also been accepted while it waited. The strict guards were correct.
The deterministic offline fixture had disabled periodic reconciliation and used a synchronous backend.

The failed target is stopped and retained, including its complete import results, 47 action receipts and journal.
Neither a new verification ID nor ordinary-work completion can retroactively prove the unknown derived changes.
Do not clear observations, rewrite the candidate, whitelist unknown changes or repurpose that target as a pass.

## Required ownership lifecycle

- Acquire finite, persistent maintenance ownership in the same Bank writer transaction that exposes an imported
  current-state transfer. It binds exact namespace, transfer request/operation, Local manifest and a fence token.
- Import/prepare/advance must verify the exact owner and attempt. Proof-producing actions and final sealing also
  check the fence while holding the existing Bank writer reservation. No advisory locks or async pseudo-receipts.
- Native finite calls renew valid admitted owners with a five-minute lease and a thirty-second heartbeat. The same
  tenant schema, provider lineage and frozen Local manifest may renew waiting Banks whose transfer/namespace still
  matches. Cohort renewal conveys no permission to read or publish another Bank's proof. Expired/replaced/terminal
  owners are not revived by a late heartbeat, and cancellation/end of the native call stops its heartbeat.
- Ordinary maintenance discovers the same eligible inputs after a deferral. Admission and worker/producer writes
  respect ownership, including the race between selection and actual SQL. Do not clear work, fabricate completion
  timestamps or create fake pending rows that make the existing accepted-work gate impossible to satisfy.
- Retryable incomplete work retains a bounded resume window. Completion, terminal stale, valid explicit supersession
  or expiry releases/replaces ownership; all old delayed writes remain fenced. Lease loss alone is an operational
  failure, not fabricated evidence of source drift. Actual source/journal drift still invalidates the candidate.
- Existing fully proven supersession may replace ownership after all prior transfer/baseline checks succeed in the
  same transaction. Rejected or rolled-back supersession leaves the old owner intact. Old cleanup cannot release its
  replacement. Normal source-completion bookkeeping must reflect actual completed native outcomes.
- An old attempt must check its ownership fence before interpreting candidate drift caused by a newer attempt.
  Late proof-plan, action and completion writes must refuse operationally without invalidating or releasing that
  newer attempt's state.

No new public DTO, route, encoding, capability version, model setting or user-facing schedule is required. Ordinary
non-D78/Oracle paths keep their behavior. D78 mutation without required storage must refuse explicitly.

## Persistence and validation

Additive native migration `d78c3e6f8b12`, after `d78b2d5e7a01`, adds `memory_bank_maintenance` and private nullable
`memory_cutover_verifications.maintenance_fence`. The maintenance table references its exact current-state transfer;
released/expired rows remain fencing state and belong in physical backup/restore. Logical Bank snapshots/portable
exports do not expose process ownership. Existing migration meanings, replay receipts and public hashes remain fixed.

The repeatable-read prepare/claim snapshot also needs an admission fence. Locking a cursor row alone does not make
an already-fixed snapshot observe a newly committed accepted operation. The correction must touch the maintenance
owner row when any operation enters the accepted set, then lock that owner before accepting a quiet snapshot.
It must cover INSERT and terminal-to-pending/processing transitions for every operation type counted by the quiet
gate. A concurrent version change causes a bounded fresh prepare/claim transaction; it must not retry model work.
Existing transfers need released owner rows during migration, and a missing required owner must refuse. Do not
touch the cursor from the accepted-operation trigger: that reverses the existing operation/cursor lock ordering.
Capability admission must check the required columns and active trigger as well as table presence.
The owner lock must also follow one consistent order with the native Bank row across every admission path.
In particular, a maintenance submit cannot hold owner then wait for Bank while graph/task deduplication holds Bank
then enters the owner-touch trigger. The concurrency regression must exercise both submits, not only D78 acquisition.

The same native heartbeat can change the owner tuple after a short repeatable-read input/sealing transaction fixes
its snapshot. A serialization abort there is not source drift. Each of those two SQL-only stages may reopen once,
rebuilding its input view or certificate binding and retaining all ownership/quiet checks. Model execution and
committed actions must remain outside that retry; exhaustion is operational refusal with incomplete evidence.
Test both a successful single conflict and two independent conflicts exhausting the bound, using actual native renewal.

The normal Broker/MaintenanceLoop/WorkerPoller regression uses a deterministic model barrier to reproduce the exact
race. It must cover two waiting imported Banks, an unrelated Bank that continues, admission/quiescence compatibility,
expiry and late writes, explicit supersession rollback, real source-completion bookkeeping and backup fidelity.
Run the native result regression matrix and scoped quality checks before actual models.

Root owns task/spec/ledger and backup inventory; the native implementer owns lease integration and native tests.
The separate full-source retest uses `.trellis/.runtime/d78-real-data/cd01c5453b1e/`, copied from the unchanged original
snapshot. Its preflight already passed with the same 722 sources/722 units and original digests. Start a new native
target only after the correction passes its gates. Keep the first target's evidence independently reviewable.

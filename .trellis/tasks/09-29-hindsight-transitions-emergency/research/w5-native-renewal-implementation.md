# W5 Native final-proof lease renewal repair

Date: 2026-10-03. Scope: parent-approved follow-up to the failed reused-corpus RETURN.
Implementation is ready for independent review; this report does not approve another real-model run.

## Observed failure and reproduced cause

The stopped real recovery operation `40df4fc4-7b5c-49bf-900f-06428fed9c1a`, under original transition
`df47f32c-48a8-47bc-9792-2e24e8642084`, had completed the Character plan's 545 requirements,
71 steps and 600 actions but published no proof. Parent inspection reported no Core COMMIT or Local mutation.
The parent owns those real-data observations; this worker only read the stopped work logs/database.

The native log's renewal `TimeoutError` ends at PostgreSQL's `replication_bank_state ... FOR UPDATE`,
through `TransitionService.renew -> lock_transition_bank -> lock_bank_maintenance`.
The Core lease was still live. The ordinary renewal deadline was 60 seconds; the verification budget was
7,200,000 ms. This was not expiration of the two-hour verify budget.

Owned PostgreSQL RED: `taki-hindsight-g1-3fd949202baa/pytest.log:243` records
`renewalTimedOut=true`, `wait_event_type=Lock`, `wait_event=transactionid`, `blockers=1`.
The real final snapshot transaction was paused at `TransitionCertificateBinding.publish`; its own renewal
waited on its Bank lock. Releasing that transaction completed the proof without repeating completed mock model work.
The fixture stopped and removed its data/registry. No real model or original/work database was started.

The evidence establishes lease starvation behind final-snapshot locking. It does not establish a second
nested-connection self-deadlock or identify the exact dominant CPU/SQL loop in the real large snapshot.

## Why both changes are required

Removing the Bank lock from renewal alone is insufficient: repeatable-read sealing would retain a stale
lease view, and its final UPDATE of the concurrently renewed owner row could raise SerializationError.
Retrying a long seal on every heartbeat would not make progress.

1. Renewal now locks only the exact request row with `FOR NO KEY UPDATE`. This also permits the `KEY SHARE`
   locks acquired by final auxiliary/history foreign-key checks. It checks authenticated actor, exact transition,
   current fence pointer, provider lineage/Bank generation, non-deleted Bank, full executor, nonterminal phase and
   unexpired lease. The UPDATE checks live expiry again. Only `lease_expires_at` changes; phase/revision/history do not.
2. Claim takes the request-row lock before checking expiry. Otherwise it could observe the expired pre-renewal row,
   wait for an uncommitted successful renewal, then overwrite that live executor. Fence/resolve also serialize
   their owner-row checks. These controls keep their original Bank-first lock order; renewal never takes that lock.
3. Only `TransitionCertificateBinding` selects `read_committed`. Its inherited `lock_source` still holds
   replication Bank, maintenance, transition fence and transition plan locks through the one atomic transaction.
   Ordinary snapshot creation and the D78 binding continue to select `repeatable_read`.
4. Final owner publication uses exact attempt/fence/generation, fenced phase, absent outcome and live-lease CAS.
   A failed CAS rolls back the logical/application/evidence/auxiliary pages and proof together.

No migration, protocol shape, public API, timeout, lease TTL, history deletion, cap change or Core producer change
was introduced. Existing final proof and completed action identities are preserved.

## Final-input lock coverage audit

Native paths below are relative to `H:/hindsight/hindsight-api-slim/hindsight_api/`.

| Input family | Producer and protection |
| --- | --- |
| Native snapshot/current cursor | `engine/logical_snapshot.py::_load_snapshot_source`; replication state/journal and Bank/document/memory/model/directive rows share replication Bank locking. |
| Current native rows and auxiliary | `engine/transition_snapshot.py:30,74`; 15 ordinary auxiliary tables are covered by `guard_transition_bank_write`; unit_entities/entity_cooccurrences/memory_links use association guards. |
| Canonical writer enforcement | `alembic/versions/e30a9d7f6c21_add_transition_publication_fences.py:240,322,387`; publication takes replication -> maintenance -> fence locks before a canonical mutation. The runtime capability gate verifies the trigger inventory. |
| D77 checkpoints/heads/artifacts/history | `engine/application_state/snapshot.py`, `store.py`, `transition_application_rebind.py`; all mutable checkpoint/head/artifact/change/operation/body writes share canonical triggers/Bank locking. Complete selected body bytes are read and validated. |
| Read transport exception | `engine/application_state/service.py:96` sets a server-local capability for INSERT-only immutable transport bodies/parts/snapshots. It cannot update heads/artifacts/checkpoints or selected existing body bytes; unrelated immutable new transport rows do not change the descriptors used by final proof. |
| Initialization import/completion | `engine/transition_initialization.py:97,162` explicitly locks the transition Bank. Admission runs inside `memory_engine.py`'s serialized maintenance admission transaction before async INSERT; history appends within the guarded canonical trigger. |
| Initialization worker completion | e30 completion trigger needs the exact live writer, matching current fence generation and pending/processing operation. The final phase is already fenced, advances generation and has zero accepted work, so that completion cannot append after final admission. |
| Maintenance candidate, steps, actions and evidence | Candidate/request are fixed by the recorded plan. Mutations in `cutover_verification_store.py` use `assert_cutover_attempt`, dispatched to `transition_maintenance_store.py:33`, which locks Bank/fence and plan. Late failure handling also takes Bank maintenance lock. |
| Policy and source tracking | Policy is rechecked against its recorded hash; Bank config and mental-model tracking columns are canonical guarded rows. Static server configuration remains the same process configuration contract as before this repair. |
| Owner/executor | Bank/fence locks exclude takeover/resolve during sealing. Only lease-only renewals may change the owner row, and final live/executor CAS joins the current row. |

No production writer was found that can commit a change to a mutable final input while the sealing locks are held.
Administrative table-owner SQL and offline restore are outside live producer concurrency, as before.
Future source additions must satisfy the same writer-lock contract; read-committed is not permission to add an
unprotected input. Queue admission still takes the held fence; final proof does not rely on a new RR conflict there.

## Changes and preserved preimages

Production files (5):

- `engine/transition_storage.py`: opt-in authenticated owner-row locking.
- `engine/transition_service.py`: independent lease renewal and synchronized owner decisions.
- `engine/logical_snapshot.py`: binding-specific transaction isolation; ordinary default unchanged.
- `engine/cutover_verification_certificate.py`: explicit D78 RR binding policy.
- `engine/transition_certificate.py`: transition lock-based RC policy and final lease/executor CAS.

Regression file: `tests/native_results/test_transition_proof_renewal.py` (13 cases).
Contract: `.trellis/spec/backend/memory-transitions.md`.
Original five production byte streams are preserved in `research/w5-native-renewal-preimages/`.
The new overlay inventory is `research/w5-native-renewal-source-hashes.json`; all older source manifests remain intact.
The parent separately owns supervisor cleanup, with overlay manifest
`w5-supervisor-shutdown-source-hashes.json` SHA256
`0aa8d404629d70612c14bbc6ac8cb434c5a3709a66b6329bf092e9979454de47`.

## Executed checks

All PostgreSQL commands used the existing isolated runner:
`H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py -- ...`
with cwd `H:/TakiAgent`, offline model/embedding fixtures and no more than two workers.

| Run | Actual result |
| --- | --- |
| RED: new initial final-lock test, `-n 0` | Expected failure; actual lock graph above. Fixture `3fd949202baa`. |
| `tests/native_results/test_transition_proof_renewal.py -q -s --tb=short -n 0` before adding ordinary-view wrapper | **12 passed in 51.24s**. Fixture `58ef452e8128`; log lines 244/1606. |
| `test_transition_fence.py`, `test_transition_proof.py`, `test_transition_recovery.py`, `test_cutover_snapshot_boundaries.py`, plus root `tests/test_taki_logical_snapshot.py`, `-n 2` | **26 passed, 10 setup errors in 125.98s**. Fixture `563691f2364e`; all errors are root generic snapshot fixture initialization in the optional local sentence_transformers/transformers/torch stack (`precompile` artifact registration), before snapshot assertions. Native and D78 cases passed. |
| New ordinary-view wrapper alone, `-n 0` | **1 passed in 10.72s**. Fixture `5ede8d31c137`. Reuses the original root two-connection concurrency test function and all its assertions under the existing native offline fixture. |
| Scoped Ruff check / format | Passed for the five production files and new regression file. |
| Native `git diff --check` | Passed (existing CRLF advisory warnings only). |
| Scoped `ty check` | **2 diagnostics**, preserved: `logical_snapshot.py:583` `list(page_hashes)` may receive None; `transition_service.py:312` baseline transition ID may be None. The same expressions exist in preimages at lines 575 and 290. This was a current scoped check plus preimage comparison, not an independently executed preimage type-check. |

The first 12 cases prove: repeated renewals while real final transaction and FK KEY SHARE stay open;
single final publication/no model duplication; concurrent ordinary Bank write/claim/abort still excluded;
wrong actor/attempt/generation/token/transition, expiry, terminal outcome, changed pointer and namespace refuse
without owner mutation; successful uncommitted renewal beats stale-expiry claim; final-step expiry rolls back
all native proof pages, and generation recovery reuses completed model steps.

Every owned PostgreSQL fixture reported `Stopped=true`, `DataRemoved=true`, `RegistryRemoved=true`.
Logs remain under `.trellis/.runtime/g1-validation/taki-hindsight-g1-<suffix>/pytest.log`.
No heavy Core rerun was made because Core source was unchanged by this follow-up.

## Remaining review and real-data boundary

Independent review should validate lock coverage, NO KEY UPDATE/FK compatibility, final CAS and immutable history,
then combine this overlay with the parent's supervisor repair. Generic local-ML setup errors and the two preexisting
typing diagnostics are not hidden or relabeled as a fully green repository gate.

No real request was submitted by this worker. Parent last reported total real submissions **276/329**, remaining **53**;
the stopped real work and original pairs remain stopped. No Core COMMIT or user acceptance is inferred from PG tests.
Only the parent may resume the existing transition after the independent check, preserving the same plan/actions,
original source and remaining cap. Real large-snapshot wall time and the complete RETURN/REENTER journey remain
unverified for this patch.

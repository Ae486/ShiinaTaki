# W5 Native renewal and supervisor cleanup independent check

Date: 2026-10-03. Task: `09-29-hindsight-transitions-emergency`.
Reviewer: `/root/w45_readonly_review`.

**Verdict: PASS for this scoped Native repair and supervisor cleanup gate.**
The parent may resume the **same original RETURN only**, with cumulative **276/329** submissions and **53 remaining**.
Keep the original transition, completed steps/actions, source copies and request history. This is not a completed
RETURN, overall W5 acceptance, a reentry allowance, or permission to begin W6-W8.

## Identity and review scope

- Core: `H:/TakiAgent`, main, `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.
- Native: `H:/hindsight`, main, `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`.
- Read the full Native implementation/checkpoint, five exact production preimages and changes, new regression file,
  affected transition contracts, parent supervisor checkpoint/exact preimage changes, and current continuation notes.
- Verified delivery manifest SHA256 `c7e76b48faabea8836e1fbbeeb9f532de11c4d64a7f8b85c4fa35da41b1552a5`
  and supervisor manifest SHA256 `0aa8d404629d70612c14bbc6ac8cb434c5a3709a66b6329bf092e9979454de47`.
  Every listed current file and preserved preimage matched.
- The reviewer changed no production, test, helper, specification, dependency or Git/task lifecycle state.
  Only new independent evidence/report files were written. No real model was called and neither real data pair was started.

## Findings (fixed by the delivered changes, independently verified)

### F1 - Final proof held the Bank lock needed by its own lease renewal

- Files: Native `engine/transition_service.py:208`, `transition_storage.py:191`.
- Previously, renewal entered the same Bank/maintenance/fence lock path held by the long final proof transaction.
  A healthy long proof therefore prevented its own60-second renewal request from completing.
- Renewal now takes `FOR NO KEY UPDATE` on the exact authenticated owner row. It checks full executor identity,
  current fence pointer, namespace/generation, non-deleted Bank, nonterminal phase and live lease. A final UPDATE
  rechecks expiry and changes only `lease_expires_at`; revision, phase, proof and history remain unchanged.
- This row lock is compatible with final auxiliary/history foreign-key `KEY SHARE`. Renewal's Bank/fence reads
  remain nonlocking, so they do not introduce reverse Bank/owner lock order.
- Fresh actual PostgreSQL checks hold the real final transaction and FK lock, complete four renewals, then finish
  one proof without repeating completed mock-model work. Concurrent claim, abort and ordinary Bank write remain blocked/refused.

### F2 - A claim could otherwise overwrite an uncommitted successful renewal

- Files: Native `engine/transition_service.py:165`, plus fence/resolve callers of the same owner-row read.
- Claim keeps Bank-first ordering and locks the owner row before its expiry decision. Fence and resolve similarly
  serialize owner validation against independent renewal. No stale expired MVCC row grants a live-owner takeover.
- The fresh two-connection race observes the expired old row while renewal is uncommitted, then confirms claim
  waits and refuses with `bank_owned` after the successful renewal commits.
- Nine identity/liveness refusal cases verify no owner-row mutation for foreign actor/attempt/generation/token/
  transition, expired lease, terminal outcome, changed pointer and namespace mismatch.

### F3 - Repeatable-read sealing would retain stale lease state after independent renewal

- Files: Native `engine/logical_snapshot.py:455`, `cutover_verification_certificate.py:68`,
  `transition_certificate.py:27` and its final publication UPDATE.
- Only `TransitionCertificateBinding` selects `read_committed`; ordinary snapshots and D78 explicitly retain
  `repeatable_read`. The transition retains replication Bank, maintenance, transition fence and plan locks through
  the same atomic source validation, native/application snapshot, auxiliary/evidence and final proof transaction.
- The final owner UPDATE requires exact attempt/token/generation, fenced phase, no outcome and a currently live
  lease. Expiry rolls the entire publication back; generation recovery reuses completed steps.
- Fresh tests independently verify final expiry rollback/recovery and reuse the original ordinary-snapshot
  two-connection concurrent-writer test function with all its assertions through the established offline fixture.

### F4 - Supervisor shutdown failure skipped post-audit and engine close

- Files: task helpers `w5-reused-native.py`, `w5-supervisor-shutdown.py`.
- The helper configures20-second Uvicorn grace and runs separate cleanup phases for Node, server, cancelled requests,
  listener, post-audit, engine close and observation. Phase errors are recorded and later phases are still attempted.
  An already active driver exception retains its original propagation; otherwise cleanup failure is fatal.
- It drains Uvicorn request cancellation before post-audit and avoids immediately cancelling an already-unwinding
  request a second time. Shutdown uses cooperative asyncio timeout/cancellation; it is not an OS process hard-kill guarantee.
- Three fresh offline/loopback tests pass: server timeout preserving the original error, audit mismatch still
  closing the engine, and an actual stalled Uvicorn request whose cancellation finishes before audit.
- Exact preimage comparison confirms the stage/cumulative cap, durable counter/latch, original request handling,
  completed-work comparisons and attempt-history preservation were retained.

## Final input consistency audit

| Input | Protection checked in current source |
| --- | --- |
| Native canonical rows/current cursor | `lock_source -> assert_cutover_attempt -> assert_transition_maintenance -> lock_transition_bank`; replication/maintenance/fence locks precede source capture. Canonical publication triggers acquire the same locks. |
| Auxiliary rows and graph associations | `transition_snapshot._AUXILIARY_TABLES`, complete association queries, e30 Bank and association trigger inventories; mutations cannot commit through the held fence. |
| D77 heads/artifacts/checkpoints/history | Canonical guarded application writes and complete body validation. The read-transport exception only INSERTs immutable bodies/parts/snapshots; it cannot modify selected existing bytes, heads or cursors. |
| Initialization history | Import begin/completion explicitly take the Bank lock; worker history/completion requires the original live writer/generation and admitted operation. Final fenced admission excludes that old work. |
| Maintenance plans/steps/actions | Exact recorded plan plus Bank/fence/plan locking in `transition_maintenance_store`; final validation reads complete inputs/actions/outcomes and checks policy. |
| Owner/executor | Bank/fence locks exclude claim/resolve throughout seal; independent renewal only changes lease. Final exact/live CAS joins the current owner row. |

No mutable final-input producer bypass was demonstrated in the inspected paths. The RC policy is confined to this
locked transition path; future input producers must honor the same locking contract. No migration, wire schema,
generated client, API route, model configuration, lease TTL or Core runtime timeout changed.

## Fresh independent verification

| Check | Actual result |
| --- | --- |
| Five focused PostgreSQL files | **33 passed in106.32s**, raw exit0,2 workers. Includes all13 new renewal cases, transition fence/proof/recovery and D78 snapshot-boundary cases. |
| Owned fixture cleanup | `taki-hindsight-g1-82014973ec9e`: Stopped=true, DataRemoved=true, RegistryRemoved=true; independently rechecked ownership and absence of data/registry. |
| Supervisor cleanup tests | **3 passed**, raw exit0; only an ephemeral owned loopback request, zero models. |
| Durable budget/latch tests | **4 passed**, raw exit0; fake transports only. |
| Scoped Ruff check/format | Both exit0 for five production files and the new regression file;6 files already formatted. |
| Native diff whitespace | Exit0; unrelated existing line-ending advisory warnings retained. |
| Python AST syntax |10 changed/related production/helper files parsed successfully. |
| Scoped ty, package cwd | Exit0 with cwd `H:/hindsight/hindsight-api-slim` and its existing configuration. |
| Scoped ty, Native root cwd | Exit1 with the same2 Optional-argument diagnostics below; no new diagnostic. |

The type-check difference is configuration, not a source fix: the existing package pyproject disables
`invalid-argument-type`, whereas the root-cwd invocation enables it. Root diagnostics are
`logical_snapshot.py:583` (`list(page_hashes)`, identical preimage expression at575) and
`transition_service.py:312` (optional baseline transition ID, identical preimage expression at290).
This is current execution plus exact preimage comparison, not an independently executed preimage type baseline or
global Native type-check PASS. No suppression was added.

The implementer's earlier combined run remains **26 passed/10 generic local-ML setup errors**; it was not relabeled.
This checker did not rerun that optional dependency initialization. The relevant original ordinary-RR concurrency
assertions instead ran successfully within the offline Native fixture. Unchanged Core source did not receive broad reruns.

Fresh evidence: `w5-native-renewal-independent-pg.log`, `w5-native-renewal-independent-shutdown.log`,
`w5-native-renewal-independent-budget.log`, tool trace and retained fixture `pytest.log` under
`.trellis/.runtime/g1-validation/taki-hindsight-g1-82014973ec9e/`.

## Source and real-state preservation

New inventory: `w5-native-renewal-independent-source-hashes.json`, SHA256
`d6dedae46c42186d8744fd0bfacb043824f72714f562e982b71e9feda66e9296`.
It records24 checked source/spec/helper/evidence paths, five Native preimages, the supervisor preimage and16
preserved manifests. The141-path Core overlay has only the approved transition-spec change after the accepted
snapshot repair. The355-path previous Native inventory has four approved changed paths and no unexpected change.
`logical_snapshot.py` was absent from that old inventory; its fifth production change is verified separately against
the exact preserved preimage. The initial audit assumption that all five were in355 was corrected before writing
this new manifest; no source was modified to satisfy the audit.

Read and checked the parent's existing zero-model inspect attempt `df849d06bf984b7ea83e7794386462ce` without
restarting the pair. Whole-row hash multisets preserve the original9 completed steps/59 actions and current71
steps/600 actions. Its result reports original source unchanged, modelRequests0 and stopped=true. The current
counter remains276, no billing latch exists, and the working PG owner PID is absent. This is independent read-back
of the parent's actual PG evidence, not a fresh real-copy PG audit by this checker.

## Findings (not fixed) and next gate

No new scoped production/helper defect was demonstrated; no additional source repair was needed in this review.
The2 preexisting root-cwd type diagnostics and historical optional-ML setup failures remain disclosed above.

The parent may resume original transition `df47f32c-48a8-47bc-9792-2e24e8642084` using the existing exclusive working
pair and `--stage return --submission-cap329`. Do not repeat completed Character work or replace original operation,
plan, request, step or action identities. The remaining53 submissions are a request ceiling, not cost or balance.
Stop at genuine RETURN completion and review the result before any separately bounded Local-change/reentry phase.
Actual large-snapshot elapsed time and real RETURN completion remain unverified by synthetic PG tests.
**Overall W5 remains INCOMPLETE; W6-W8 and owner/manual acceptance remain separate.**

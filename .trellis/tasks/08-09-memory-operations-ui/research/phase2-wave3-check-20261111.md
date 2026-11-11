# Phase 2 wave 3 - consolidated independent review

## Scope and conclusion

Read-only review of the completed D103/D104 source in `H:/TakiAgent`, `main`, HEAD
`ba5be726e8f03408d389e25962f511f0bc7982c4`. The original owner requirements are in
[the wave-3 authorization](phase2-wave3-plan-20261111.md), the current PRD/execution
direction and [the phase plan](phase-plan-20261107.md). The latest global AGENTS
rules take precedence over the older reviewer-bias note. This review used the
`trellis-check` skill with the explicitly assigned read-only/check-slot boundary.

No confirmed source/spec blocker was found. This is not an automated-gate pass:
the final lint/typecheck completion and the leader's D104 rerun against migration
063 were not confirmed before this report. Full-stack and owner acceptance remain
unperformed. The parent task is not complete.

The reviewer compared D103 production changes with the owned pre-edit copies in
`G:/taki-codex-work/tmp-p2w3-d103`, and D104 with the seven copies in
`G:/taki-codex-work/tmp-p2w3-d104`. The whole dirty HEAD was not treated as the
wave-3 delta. Historical migrations 051, 052 and 057 have no Git diff. The sole
reviewer write is this report; no production/test/spec edits, agents, check
processes, Git writes, runtime/service/model access, credentials, original data,
dependency changes or task lifecycle actions were performed.

## Findings (fixed)

None. No reviewer correction was needed in the inspected source.

## Findings (not fixed)

No confirmed implementation defect. The unconfirmed automated checks below are
delivery-evidence gaps, not manufactured code findings or permission to start a
heavy runner.

## Verified code paths

- **Whole-Bank waiting and cost.**
  `packages/core/src/db/hindsight-pending-recovery-state.ts:16` scopes one SQL
  aggregate to the active Authority Epoch and the requested Bank. It reads only
  recovery metadata, including failed/unknown unresolved rows. Tracked submitted
  rows need accepted evidence and saved `pending`/`processing`/`partial` status;
  accepted legacy submitted rows retain their historical meaning. Receipt-stage
  waits require a saved receipt. Queued/unaccepted, failed, unknown, unavailable
  and other-diagnostic rows cannot make the entire Bank waiting. The Native-result
  recovery path was traced to verify that unavailable can indeed carry
  `HINDSIGHT_PENDING_REMAINS`, so the stronger classification is necessary.
- **One settlement transaction.**
  `hindsight-replica-scheduler-repo.ts:79` calls that aggregate only for
  `HINDSIGHT_PENDING_REMAINS`; unrelated failures do not scan Pending. Its existing
  `settle` at line 187 verifies the run/lease, writes exact request evidence,
  saves schedule state once and releases the lease in the same transaction.
  `hindsight-replica-run-execution.ts` removes the separate post-failure Pending
  retry query/mutation and suppresses the failure warning only after an actual
  waiting settlement. No additional Native probe, payload load or timer is added.
- **Scheduling/history.**
  `hindsight-replica-schedule-state.ts:96` preserves genuine previous failure
  counters, retry-attempt history and success/full-success timestamps on waiting.
  A full waiting attempt records full-reconciliation waiting. A future earliest
  row retry owns the wake; absent/already-due metadata uses the existing first
  delay. Manual-only mode has no automatic wake and automatic resumption retains
  the necessary full check. Existing retry precedence prevents overdue intervals
  from turning future waits into tight loops. Pending transition rules, the
  acceptance-age ladder and Native operation IDs are unchanged by D103.
- **Exact terminal operation and reopen.**
  `hindsight-replica-request-repo.ts:39` persists waiting for the captured exact
  request. `memory-operation-kind-replica.ts:52` and line 96 use that same request
  for boot and normal classification. Shared's terminal-state list and
  `memory-operation-schema.ts:158` permit waiting only for `replica.sync`, with
  an exact replica producer request, replica result, next action and no failure
  diagnostics. The existing operation repo derives `terminalAt` from that list,
  releasing the family; later runs cannot rewrite either terminal history.
  Registered submit/status/list and changed-notification tests exercise this path.
- **Migration 063 and high-impact dependency.**
  `063-hindsight-replica-waiting.ts:11` copies the original rowids and raw columns
  of both the 051 parent and populated 057 quarantine child. It drops the child
  before the parent, recreates the parent and restores its rows before recreating
  the child, then restores the exact 057 FK/table/immutability/quarantine/manual
  admission definitions and 051 queued uniqueness/no-delete contract. Only the
  intended parent state CHECK and terminal UPDATE trigger gain waiting. The
  external operation-admission trigger still references the original table name.
  `migration-runner.ts` executes the DDL and receipt in one transaction. The two
  migration tests cover raw JSON/rowids/old receipts, exact `memory_transition%`
  schema equality, populated FK preservation, old/new terminal immutability,
  admission/uniqueness and receipt-failure rollback through actual reopen.
- **Home truthfulness.**
  `memory-authority-state.ts:101` separates waiting from failure, keeps the previous
  success as history and projects the automatic/manual next action. Existing
  controls remain available for an independent subsequent check; waiting terminal
  history uses the shared operation label and cannot be cancelled as active work.
  Changes extend the existing rows/read model rather than introducing a new UI
  layout, local authority state or polling flow.
- **D104 single bounded admission.**
  `hindsight-backup-service.ts:33` changes the default to 120,000 ms and line 141
  passes the existing service signal to one `writeFence.quiesce`. The explicit
  override and separate 600,000 ms Native budget remain. The actual canonical
  fence permits already-admitted parents/children to drain, clears admission
  waiters on timeout/abort and cannot reopen a retired fence. Admission abort
  settles before identity/copy/Native/scheduler-stop work starts in the held-work
  cases. The original post-admission capture/pair/check/release boundaries remain;
  no capture retry, repeated copy or repeated Native request is introduced.
  `memory-hindsight-backup-state.ts:144` distinguishes interrupted quiescence from
  genuine Native-stage failure using the persisted producer phase.
- **Specs.** The changed contracts in `memory-replica-sync.md`,
  `memory-operations.md` and `memory-hindsight-backup.md` agree with the code above.
  They do not claim waiting is Native completion or that the entire paused capture
  is bounded by 120 seconds. Final phase/deferred/evidence closeout remains the
  leader's ownership.

## Verification

The reviewer inspected saved outputs; no checks were executed by this agent.
Evidence roots below are the existing G: temporary roots, not original data.

| Check | Observed evidence and status |
| --- | --- |
| D103 Shared tests | `tmp-p2w3-d103/shared-test.log`: 22 passed in 3 files. |
| D103 Core tests | `core-test-fixed.log`: 6 files / 113 passed, with only the 21-case aggregate fixture still failing. `aggregate-test.log` subsequently passes all 21 after correcting the fixture's closed epoch timestamps. Thus all 134 selected cases have later passing evidence; the seven-file command was not rerun as one green group. |
| Migration 063 | `migration-test.log`: both preservation/reopen and rollback cases passed; also included in the six passing Core files above. The initial naive-replacement failures remain in `core-test.log`, not relabeled as passes. |
| D103 Home tests | `home-test.log`: 50 passed, 2 waiting-card assertion failures. `home-card-test.log` subsequently passes all 29 card cases. The original assertion accidentally matched CSS `disabled:` classes; the final test checks the actual disabled attribute. This is a targeted replacement, not a claimed three-file rerun. |
| D104 controlled tests | Existing `tmp-p2w3-d104/service-test.log`, `core-path-test.log`, `home-test.log`: respectively 25, 47 and 21 passed. The service tests use the actual fence/SQLite/store and controlled Native route, virtualizing long timer waits only. They cover delayed parent/child drain, timeout, explicit override, stop, retirement and single identity/copy/Native dispatch. These precede D103 migration 063; the leader's current-head service rerun was not confirmed. |
| Lint | D104's report records scoped ESLint exit 0. No final D103/integrated lint log or completion confirmation was available. **Integrated lint not confirmed.** |
| TypeCheck | Shared/Core/Desktop logs exist and show `tsc --noEmit` invocation without diagnostics; logs alone do not prove completion/exit 0. **Final TypeCheck not confirmed.** |

At the final mailbox observation both the parent and D103 implementer had provider
resource errors. The D103 final report was still absent. This explains the missing
completion evidence; it does not establish whether any already-started check
process finished. Do not duplicate a live runner or mark these checks green from
empty logs. Recover the owner/check-slot state and collect actual exit results.

## Accepted tradeoffs and unverified boundaries

- Waiting ends this particular synchronization attempt and frees its family;
  underlying Native work is still unfinished. Previous failure history remains
  factual. Future automatic checks and explicit manual-only checks use the existing
  machinery, with no new lifetime or polling framework.
- Migration 063 makes one-time copies of the two request/history tables plus their
  restoration. That startup I/O/storage cost is necessary for the changed SQLite
  CHECK while preserving populated FK/history; it is separate from runtime Pending
  aggregation cost. No large-history migration timing was measured.
- D104 may refuse new writes for up to 120 seconds during admission instead of 30.
  This tolerates existing work; it is not a speedup or a promise that arbitrary
  maintenance drains. Core copy and Native capture extend the total paused window.
- Ordinary stop retains the existing broad Native failure code; the persisted
  phase lets Home state that no backup began during an interrupted admission.
  Epoch retirement remains irreversible and preserves the existing emergency
  evidence/lifetime behavior.
- The controlled checks do not establish real Native concurrency, installed/browser
  usability, real model quality, owner UI acceptance or original-data acceptance.
  After completing the lightweight gate and phase records, stop and notify the
  owner to arrange memory before full-stack verification. The current plan cites
  approximately 6 GiB available physical memory for one stack; no new measurement
  or stack admission was performed by this reviewer.

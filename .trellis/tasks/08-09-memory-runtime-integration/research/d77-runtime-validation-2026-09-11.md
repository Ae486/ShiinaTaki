# D77/B6 Runtime Validation — 2026-09-11

The D77 native companion and B6 Hindsight runtime are implemented. The final automated Core gate and the isolated
native HTTP/PostgreSQL-to-Core integration pass. This record does not claim real-model quality, original-data migration,
live Authority activation, manual acceptance or B7 switching/takeover acceptance.

2026-09-12 follow-up: the owner-approved [actual-data acceptance](d77-owner-acceptance-validation-2026-09-12.md)
completed with passing data/recovery checks but failed configured-model quality/performance gates. It also corrected
cold-read deadline/resume/binding costs and passed a new final Core gate of 2,957 tests. The 2,941-test gate below
remains the historical pre-acceptance result; it is not a claim that the later actual-model checks passed.

The selected runtime now consumes provider-hosted original application evidence, immediate verified neutral policy,
durable native/application writes, source-only ingestion and the narrow Taki curator. Legacy and Local remain separate
selected paths. The executable contract is [Hindsight Application State and Runtime](../../../spec/backend/hindsight-application-runtime.md).

## Scope and Reproducibility

- Trellis task: `H:/TakiAgent/.trellis/tasks/08-09-memory-runtime-integration`.
- Taki workspace: `H:/TakiAgent`, branch `main`, original baseline `3c63a8080c92ffbb3ee8257dc2d979c2ba4ed711`.
- Native workspace: `H:/hindsight`, branch `main`, original baseline `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`.
- The session binding was verified with `task.py current --source`. The empty global task pointer is not a different task.
- Main evidence directory: `.trellis/.runtime/b6-continuation-20260911/d77-quality` in the Taki workspace.
- No commit, staging, push, rebase/reset, finish/archive, live activation or new dependency declaration was performed.
  Original user database contents, credentials and retained D78 target data were not used by these tests.

## Final Automated Gate

| Check | Result / evidence |
| --- | --- |
| Core | **2941 passed in 366 files**; `tests-final.log`, 169.74 seconds |
| Shared | **505 passed in 53 files**; initial workspace `tests.log`; unchanged after that gate |
| CLI | **47 passed**; same workspace log; unchanged after that gate |
| Desktop TypeScript | **548 passed**; same workspace log; unchanged after that gate |
| Workspace types | All five package typechecks passed; final Core-only check after subsequent Core changes passed |
| Root lint | `pnpm lint` passed; `lint-final.log` |
| Task HTTP fixture types | Explicit root-based temporary tsconfig passed; `fixture-typecheck-final.log` |
| Native HTTP-to-Core integration | **1 complete integration scenario passed**, owned fixture `2f49fea894dc`, 82.51 seconds |
| Native integration source | Ruff, format and scoped ty passed; ty resolves the actual harness module through its explicit extra search path |
| Actual Core boot | Legacy and Canonical Local both reached `ws server listening`, migrations 1–47, zero provider/model requests, zero Pending and zero Hindsight activation receipts |
| SDK | **683 generated files identical across two full generations**, with all pinned SDK gates passed; see [SDK report](d77-sdk-validation-2026-09-11.md) |
| Native independent review | **24 passed**, including 11 new scenarios; see [native review](d77-native-review-2026-09-11.md) |
| Unchanged desktop Rust | Prior recorded **178 tests and clippy passed**; no Rust changes since the [Local gate](local-runtime-validation-2026-09-11.md) |

The 4041 TypeScript tests above are the final Core gate plus the unchanged packages' completed workspace gate. They are
not counts from a single rerun. The first Core pass had 2905 passing and three failing tests: two stale migration-tail
assertions and a test fixture placed inside the production architecture-check directory. Those issues were fixed and
the complete final Core suite passed. No test was skipped to obtain that result.

Commands, from `H:/TakiAgent`:

```powershell
pnpm -r typecheck
pnpm lint
pnpm -r test --maxWorkers=4 --reporter=dot
pnpm --filter @taki/core typecheck
pnpm --filter @taki/core test --maxWorkers=4 --reporter=dot
node .trellis/tasks/08-09-memory-runtime-integration/research/validation/run_d77_core_boot.mjs
& 'H:/hindsight/.venv/Scripts/python.exe' .trellis/tasks/08-09-memory-runtime-integration/research/validation/run_d77_runtime_validation.py
```

The final two commands use new owned fixtures. They do not load repository environment files. The PG harness retains
its existing network/ownership guards and the prevalidated local tokenizer asset. Both final PostgreSQL and HTTP
listeners were stopped; owned PG data and registry entries were removed. The Core boot smoke killed its two known
children and closed its listeners. On Windows that SIGTERM proves process exit, not graceful signal handling; the
separate runtime tests prove stop/drain and absence of late SQLite access.

## Actual Native-to-Core Scenario

The integration uses the real authenticated native HTTP API, PostgreSQL transactions, native application publication,
G1 receipts/pages, and a real Core SQLite subsystem. Core provider/repository/command/recovery code is not stubbed.
Only external native model/embedding/reranker behavior is replaced by deterministic test implementations.

The scenario verifies:

1. Cold application seeding for Global and Character Banks, native/application version association and neutral recall
   before any Core Utility-model assessment.
2. Hidden policy exclusion after an application-only update, and native guarded reflection with actual model-input
   spies excluding hidden siblings, whole-source text and opaque derived input.
3. Original Source text plus typed source metadata preserved independently from extracted native unit metadata.
4. A lost native retain ACK followed by an outage and SQLite close/reopen. Recovery consumes the original historical
   receipt with no additional native dispatch.
5. Pure layer edits without native mutation, compound native-text/layer edits with independent local application proof,
   exact revision changes and stable operation replay.
6. Character-specific retain, user-owned Core Block preservation and complete reconstruction in a new empty SQLite
   database using only provider application snapshots. The new database has no prior write journal or Local memory units.
7. Foreign-key consistency and zero Core model calls throughout the neutral/runtime reconstruction scenario.

The successful earlier run `9e8b33666217` took 43.91 seconds. The final run repeated the scenario after the lifetime and
queue fixes while the full Core suite was also running; both passed. Timing differences are not treated as performance
claims.

## Defects Reproduced and Corrected

| Finding | Correction and proof |
| --- | --- |
| Native hydration omitted Bank head required by Core projection | Recall now explicitly requests Bank plus at most 255 Memory selectors; the actual HTTP failure is covered by the full scenario and selector-faithful runtime fixtures |
| B5 plain-error normalization turned ACK-loss availability into an internal error | Match the same closed availability codes after normalization; a dedicated gateway regression preserves durable pending state and still propagates unknown errors |
| A later same-layer policy restriction was reported as the original request's success | Compare the complete policy actually stored in the original command; restrictive updates and deleted targets supersede, while assessment-only updates remain valid |
| Offline rebinding silently removed an existing required pin from a new Run | Inspect verified binding work before assembly; refuse active required pins without current binding, with invalidated and expired controls |
| Shutdown did not drain captured native reads | Track provider work and complete foreground tool/automatic-recall/capture promises; held consumers refuse before coordinator entry after stop |
| A normal object spread would erase Effect authority metadata in the lifetime wrapper | Preserve original own property descriptors, including the non-enumerable Symbol; verify immutable metadata against the captured capability digest |
| Queued calls ignored their own cancellation/deadline until earlier Bank work returned | Bound the waiter independently without acquiring a later lease; timeout and abort regressions use real SQLite leases/checkpoints |
| Direct write recovery omitted B5's generation-reset retry | Reuse the same lease and absolute deadline for one full recovery retry; scheduled execution retains its existing reset owner |
| Native same-batch duplicate binding and unrelated retirement CAS | Independent review reproduced and fixed both; historical assessment no longer blocks valid same-object retirement after a native edit |

Root independently reviewed the native `commits.py` corrections and the SDK's source-level schema qualification and
generator changes. The latter preserve native names and literal schema defaults/examples; the final generated parity
and old-public-surface comparisons are in the SDK report. No generated file was patched by hand.

Additional focused checks cover replay-floor rebuild, the separate preserved native `snapshotManifestDigest` versus
changed current projection `manifestDigest`, corrupt event/hash/namespace refusal without checkpoint advancement,
revoked-lease refusal before publication, cached capability corruption, scope drift, late Primary witnesses, actual
two-Bank Pending flush coverage, curator retry/claim lifetime and per-pass ConfigSource values.

## Final Source and Preservation Audit

The final scoped audit covers 297 changed/untracked Taki files, including 209 untracked files. UTF-8/no-BOM checks,
new-file whitespace, production module headers and folder index coverage passed. Both repositories' tracked
`git diff --check` passed; untracked files were checked separately without staging.

All 683 generated outputs still match the completed SDK generation manifest. The 35 native source entries, excluding
the separately updated patch ledger, match the SDK handoff after the explicitly approved `commits.py` repair. The
126 maintained-file entries likewise have no unexpected drift after their recorded generation exceptions and that
repair. The native patch-ledger update is separately identified and hashed. These comparisons use the recorded SDK
handoff, not an invented pre-implementation baseline. Details are in `d77-quality/delivery-audit.json`.

## Remaining Acceptance Limits

- The literal native whole-repository auto-fixing lint hook was not run because it syncs dependencies and reformats
  unrelated maintained files. Read-only equivalents and owned-source checks were used. Whole API ty still reports 27
  existing Windows/MLX diagnostics; embed ty reports three existing `termios` diagnostics. Existing EOL/format and docs
  anchor warnings are enumerated in the SDK report. These commands are not claimed green.
- Deterministic tests establish input suppression, identities, transactions and lifecycle mechanics. They do not assess
  real-model policy quality or runtime performance under production traffic.
- No original-user-data migration, new actual Authority activation, owner/manual acceptance or B7 planned switch-back,
  re-entry or Emergency Local Takeover was performed. B7 retains its required separate grill.
- Application evidence and historical receipts are retained conservatively. State-stream pruning does not reclaim
  original bodies. Nonempty native downgrade refuses; destructive cleanup or rollback requires separate authorization.

## Workspace Recovery Incidents and Future Dispatch Rule

Two check agents independently recovered into T4 after context resets despite explicit main-workspace/task constraints.
They reported read-only task-pointer/status and task/spec/worktree queries, with some first-agent queries interrupted
before output. Neither reported a wrong-workspace edit or test. Both were stopped; root completed all remaining fixes,
tests and documentation locally. Their T4 information was not used for this task and was not re-read to investigate.

Root's initial recovery also used a filename-only search broader than the known B6 runtime folder. It exposed names of
historical runtime artifacts; their contents were not opened and no retained dataset was changed. Subsequent execution
used exact task paths and newly owned fixtures.

The owner's final steering requires every future dispatch and resume to name the absolute workspace, exact Trellis task,
branch, owned files and prohibited paths. The agent must verify those anchors before work and after recovery. An empty
global pointer or a conflicting injected workflow hint requires reporting the mismatch; it never authorizes searching
another task/worktree. No further sub-agent was dispatched or resumed after both check agents were stopped.

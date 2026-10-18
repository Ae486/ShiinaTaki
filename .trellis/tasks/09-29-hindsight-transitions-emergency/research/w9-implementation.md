# W9 implementation and interruption recovery

Date: 2026-10-07. Workspace: `H:/TakiAgent`, branch `main`, predecessor
`2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.

Status: implementation and scoped verification are complete; independent review remains the leader's next
dispatch. The first full Core run passed 3,791 tests and failed four cases solely at Vitest's default five-second
deadline, with one pre-existing skip. After changing only those four test deadlines to their existing sibling
30-second budget, the complete affected file passed all seven cases. This is a preserved full run plus scoped
recovery, not a claim that a second full run was green. The owner authorized recovery and continuation, not a new
task, commit, push or archive.

## Correctness change

`publishMemoryTransition` now requires an explicit `currentTime(): string` for new publication. The healthy driver
passes its existing injectable live `deps.now` clock. After the complete real publication reader finishes, the
same synchronous outer SQLite transaction checks the original transition/operation/attempt/generation/owner
against that current time, requiring exactly the receipt insertion's one revision increment. It cannot adopt a
different executor read from the mutable row. The existing emergency implementation retains its own equivalent
guard and configuration check.

Expiry at `leaseUntil` throws `MEMORY_TRANSITION_LEASE_LOST` before transaction return. Receipt, publication,
selected marker, source/target epochs, Local or Hindsight representation, custody and queue-related state roll
back together. The driver's ordinary unknown-outcome handling remains in force. Core rollback does not undo or
claim to undo earlier Native work; the existing original-operation recovery owns those obligations.

Captured `now` still identifies immutable proof/receipt evidence. Existing committed-receipt recovery performs
its complete read-only join before the new-publication guard and does not reacquire an obsolete executor lease
or publish again. No lease duration, heartbeat interval, timeout, schema, public protocol or dependency changed.
Functional verification has not shown a normal flow requiring a lease extension; no performance work was added.

## Changed files and ownership

The interrupted implementer already wrote the original ten-path change. Recovery inspected and retained it
without rewriting production source, then adjusted only four time limits and a rationale comment in the existing
emergency-context test file after the full-suite evidence below. The leader owns current-task/B7 planning
documents; they are outside this manifest.

| Paths | Change |
| --- | --- |
| `packages/core/src/db/memory-transition-publication-repo.ts` | Required live clock and final original-executor/revision guard. |
| `packages/core/src/memory/transitions/transition-healthy-execution.ts` | Pass the healthy service's live clock into publication. |
| `packages/core/src/memory/transitions/transition-healthy-publication-lease.test.ts` | Eleven actual-publication lease, identity, rollback, success and recovery cases. |
| `packages/core/src/memory/transitions/transition-evidence-context.test.ts` | Thread the simulated processing clock through the existing genuine-exhaustion boundary. |
| `packages/core/src/memory/transitions/transition-emergency-context.test.ts` | Recovery-only adjustment: four explicit 30-second test deadlines, matching the existing sibling cases; test bodies and assertions unchanged. |
| `packages/core/src/testing/memory-transition-publication-fixtures.ts`, `memory-transition-cycle-fixtures.ts` | Explicit publication clocks in existing real Core fixtures. |
| `packages/core/src/db/index.md`, `packages/core/src/memory/transitions/index.md`, `packages/core/src/testing/index.md` | Update touched module contracts. |
| `.trellis/spec/backend/memory-transition-publication.md` | Record final-clock, exact revision, atomic rollback and read-only recovery requirements. |

The 11 final owned source/spec/index identities are in
[w9-source-identities-2026-10-07.json](w9-source-identities-2026-10-07.json), with exact SHA-256 and byte sizes.
The [original ten-path pre-Core manifest](w9-pre-core-source-identities-2026-10-07.json) is preserved separately.
The [final identity check](w9-final-identity-result-2026-10-07.json) confirms all ten original paths remain
byte-identical, every final path is strict UTF-8 without BOM/trailing whitespace, and the original red log matches
its pinned hash/size. The additional test file's [pre-adjustment identity](w9-emergency-context-before-2026-10-07.json)
and Git diff identify its narrow deadline-only change. New recovery logs/results and this report supplement
original W9 and pinned W8 evidence; none replace that evidence.

## Regression design and retained red evidence

- Both actual healthy directions run through the operation owner, started runtime and SQLite publication. The
  fixtures include one real queued intent and a finalized primary group containing two witnessed members.
- The spy delegates to the complete production publication reader first. Only after that reader returns does
  it advance the injected clock to `leaseUntil`; no sleeps, skipped joins or fabricated reader results are used.
- The test snapshots every SQLite table immediately before publication and after its exception, retaining all
  row bytes and duplicates. It asserts exact database equality, no new receipt, the original proven attempt,
  preserved queue custody, truthful `outcome_unknown`, and a clean SQLite foreign-key check.
- Both directions succeed one millisecond before the deadline, preserve captured `committedAt`, and recover the
  same committed receipt after expiry without any table changes.
- Six corruption cases change owner, operation, attempt, generation, revision, or restore the pre-receipt revision
  after real read-back. Each rejects instead of adopting that row and rolls the whole transaction back.
- An untyped caller omitting the clock fails before any new publication writes.

The preserved [red log](w9-red-final-lease-2026-10-07.log) records **2 failed / 2 tests**, with pnpm reporting
exit **1** for `vitest run src/memory/transitions/transition-healthy-publication-lease.test.ts --maxWorkers=2`.
Both failures reached the complete reader and nonempty custody/queue assertions, then found no lease refusal.
Its SHA-256 remains the value pinned in [w9-red-identities-2026-10-07.json](w9-red-identities-2026-10-07.json).
The red run was not repeated during recovery. The original [focused green log](w9-green-focused-2026-10-07.log)
retains **2 files / 20 passing tests**; the recovered adjacent gate below independently covers those final sources.

## Recovered verification

Environment: Node `v24.18.0`, pnpm `10.22.0`, Windows PowerShell. Tests use at most two Vitest workers.
Each new gate saves an explicit command, UTC start/end timestamps and actual process exit code in its
`w9-recovery-*-result-2026-10-07.json` companion, so tool-session loss cannot turn an invocation-only log into a pass.

| Gate | Result | Evidence |
| --- | --- | --- |
| Focused and adjacent publication/evidence/healthy boundary/terminal/reconstruction/emergency/runtime recovery | **11 files, 67 tests passed**, exit **0**, 89.84 seconds | [log](w9-recovery-adjacent-2026-10-07.log), [exact command/result](w9-recovery-adjacent-result-2026-10-07.json) |
| `pnpm -r typecheck` | All **5** workspace package checks passed, exit **0** | [log](w9-recovery-typecheck-2026-10-07.log), [result](w9-recovery-typecheck-result-2026-10-07.json) |
| `pnpm lint` | Root ESLint passed, exit **0** | [log](w9-recovery-lint-2026-10-07.log), [result](w9-recovery-lint-result-2026-10-07.json) |
| `git diff --check` | Passed, exit **0**; normal CRLF-to-LF advisory messages only | [log](w9-recovery-diff-check-2026-10-07.log), [result](w9-recovery-diff-check-result-2026-10-07.json) |
| `pnpm --filter @taki/core test --maxWorkers=2` | **490 files passed / 1 failed; 3,791 tests passed / 4 timed out / 1 skipped**, exit **1**, 856.42 seconds | [preserved full log](w9-recovery-core-2026-10-07.log), [result](w9-recovery-core-result-2026-10-07.json) |
| `pnpm --filter @taki/core test --maxWorkers=2 --reporter=verbose src/memory/transitions/transition-emergency-context.test.ts` | Final affected file: **7 tests passed**, exit **0**, 52.88 seconds | [log](w9-recovery-emergency-context-2026-10-07.log), [result](w9-recovery-emergency-context-result-2026-10-07.json) |
| `pnpm exec eslint packages/core/src/memory/transitions/transition-emergency-context.test.ts` | Final test-only adjustment passed, exit **0** | [log](w9-recovery-final-file-lint-2026-10-07.log), [result](w9-recovery-final-file-lint-result-2026-10-07.json) |
| Final `git diff --check`, source/encoding/red-log/process check | Passed, exit **0** | [diff result](w9-recovery-final-diff-check-result-2026-10-07.json), [identity result](w9-final-identity-result-2026-10-07.json) |

The original typecheck output had all package `Done` markers but no recovered process exit metadata; the old lint
and adjacent logs were invocation-only. They remain preserved and are not used as completion evidence. The new
static runs are necessary recovery of missing exits. The only edit after these static gates is the four test
deadline arguments and their rationale comment; the final file was linted separately. Test counts overlap and
must not be added as unique coverage. The complete accounting is 3,795 distinct passing cases across the full
run and scoped recovery, with one existing Windows-gated artifact-mode-bit skip. The full-run exit remains 1.

## Test-budget finding and correction

The only four full-run failures are `Error: Test timed out in 5000ms` in `transition-emergency-context.test.ts`.
They cover immutable object/Map isolation, fresh SQL identity/body checks, complete projection keys, and fresh
emergency observer contexts. The first three cases in the same file already use an explicit 30-second budget.
The four remaining cases built the same complete SQLite fixture but accidentally depended on the default five
seconds. Their first-run reported times were 5.115, 5.076, 5.253 and 5.136 seconds; no application lease refusal or
incorrect assertion result was reported.

The bounded diagnosis considered insufficient test budget, genuine production lease rejection, and cross-file
resource interference. Changing only the four deadlines to the existing sibling 30-second value allowed all
unchanged assertions to complete. Their isolated final durations were **5.576, 5.721, 5.329 and 6.169 seconds**,
respectively, directly demonstrating that five seconds was insufficient even without another test file running.
All three sibling cases also passed. No application runtime budget, clock, fixture, assertion, cache, or global
Vitest setting was changed; no additional regression is needed for a test-budget-only adjustment.

The leader explicitly authorized using the complete first-run results plus this final-file recovery and unchanged
original-source identities. No behavioral source change, additional failure or cross-file concern justified a
second 14-minute full Core suite. The independent checker can reuse those exact-source results and run its own
bounded correctness regression rather than repeat the entire suite. No debug instrumentation was introduced.

## Boundaries and handoff

No Native/Desktop source, original data, models, corpus wrappers or services were changed or launched. No original
corpus conversion or new real-model call was performed. Shared/Desktop/Native full suites were not repeated because
their source/API/dependency surface did not change; historical W8 results retain their original evidence scope.
Manual/original-environment, packaged WebView2/CSP, original credentials/data authority replacement, and D91 global
acceptance remain open. The deterministic Native envelopes prove Core joins, not new live Native acceptance.

At recovery there was no surviving old W9 test/typecheck/lint process and no old process was terminated. All new
gate processes exited normally. The final identity/process check found zero remaining owned Vitest/typecheck/lint
processes and records an empty terminated-PID list; no service was stopped as part of this recovery.

Next: one independent `trellis-check` verifies final clock provenance, original executor plus exact revision,
complete rollback with nonempty custody/queue, unchanged emergency and read-only recovery behavior, source hashes
and gate evidence. It should reuse unchanged passing gates. Stage 5 implementation remains gated on that review;
the leader owns downstream planning, task acceptance and status updates.

# W9 independent correctness check

Date: 2026-10-07. Workspace: `H:/TakiAgent`, branch `main`, HEAD
`2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.

## Verdict

**PASS within the approved W9 scope. No additional correctness, test or spec finding requires a fix.**
The final healthy-publication lease gap is closed. An executor expiring during complete publication read-back
cannot commit authority; both healthy directions roll back their complete SQLite state. Valid publication and
read-only recovery of the original committed receipt remain functional. No finite lease extension was needed by
the scoped functional checks; the 300-second lease and 30-second heartbeat remain unchanged.

This is an independent source review plus a new bounded actual-Core regression, with source-matched implementation
gates reused explicitly below. The first complete Core suite remains a recorded **exit 1**. Its four default
five-second test timeouts were corrected only in that test file, whose seven unchanged test bodies then passed.
This report accepts that approved composed gate; it does not claim a second clean full-suite run.

## Context, scope and source identities

- Read the explicit active task's PRD, current design/implementation W9 amendments, all 14 curated `check.jsonl`
  entries, the continuation review, W9 plan and implementation report. There is no task `info.md`.
- The child legacy `.current-task` pointer is empty. The dispatch's explicit active task and parent-verified
  session binding were authoritative; no task or lifecycle state was created or changed.
- Applied `trellis-check` and `trellis-before-dev`; followed the backend index through `CLAUDE.md`, `CONTEXT.md`,
  SQLite isolation, transition/publication/healthy/emergency, quality, errors, logging and the shared thinking guides.
  Package discovery reports a single-repo spec layout with backend/frontend layers. W9 changes Core DB/service/tests
  only, plus the corresponding indexes and backend publication contract. No frontend or Native contract changed.
- Inspected all 11 final owned source/spec/index changes, including the complete new regression and existing
  fixture clock adaptations. Independently compared SHA-256 and byte size: **11/11 final paths, 10/10 original
  pre-Core paths and 27/27 pinned W9 evidence artifacts match**, with zero mismatches. See
  [before identities](w9-independent-identities-before-2026-10-07.json) and the final checker identity record.
- The parent's newly verified W8 362 Taki / 367 Native source identities, 23 source/helper overlays and 28 evidence
  pins remain inherited scope evidence. This checker did not repeat that historical audit or any corpus wave.
- Verified no Git hunks for the broader dependencies read here: production boot composition, SQLite wrapper,
  lease/receipt/proof/publication-reader repositories, emergency publication, runtime forwarding and heartbeat.
  Shared/Desktop/e2e sources, root package manifest and lockfile have no W9 diff. No generated schema, migration,
  template/update/detection, package dependency or public wire touch point is required by this internal input change.

## Findings (fixed)

None introduced by this check. The implementation already fixes the reviewed P2 defect in
`packages/core/src/db/memory-transition-publication-repo.ts:74` and wires its production clock in
`packages/core/src/memory/transitions/transition-healthy-execution.ts:149`.

## Findings (not fixed)

None within W9. Owner/manual, original-environment and downstream stage acceptance remain separate boundaries,
not unresolved defects in this amendment.

## Actual-path review

| Boundary | Reviewed code and conclusion |
| --- | --- |
| Production clock | `main.ts:267` calls `composeMemoryTransitions` without a clock override. `boot/memory-transition-boot.ts:32` supplies the live `() => new Date().toISOString()` default; the healthy service forwards its dependencies to execution. The new publication call passes `deps.now` itself, not an earlier returned timestamp. The runtime wrapper at `transition-runtime.ts:65` forwards the typed input unchanged. |
| Clock requirement and immutable time | `memory-transition-publication-repo.ts:25,37` requires a clock in TypeScript and rejects an untyped missing clock before new-publication writes. `input.now` retains proof/receipt timestamp meaning. There is no captured-time fallback for the final live check. Invalid clock output also fails the existing ISO-date validator. |
| Exact executor and revision | The entry boundary acquires the SQLite writer reservation and calls `requireTransitionLease` against the original transition key, operation, attempt, generation, owner and revision. `recordTransitionReceipt` changes that same attempt to `committed` with precisely one revision increment. The final check copies the original input lease and replaces only its expected revision with captured `attempt.revision + 1`; it does not adopt a freshly read executor or arbitrary revision. The common validator additionally rejects a non-running operation, terminal/quarantined executor and `leaseUntil <= currentTime`. |
| Final transaction boundary | Allocation, Local installation or Hindsight representation, epoch selection, custody, receipt, publication and marker are inside one `db.transaction`. The complete real `readVerifiedTransitionPublication` finishes before the new check, with no asynchronous gap. The SQLite wrapper commits only after the callback returns and rolls back when the check throws; nested receipt writes use savepoints within the same outer transaction. |
| Complete evidence | The reader still reconstructs candidate/baseline/native proof and checks source disposition, exact queue inventory, checkpoints, ancestry, marker and custody. Its independent synchronous evidence context is unchanged; the final lease/operation read is not cached. No validation was removed or weakened. |
| Lost replies and already committed state | The prior-receipt branch performs the complete publication reader and candidate match before returning the immutable receipt. It precedes the new-publication clock/lease guard and does not reinstall, republish or reacquire an obsolete executor. The driver retains existing native-finalization, binding and original-operation recovery boundaries. |
| Failure classification | Expiry propagates through the unchanged execution catch, positive-abort attempt and durable unknown-outcome path. Tests observe `outcome_unknown`, a preserved proven attempt and no new receipt. SQLite rollback does not assert rollback of earlier Native work or release its obligations. |
| Emergency consistency | Emergency still supplies its own live clock and final configuration/original-executor/revision check at `memory-transition-emergency-publication.ts:87`. Moving the generic missing-clock guard preserves that behavior. Its production sources are unchanged. The four emergency-context test edits affect only per-test deadlines and a rationale comment. |

## Regression methodology

The two expiry cases use the actual operation owner, healthy service, started runtime and SQLite publication in
both return-Local and reenter-Hindsight directions. Their native transport is a deterministic fixture, not a new
live Native acceptance. After actual quiescence they add a finalized primary group with **two witnesses** and
**one durable queued mutation** before cutoff. The spy calls the complete production reader first and advances
the injected clock to the current deadline only after that reader returns. No reader result is fabricated.

Before/after snapshots enumerate every SQLite table and retain every serialized row, including duplicates and
binary values; sorting only removes outer row-order noise. The comparison is immediately around the publication
call, before later driver failure bookkeeping. This covers receipt/marker/epoch, Local and Hindsight installation,
custody, queue reservations/results and history together. Separate assertions prove nonempty obligations were
actually read, no receipt survives, the original phase/queue remain, the operation becomes unknown and foreign
keys remain valid. The existing pre-fix log failed both directions specifically because no lease refusal occurred
after those complete-reader/nonempty-obligation assertions; its pinned bytes are preserved.

The success cases reach one millisecond before expiry and complete both real healthy drivers, retain captured
`committedAt`, then recover the exact original receipt after expiry with all tables unchanged. Six fault cases
alter owner, operation, attempt, generation, extra revision or missing receipt revision after the real read-back;
all refuse and roll back. The untyped missing-clock case refuses before writes. Existing evidence-context cases
retain genuine simulated exhaustion, fresh validation, corruption, byte isolation and asynchronous-misuse checks.
No sleeps, production clocks, assertions or global test budgets were weakened to obtain a pass.

## Verification

| Gate | Result and provenance |
| --- | --- |
| **New independent focused regression** | **2 files / 20 tests passed**, exit **0**, **26.68 seconds**, `--maxWorkers=2`; [verbose log](w9-independent-regression-2026-10-07.log), [command and process result](w9-independent-regression-result-2026-10-07.json). Covers all 11 W9 cases plus 9 synchronous evidence cases. |
| **Lint: PASS** | Reused source-matched `pnpm lint`, exit **0**, plus the final emergency-context file's ESLint, exit **0**. Read both exact command/result records and logs. No checker source fix invalidates them. |
| **TypeCheck: PASS** | Reused `pnpm -r typecheck`, exit **0**, with all **5** workspace `Done` markers. The only later source edit is four numeric per-test timeout arguments and a comment; the passing complete affected-file run and scoped lint validate that documented delta. |
| Adjacent integration | Reused exact-source **11 files / 67 tests passed**, exit **0**, covering publication/order/emergency, evidence, healthy boundaries/terminal/reconstruction and runtime/emergency recovery. |
| Complete Core run | Retained **491 files / 3,796 cases**: **490 files passed, 1 failed; 3,791 passed, 4 timed out, 1 existing skip; exit 1**. All four failure stacks identify default `5000ms` timeouts in the pre-adjustment emergency-context file. |
| Scoped correction to complete run | Final emergency-context file: **7/7 passed**, exit **0**, **52.88 seconds**. Its four changed cases took **5.576, 5.721, 5.329 and 6.169 seconds** in isolation. Git diff confirms only those four deadlines now use the existing siblings' `30_000` budget; bodies/assertions/fixtures are unchanged. This supports the authorized composed gate without a second complete run. |
| Final checker identity / whitespace | New final record rechecks all source and evidence pins, strict UTF-8/no BOM and whitespace for the 11 owned paths and checker additions; new `git diff --check` result is retained separately. |

The complete gate accounts for **3,795 distinct passing Core cases plus one existing skip** across the full run
and scoped recovery. Focused/adjacent runs overlap and are not added as unique tests. Invocation-only old lint and
adjacent logs are preserved but are not completion evidence. Static gates and broad suites were not repeated
without a source change, failure or unresolved concern, as explicitly required by the approved W9 cadence.

## Release and remaining boundaries

No production, test, fixture, spec or index change was needed by this checker; the 11-path implementation manifest
remains the final source identity. New files are this report plus checker-owned logs, process results and identity
records. Planning/B7/leader documents and all existing evidence remain owned by the parent and were not edited.

The independent regression process returned exit 0; its fixture teardown closes the operation/service/runtime and
database owners. No checker process remains owned or pending, no process was forcibly terminated, and no service
was stopped. Process inspection exposed only PID/name/status; other Node processes were left untouched. Source
ownership is released to the parent after the final identity check.

No original data, credentials, models, Native/Desktop source, production service, old W5/W6 wrapper, dependency,
commit, push or task finish/archive was touched. New tests certify the Core boundary with synthetic Native
envelopes; historical real-data/Native results keep their existing scope. Packaged WebView2/CSP, original data
replacement, original/DPAPI or cross-machine credentials, owner/manual acceptance and global D91 remain open.
W9 is independently ready for the leader's acceptance update; subsequent Stage 5 implementation still requires
its own reviewed task scope and activation.

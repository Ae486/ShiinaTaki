# Stage 4 continuation review

Date: 2026-10-07. Scope: verify the delivered implementation and design the review gates before downstream planning.
This record supplements immutable W0-W8 evidence; it does not replace those reports or establish manual acceptance.

## Baseline and evidence identity

- Taki: `H:/TakiAgent`, `main`, `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.
- Native: `H:/hindsight`, `main`, `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`.
- Existing task restored through session-scoped `task.py start`; its status was already `in_progress`.
- The older T4 Skills/MCP worktree is unrelated to this Stage 4.
- New read-only SHA256 and size comparison: all 362 Taki changed non-task/non-handoff files and all 367 Native
  changed files match final W8 identities. Every changed path has an identity entry; no missing or mismatched files.
- New read-only comparison: all 23 W8 source/helper identities and all 28 final evidence pins match.
- Native initially reports nine tracked modified paths, but `git diff` has no textual hunks and the exact file
  bytes above match W8. Preserve that working-tree state; no reset, index rewrite or normalization was performed.
- New Trellis validation passes: 43 implementation context entries and 52 check entries.

The comparison loads `w8-source-audit.json` matches/changedSources/drift and applies `w8-source-ownership.json`
last. It enumerates committed changes from the recorded predecessor commits, excludes Taki task records and
`docs/HANDOFF.md`, and compares current bytes to the final identity. It does not read corpus databases or secrets.

## Review design

| ID | Question and concrete failure stimulus | Pass evidence / disposition |
| --- | --- | --- |
| R01 | Does the current code actually equal the accepted code, and can each reported result be traced to retained evidence? | New identity checks above; W8 evidence and commit checkpoint. PASS. |
| R02 | Are admission, duplicate requests, stale previews/configuration, leases and missing Native capabilities refused before effects? | T05/T10; source review of admission, capability checks and operation ownership. |
| R03 | Does the final proof cover every Bank and actual foreground/background/Native writer, including a last-minute commit? | T03/T06/T07/T13; final fence, source custody and publication guards. |
| R04 | Do repeated cycles preserve identity, current Local mutations, lifecycle, policies, Blocks and mappings without an implicit full-copy fallback? | T08-T10; W5 complete preservation and foreign/baseline refusal cases. |
| R05 | Are admitted intents durable, ordered and revision-bound, with original outcomes after lost replies, crashes and conflicting writes? | T11-T13; deterministic nonempty-queue regressions. Actual corpus queues were empty. |
| R06 | Does recovery select the committed authority after binding failure or restart and keep old Run/Effect references retired? | T12/T14/T16; seven actual main.ts boot/recovery processes plus source guards. |
| R07 | Can emergency takeover seal surviving evidence with no Native/model dependency, retain uncertainty and reject a returning foreign authority? | T02/T15/T16; W6 actual emergency/restart and separate UI confirmation. |
| R08 | Does paired recovery reject incompatible state before writers and retain credential/original-environment limits? | T04/T17 and actual D91 56-table drill. Original-user/DPAPI recovery remains OPEN. |
| R09 | Can a second authenticated Home recover the same operation after timeout/closure, without mutation resubmission or frontend-derived admission? | T18 actual WS/browser and Core-owned action state; packaged WebView2/CSP remains OPEN. |
| R10 | Are historical failure, unknown, superseded and runtime-ready facts kept distinct from operation success and performance claims? | W5/W6 failed histories retained; 120-second bound/unknown reattachment verified; timely corpus ACK not proved. |
| R11 | Do downstream tasks consume completed foundations and preserve Stage 5/6 and deferred boundaries? | Existing B7 draft is stale; refresh before implementation dispatch. D23/D79-D83 remain outside current closure. |

## Retained verification, not new test execution

Final W8 records Shared 555, Core 3784 plus one pre-existing environment-gated skip, Desktop 675 and scoped Rust 5
passing tests; root lint, five workspace typechecks, Desktop build, seven actual boots/recoveries and real WS/browser
checks passed. This continuation verifies source/evidence identity and performs source review; it does not rerun
those suites, restart old wrappers or invoke a model.

W5 retained real-data evidence covers two Banks, 722 Sources/mappings and 1,275 records; 89 invalidated records
include 21 prior invalidations and 68 receipt-backed Local expiry changes. W6 preserves those records and the three
historical unknown outcomes through emergency recovery/restart with zero new Native/model calls. Actual D91 restores
the preserved W5 Hindsight pair, not the emergency Local database. See the original reports for exact provenance.

## Remaining boundaries

- Owner/manual, original environment, packaged WebView2/CSP, original credentials and original-data replacement
  remain unaccepted. D89 belongs to Stage 6; D91 remains globally open despite the successful isolated drill.
- No new original-data authority switch, corpus conversion, paid request, commit, push, finish or archive is implied.
- Non-blocking performance work stays deferred under the existing owner direction.
- Stage 5 requires refreshed requirements/design/execution/context and artifact review before activation.

## Independent review disposition

The independent read-only reviewer found one P2 contract gap. Historical W8 remains valid for its tested cases,
but the new boundary needs a focused reproduction and correction before downstream implementation readiness.

Healthy publication captures `now` in `packages/core/src/memory/transitions/transition-healthy-execution.ts:58`
and does not supply a live `currentTime` to publication. The transaction in
`packages/core/src/db/memory-transition-publication-repo.ts:41` checks the boundary at entry, then installs the
candidate, moves custody and reads the complete publication back. Receipt insertion uses captured `input.now`
in `packages/core/src/db/memory-transition-evidence-repo.ts:58`. After read-back at publication-repo line 71,
there is no final live-clock lease check before transaction return/COMMIT. A later driver boundary can therefore
report expiry after authority has already committed.

Trigger: the executor is valid at entry, but synchronous candidate/install/read-back work crosses `leaseUntil`.
This violates `.trellis/spec/backend/memory-transitions.md:35` and the genuine exhaustion rollback requirement in
`.trellis/spec/backend/memory-transition-publication.md:21`. Synchronous SQLite excludes competing executor
interleaving; this finding does not demonstrate data loss, competing-owner publication or Native fence reopening.
Emergency already has a final live-clock/original-executor/revision guard in
`packages/core/src/db/memory-transition-emergency-publication.ts:87`.

Existing `transition-evidence-context.test.ts:111` tests exhaustion during candidate preparation; its publication
test at line 87 exercises only an adequate budget. Add deterministic expiry at the end of real publication read-back,
assert atomic rollback, then apply the smallest correction. See [W9 plan](stage4-w9-lease-plan-2026-10-07.md).

Other traced admission/capability, queue/restart, emergency and Home boundaries revealed no additional confirmed
defect in this bounded source review. That initial review did not execute runtime tests. R02/R03/R06 subsequently
received the W9 evidence below; the remaining rows retain their documented W8/source-review scope.

## W9 resolution and downstream disposition

The owner approved W9 and later requested interruption recovery. The [implementation](w9-implementation.md) and
[independent check](w9-independent-check.md) now close the final healthy-publication lease gap. The leader accepts
the independent PASS within this bounded automated scope. No unresolved Stage 4 implementation blocker remains
from this review; original/manual/environment acceptance remains separate.

New publication requires a live clock and performs the original-executor/exact-revision check after complete
read-back inside SQLite. Both directions reject exact deadline exhaustion and roll back nonempty custody/queue
with the rest of the transaction; valid publication and old-receipt read-only recovery pass. The original red
2/2 failures are preserved. Independent final regression is 20/20; adjacent integration is 67/67; five workspace
typechecks and root lint pass. Final 11 source identities and all 27 W9 evidence pins match independently.

The complete Core run recorded 3,791 passes, four explicit default-five-second test timeouts and one existing
skip. Only those four test deadlines were aligned with their existing 30-second siblings; that file then passed
7/7 with unchanged assertions. This accounts for 3,795 distinct passing cases plus the existing skip across
the complete run and scoped correction, not a second clean full-suite run. The checker accepted this disposition.

Production lease/heartbeat remain five minutes/30 seconds. No scoped functional evidence required extension;
no performance work, new Native/model/corpus execution, commit, push or archive occurred. Follow the existing B7
planning home and [Stage 5 readiness report](stage5-readiness-2026-10-07.md); first settle its actual configuration
evidence/permission producer and review concrete slice artifacts before new Stage 5 implementation.

## References

- [W8 independent check](w8-independent-check.md)
- [W8 final evidence](w8-final-evidence.json)
- [Commit checkpoint](commit-checkpoint-2026-10-06.md)
- [W5 real-data result](w5-healthy-final-result-2026-10-06.md)
- [W6 emergency/restart/D91 result](w6-final-result-2026-10-06.md)
- [Revised stage allocation](../../09-14-hindsight-integration-completeness-audit/research/plan-review-2026-09-18.md)

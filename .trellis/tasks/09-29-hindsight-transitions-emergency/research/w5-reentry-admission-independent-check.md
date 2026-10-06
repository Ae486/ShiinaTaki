# W5 admission and one-time renewal independent check

**PASS for the parent's first explicitly approved one-time renewal followed by zero-model
staging.** No production logic defect was found. The full new-preview-to-admission path
passes the unchanged 120-second lifetime on the copied corpus. This verdict does not
certify real Native reentry, later maintenance allowances or W5 completion.

## Scope and source provenance

Independent checking covers the parent's 14 production paths, their focused tests/spec/index
changes, and task-only renewal/driver/supervisor integration. The original working pair
stayed stopped and was not opened, inspected or modified. Only the preserved offline input
under `.trellis/.runtime/w5-reentry-stale-5e63660aa04c4eb4816122fcee449a7c` may seed new
disposable derivatives. No real approval, request, Native service, HTTP connection, model,
dependency, Git or task lifecycle action is authorized or claimed by this review.

The implementation source manifest was checked against all 47 entries:
`w5-reentry-admission-source-manifest.json`, SHA-256
`d1a8587bf88015afa62db598bf616e3cab58f167e4c8f582a6f0db30fe06c5e8`.
Its 25 implementation preimages also matched
`w5-reentry-admission-preimages.json`, SHA-256
`d78d185f607684ca4d1cde1f43c1ccad826f2d342c9828e12cdb5069bedd08f0`.
Before reviewer edits, 29 source/spec/index/helper files were retained separately in
`w5-reentry-admission-independent-preimages/`. Earlier reports, RED logs, manifests and
the observer/scheduling and helper-accounting repairs remain separate immutable evidence.

## Production boundary review

The change retains both full admission plans. Inside the operation owner's synchronous
SQLite transaction, a fresh independent evidence context is passed on a local spread of
the handler context. The long-lived `owner.ctx` is not modified. Existing-request lookup
remains first; nontransition handlers keep the original context. The scoped callback
closes before notification or deferred execution on return or exception.

The same optional context is explicitly threaded through the first plan, authority epoch
stamp, second plan and actual full Local/Hindsight binding snapshots. `assertOwner` and
`assertIndependent` reject foreign databases, expired scopes and observer borrowing.
Async/thenable callback results are rejected, and closing clears owned evidence and
projection maps. Preview and execution do not receive an admission context.

Only immutable evidence decoding and pure Bank projections are reused. Every evidence
or projection hit rereads exact row ID, transition, slot and actual body bytes. A caller
envelope with the same ID is not an owned evidence object. Body byte arrays are detached;
returned JSON projections are frozen. The shared key covers all semantic fields, ordered
ancestry/mappings, baseline identities and future input fields, with one variant per Bank.

No selected authority, identity, readiness answer, SQL result or successful plan is cached.
Current publication/receipt/candidate/baseline/attempt/source disposition, queue, custody,
configuration, inventory, current Local policy/Block and runtime publication checks remain
in their original producers. Full binding snapshots retain selected authority and lifetime
semantics. Both plan entry checks remain; both plans now reread stored preview and actual
clock after expensive validation. The production 120-second preview TTL, deadlines,
leases, polling, Native code and budget constants remain unchanged.

## Findings (fixed)

### Stored preview mutation coverage

- File: `packages/core/src/memory/transitions/transition-admission-verification.test.ts`.
- Gap: existing new cases covered elapsed expiry and current-state changes, but did not
  directly prove that the post-work check rereads the stored preview rather than retaining
  its initial object.
- Fix: add a regression that removes the stored preview after expensive identity work.
  Admission refuses with `MEMORY_TRANSITION_STALE`, dispatch stays untouched, and rollback
  restores the preview and operation/intent counts. Production code already handled it.
- The first checker run failed because the new fixture named the wrong deletion trigger;
  migration 055 uses `memory_transition_previews_no_delete`. The test was corrected and
  its 12-case file passed. The initial log is retained as a fixture error, not a reproduced
  production defect or an unresolved failure.

### Full renewal acceptance coverage

- File: task-owned `w5-reentry-renewal-independent-replay.mjs`.
- Gap: the implementation's valid 61.272-second corpus result starts directly at admission
  of a saved preview. Small renewal fixtures plus that result do not measure the entire
  new-preview-to-submit path on the full corpus.
- Fix: add a separate derivative-only full renewal replay using a synthetic approval tied
  to exact retained checkpoint serialization. It obtains an ordinary fresh preview,
  records actual timestamps and monotonic boundaries, runs all renewal checks and durable
  append, then calls the real operation owner. The real persistence callback is required
  before a deliberate transaction rollback, so no dispatch can follow.

## One-time renewal review

Approval loading binds the original request/preview serialization, RETURN anchor, Local
mutation plan and recorded effects, plus checkpoint sequence, payload hash and exact file
bytes. Zod parsing validates shape but does not replace the serialized hashing source.
The supervisor retains exact approval bytes before forwarding them to the driver. The
option is restricted to `run --stage reentry` and grants no maintenance/network allowance.

Before preview, the helper proves the original request absent in operations, intents and
recoveries, rejects orphan or ambiguous evidence, and validates actual completed RETURN
publication, selected Local epoch, policy receipt/snapshot/current record and Block bytes.
The driver uses this read-only check instead of reapplying Local mutations.

On the first replacement path, all full RETURN/Local reconstruction precedes preview.
Ordinary preview performs current identity and readiness before creating its timestamps.
After its await, the helper rechecks original admission absence and reviewed state hashes,
validates the new shape and unchanged expected identity, then saves one explicit
supersession link before submit. These post-preview steps contain no additional full
authority/publication reconstruction. The driver's final missing-operation lookup also
uses only exact request/intent/recovery joins when no admission exists.

A repeated explicit invocation loads the one linked replacement and checks the same
approval bytes/identity. Already admitted replacement work is reconciled as that same
request, including terminal or unknown outcomes. A still-unadmitted replacement must
survive fresh current-state validation and expiry checks; an expired replacement refuses
without minting another. That restart path may be expensive and is intentionally fail
closed. The first-run timing below does not promise expiry-free restart at an arbitrary
later time. Actual recovery after admission belongs to the existing recovery flow.

## Prior evidence reviewed separately

The original corpus result at
`.trellis/.runtime/w5-admission-acceptance-b2c21fe0-fb59-4f96-abe7-a66a3cd3c2a4/result.json`
matched SHA-256 `c7a3e83e1794a60d39a396247578655e511c0fc6c28950607fa970420713b241`.
Its 14 production launch/end hashes still match current source. Actual default Local
readiness returned running/published, both plans completed, final clock was 61.268 s,
and intentional rollback returned at 61.272 s. Counts remained 1 intent, 1 attempt and
8 operations, with zero external/model calls. The real-monotonic saved-time projection
did not alter the stored original preview. This exact admission-only probe was not rerun.

The four previous strip-only boots and broader 71/66-test implementation groups are
historical implementation evidence, not newly executed checker passes. No executable
production source changed during this review, so those boot probes need not be repeated.

## Complete copied-corpus renewal proof

New result:
`.trellis/.runtime/w5-renewal-independent-e8e3d19f-c33f-47bc-85ef-310381bc0d0d/result.json`,
SHA-256 `75661d2e6e645433bcffd968a673632a6d8830420ee95ed73eee8a83eae0adec`.
Command: `node .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-reentry-renewal-independent-replay.mjs`.
Raw output: `w5-reentry-renewal-independent-corpus.log`.

| Boundary | Measured result |
| --- | --- |
| Runtime construction/start before renewal | 38.936 s |
| Full RETURN/Local renewal validation before requesting preview | 150.062 s |
| Ordinary preview, including independent identity/readiness before timestamp creation | 79.318 s total |
| Fresh preview creation to `owner.submit` start | 16.444 ms |
| First actual plan | 45.323 s |
| Second actual plan | 11.540 s |
| Actual Local readiness within the two plans | 3.566 s / 3.587 s, running/published |
| Fresh preview creation through real persistence and rollback | **60.160 s monotonic; 60.160 s wall clock** |

The original 120-second TTL is preserved and both plans use the actual advancing wall
clock. The ordinary preview is created only after its full identity and readiness checks.
Post-preview checks and durable append are measured, not assumed free. There is no clock
freeze, saved-expiry rewrite, readiness substitute, reused observer verdict, omitted plan,
deadline change or repeated approval. The only compatibility response is an explicitly
synthetic test transport response; it supplies no proof or operation outcome.

The sentinel runs after an actual new intent has been persisted inside the real owner's
transaction, then forces rollback before commit/notification/dispatch. Before/after counts
are exactly 1 intent, 1 attempt and 8 operations. Original checkpoint bytes are retained;
the derivative's one synthetic approval and one replacement remain as test evidence only.
All seven preserved inputs and launch/end checked-source hashes match. HTTP/external,
model and dispatch counts are all zero. This derivative is never a real continuation root.

## Verification

All heavy gates were sequential; Vitest used at most two workers. Final case counts are
distinct cases, not the sum of overlapping reruns.

| Gate | Actual result | Evidence |
| --- | --- | --- |
| Admission verification, including new stored-preview corruption case | 1 file / 12 PASS, 18.28 s | `w5-reentry-admission-independent-preview-final.log` |
| Independent projection, evidence lifetime, observer store, both binding implementations and operation kind | 6 files / 25 PASS in the initial selected run | `w5-reentry-admission-independent-regression.log` |
| Renewal, checkpoint/journey and original expiry feedback | 24/24 PASS, 26.821 s | `w5-reentry-admission-independent-helper.log` |
| `pnpm -r typecheck` | All 5 workspaces PASS | `w5-reentry-admission-independent-types.log` |
| `pnpm lint` | Root PASS, no new allowance | `w5-reentry-admission-independent-lint.log` |
| Full corpus renewal through actual admission | PASS as detailed above | new result and corpus log |
| Four MJS syntax checks, supervisor Python AST/Ruff `F,E9`, help and two rejected mode/stage combinations | Expected exits PASS | `w5-reentry-admission-independent-quality.json` |
| Source/evidence/preimage/input/encoding audit | 15 checks total PASS; 47 delivery entries, 25 + 29 preimages, 75 predecessor entries, 7 inputs | quality JSON |

The initial selected Core run had 36 passing cases and the one new fixture failure;
its corrected file passed all 12 cases afterward. There are **37 distinct Core cases**
with passing results at the final source, not 48. The preserved initial fixture log is
`w5-reentry-admission-independent-fixture-initial.log`. No unresolved final test failure
is hidden by the aggregate. Unchanged prior Python model-gate tests and broader Core/boot
groups were reviewed from immutable implementation evidence and were not rerun here.

Lint: **PASS**. TypeCheck: **PASS**. Tests: **PASS**, with the counts and provenance above.

## Findings (not fixed) and release boundary

No confirmed production or first-renewal-path defect remains. One documented fail-closed
recovery limit is material: an appended but still-unadmitted replacement cannot be
renewed again. Its restart branch repeats full current-state validation within its
remaining original TTL. That validation measured 150.062 s before preview in this run;
therefore the current full-corpus restart path is expected to refuse an unadmitted
replacement as expired, even where the tiny fixture can reuse it. This branch was not
represented as a successful full-corpus crash recovery test. An admitted replacement
uses exact durable operation reconciliation and the separate transition recovery flow.
Do not reset history or mint another approval if this limit is encountered; it needs a
separately reviewed disposition. It does not invalidate the measured first-run path.

The parent may now author the exact approval from its current stopped-pair evidence and
run the existing interpreter/supervisor with `run --stage reentry --submission-cap 329
--reentry-renewal <parent-reviewed-approval.json>`, omitting maintenance approval. The
old original request must remain expired/unadmitted and unchanged; the intended Local
edits must remain applied exactly once. The next gate must independently verify actual
new Bank A plan, Core unknown, Native incomplete/current owner, clean staged shutdown and
unchanged cumulative model count 301. This check creates no real approval or request.

The only reviewer change to an existing executable file is the added regression in
`transition-admission-verification.test.ts`; production and helper implementation remain
byte-identical to delivery. New standalone replay and audit documents/logs capture the
missing acceptance evidence. Existing specs already state the executable context/TTL/
renewal contracts, and colocated tests are implicit in their indexes, so no spec/index
change is needed for this review. No lint allowance, template, dependency or platform
configuration changed. W5 real acceptance, W6-W8 and manual acceptance remain incomplete.

Final immutable checked inventory: `w5-reentry-admission-independent-source-manifest.json`.
Its own hash and post-write readback count are reported separately to avoid self-hashing
or including a still-growing stdout log.

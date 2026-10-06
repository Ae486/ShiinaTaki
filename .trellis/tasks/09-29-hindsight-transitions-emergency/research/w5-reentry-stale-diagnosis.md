# W5 unadmitted reentry expiry diagnosis

## Verdict and authorization boundary

The copied real corpus reproduces `MEMORY_TRANSITION_STALE` because one synchronous
admission repeats expensive independent authority/publication verification until the
saved preview's normal 120-second lifetime has elapsed. The rejection originates in
the second `plan`, called by `persistAdmission`. The outer operation service converts
the inner error into `MemoryOperationRefusal`, hiding that origin from the driver log.

Diagnosis is complete. No production source, existing journey helper, earlier report,
manifest, timeout, request, preview or original runtime pair was changed. Source repair
and pending-request renewal are proposed below and require a new parent-approved scope.
This report does not claim successful real reentry, Native maintenance or W5 acceptance.

## Reproduction and preserved identity

Only the parent-supplied offline evidence directory was read:
`.trellis/.runtime/w5-reentry-stale-5e63660aa04c4eb4816122fcee449a7c`.
Every executable corpus probe used a new `w5-stale-probe-*` SQLite derivative.
No Native data, actual credentials, real model, PG process or HTTP service was used.

| Identity | Preserved value |
| --- | --- |
| Request | `9a90f97e-a831-48b2-95e5-34f740bb8d2d` |
| Preview | `784eeb71-7680-46bb-a1d8-8f0aec472797` |
| Preview created | `2026-10-04T10:16:09.933Z` |
| Preview expires | `2026-10-04T10:18:09.933Z` |
| Actor / kind | `w5-owned-operator` / `transition.reenter-hindsight` |
| Completed RETURN operation | `ce841c61-d207-4f51-b1fd-51cd42ed9d9e` |
| RETURN transition | `df47f32c-48a8-47bc-9792-2e24e8642084` |
| RETURN receipt | `e173dffd3612e5932f50a1df5ae7c1c1b4f7ee3d269dce9a11828debd77a8469` |
| Selected Local epoch | `afb2053e-8bcd-4322-8573-0a447d560bb8` |
| Diagnostic SQLite SHA256 | `1ac12212606d3280d85bf6364f355112a1aef4f69b7addb7b2510afba68fb632` |
| Diagnostic SQLite bytes | `291049472` |

The parent's actual source SQLite hash is separately recorded as
`9e257fd0b553ef7ccc0e148af822620879d7fee7a6bf64aa99842fc07475d1d3`.
It is not the diagnostic copy hash. The final audit checks all seven copied files against
`copy-manifest.json`, without opening the parent's actual pair.

Parent evidence records completed Local policy/Block changes and RETURN, zero new
reentry intent/attempt/Native plan, cumulative model count 301, and retained prior
92 steps / 769 actions. This diagnosis independently verifies the copied Core counts
and zero probe calls; it does not re-open Native storage to re-verify its old totals.

## Ranked hypotheses and measured evidence

The four predictions were shared before discriminating probes:

| Hypothesis | Disposition |
| --- | --- |
| Repeated plan/authority/readiness work crosses preview TTL | Confirmed by real elapsed-clock probes; fixed valid time passes the same request through persistence. |
| Local post-preview state drift | Not the reproduced cause: both full identity checks pass when only time is held valid. |
| Runtime binding is unready | Not the reproduced cause: actual composed Local runtime readiness returns `true`. |
| Actor, request or configuration mismatch | Not the reproduced cause: the saved original request passes exact preview/identity checks and persistence at valid time. |

Times below are measured wall-clock work, not estimates. Elapsed probes project real
monotonic elapsed time onto the original creation timestamp on their disposable copy;
they do not edit preview timestamps. The frozen probe intentionally removes expiry
only as a diagnostic control, not as a production workaround.

| Probe | First plan | Second plan begins | Result |
| --- | --- | --- | --- |
| Saved request at expiry + 1 ms | Refuses immediately | Not reached | 4.17 ms; initial preview expiry check. This alone cannot explain the original fresh failure. |
| Fixed valid time; readiness substitute `true` | 83.744 s, passes | 157.697 s | Second plan 83.903 s, passes; reaches persistence at 241.608 s, then deliberate diagnostic rollback. |
| Real elapsed time; readiness substitute `true` | 85.829 s, passes | 162.296 s | Second plan refuses in 2.30 ms; preview is 42.296 s past expiry. |
| Real elapsed time and actual Local runtime readiness | 162.012 s, passes | 236.900 s | Actual readiness 75.498 s, `true`; second plan refuses in 2.15 ms, 116.900 s past expiry. |

The full-runtime probe composes/starts the offline Local runtime in 76.718 s before
starting the admission clock; that startup time is excluded from the 236.902 s
admission duration. The intermediate operation-owner authority read accounts for
approximately 74.877 s. The first plan alone already exceeds 120 seconds with actual
readiness, so merely deleting the second plan would be an unsafe and incomplete fix.

The fixed-time run executes 48,967 SQL calls, totaling 15.449 s inside SQL calls versus
241.608 s total. Most elapsed cost is outside the SQL calls, consistent with repeated
full decoding, validation, projection and hashing of the same immutable evidence.
This is aggregate instrumentation, not a sampled CPU profile of each individual function.

All four result files record unchanged counts `{intents: 1, attempts: 1, operations: 8}`,
source preservation and zero external/model calls. Those counts describe old RETURN
history, not successful new reentry admission. The successful frozen-time control
deliberately throws before transaction commit so no transition dispatch occurs.

Evidence files under `.trellis/.runtime/`:

- `w5-stale-probe-expired-57a89632-9fa5-4b0d-8e55-291db9ed70e4/result.json`
- `w5-stale-probe-fresh-cafb7db5-6c29-49bf-8561-ac288349889f/result.json`
- `w5-stale-probe-elapsed-294a250e-b165-42f6-8dbc-e7796a121986/result.json`
- `w5-stale-probe-elapsed-full-fbbd19a8-76f7-4d0e-a1ac-9dc612ec3256/result.json`

## Exact source chain

1. `memory/operations/memory-operation-service.ts:112` calls `handler.admit` within
   the same synchronous transaction as insertion and transition persistence.
2. `memory/operations/memory-operation-kind-transition.ts:20` calls the first full
   `ctx.transition.plan`; `transition-healthy-service.ts:32` checks preview expiry,
   then current identity and runtime readiness at lines 35-38.
3. `transition-current-identity.ts:38` calls `readMemoryAuthoritySelection`.
   `legacy-activation-repo.ts:23` calls the full independent publication reader when
   the marker has a transition receipt. That reader creates its own evidence context
   and rebuilds/verifies the candidate through `memory-transition-publication-reader.ts:62`.
4. `boot/memory-transition-boot.ts` readiness calls the actual binding snapshot.
   Local and Hindsight snapshot implementations again call full authority selection.
5. `memory-operation-service.ts:114` independently reads full authority selection
   once more to stamp the operation's epoch.
6. `memory-operation-kind-transition.ts:25` calls the second full plan from
   `persistAdmission`. The original stack is:

```text
assertTransitionPreviewRequest (db/memory-transition-preview-repo.ts:28)
plan (memory/transitions/transition-healthy-service.ts:32)
Object.persistAdmission (memory/operations/memory-operation-kind-transition.ts:25)
memory/operations/memory-operation-service.ts:115
```

All paths above are relative to `packages/core/src/`. The wrapper at service line 121
then exposes the expected public error code while the enclosing transaction rolls back.

## Proposed minimal production repair (not implemented)

Create one independent verification context inside each synchronous transition-admission
transaction. Share only verified immutable native artifacts and pure Bank projections
within that context. Continue every mutable read and every current-state/expiry check.
Close the context before the transaction callback returns, on both success and failure.

Use explicit context threading through the existing full runtime snapshots. This is a
larger signature change than composing detached binding metadata in boot, but keeps the
existing full authority/binding boundary in one place and is easier to verify.

| Source file(s), relative to `packages/core/src/` | Exact responsibility |
| --- | --- |
| `memory/transitions/transition-evidence-context.ts` | Add context-local pure Bank projection reuse. Validate context owner/lifetime and evidence object ownership, recheck actual evidence bytes before every hit, use a complete semantic key, freeze returned JSON, isolate mutable byte views, and clear projection storage on close. No cross-boundary store. |
| `memory/transitions/transition-observation-store.ts` | Export the existing pure projection-key computation for reuse, or extract that computation into one small shared module. Do not expose or reuse the observer's store in admission. |
| `memory/legacy-migration/legacy-activation-repo.ts` | Accept optional independent context in authority selection and pass it to the existing complete publication reader. Keep legacy/first-activation checks unchanged. |
| `memory/transitions/transition-current-identity.ts` | Thread optional context into authority selection. Continue discovering current Local rows, policies, Blocks, custody, setup/inventory and baseline joins on every call. |
| `memory/operations/memory-operation-transition-storage.ts` | Add optional context parameter to the internal driver `plan` signature; retain storage identity and persistence checks. |
| `memory/operations/memory-operation-contract.ts` | Define admission-only ephemeral verification access for handler calls. It must not become durable state or an execution-time cache. |
| `memory/operations/memory-operation-service.ts` | Inside transition admission only, create a fresh context and a local derived handler context; pass it to both plans and the epoch-stamping authority read. Never mutate the shared long-lived `owner.ctx`. Close before post-commit notification or execution. |
| `memory/operations/memory-operation-kind-transition.ts` | Forward the same transaction-local context to both plan calls. Retain the second plan and its current-state guards. |
| `memory/transitions/transition-healthy-service.ts` | Assert independent context, thread it into identity/readiness, preserve entry expiry/actor/request checks, and recheck the actual clock after expensive validation before successful admission returns. Do not freeze `deps.now`. Preview and later execution start fresh. |
| `memory/transitions/transition-healthy-execution.ts` | Extend the readiness dependency signature with optional context; existing execution calls continue to omit it. No context survives an await or recovery/restart. |
| `boot/memory-transition-boot.ts` | Forward optional context only through the independent `ready` path to full binding snapshots. Preserve the separate observer path and all availability/lifetime/binding checks. |
| `memory/runtime-composition.ts`, `memory/local-runtime-binding.ts`, `memory/hindsight-runtime-binding.ts` | Thread optional context through full snapshot signatures to authority selection. Preserve publication presence, current state, epoch, lifetime and flush semantics; no detached metadata is promoted into proof. |

`db/memory-transition-publication-reader.ts` already accepts an independent context and
rejects an observation context. Its complete receipt/proof/candidate/baseline/attempt,
queue, custody, checkpoint and selected-epoch joins must remain intact. No SQL verdict,
selected authority, readiness boolean, complete identity or passed plan is memoized.

The context must reject a different database, a closed instance, an observer instance
and async/thenable escape. A new transaction, preview, await, process or restart always
starts independent verification. No lease, request timeout, polling interval, maintenance
deadline or preview TTL is enlarged. No dependency, migration or Native source change
is proposed. Existing cohesive length exceptions follow the user's stated rule: do not
split one responsibility merely to satisfy a line count; keep any adjustment narrowly scoped.

## Separate pending-request renewal (not implemented)

Even after the performance fix, the saved request above is now expired and cannot be
resubmitted as-is. A finite, explicit task-only supersession is required before real
continuation. It is separate from the production performance repair and is not a normal
request retry or a transition recovery request.

Proposed helper scope: add a dedicated `research/w5-reentry-renewal.mjs` plus its targeted
tests; integrate the explicit option into `w5-reused-driver.mjs`. Reuse the current
`w5-reentry-journey.mjs` exact admission lookup and `w5-journey-checkpoint.mjs` append/history
writer without weakening their contracts. Preserve the independent checker's helper fixes.

1. Require parent-reviewed exact old request/preview IDs, immutable request hash and
   evidence checkpoint hash. Permit only this one unadmitted healthy reentry renewal.
2. Verify the exact request has no row in operations, transition intents or recoveries;
   reject ambiguous/orphaned rows and any admitted, running, terminal or unknown outcome.
3. Revalidate the completed RETURN anchor, selected Local epoch and exact already-applied
   policy receipt/record and desired Block revision/body. Do not apply new mutations.
4. Obtain a fresh normal preview with the same intended kind/confirmation and current
   verified identity. Allocate new preview and request IDs; keep the normal 120-second TTL.
   Recheck absence of old admission after the async preview and before submission.
5. Append the new submission with an explicit old/new ID and hash linkage, reason,
   timestamp and approved renewal identity. Retain old request/preview bytes and every
   checkpoint history entry unchanged. Persist this link before `owner.submit`.
6. On restart, reconcile the exact new request first. Do not create another replacement
   silently, reuse old IDs, rewrite old expiry, or renew any already admitted request.
   A repeated explicit command reuses its one linked replacement or refuses.

This uses task checkpoint evidence rather than changing public request schemas or adding
a global renewal API. No renewal was minted or performed during diagnosis.

## Verification and future acceptance

Executed fast diagnostic command:

```text
node --test --test-concurrency=1 .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-reentry-stale-fast.test.mjs
```

Result: 2/2 pass, 7.448 s total (`w5-reentry-stale-fast.log`). Both cases invoke the real
Core preview and owner admission after a tiny synthetic RETURN and actual policy/Block
edits. Advancing only the synthetic admission clock by 120001 ms after the first plan
reproduces the second-plan expiry and verifies no inserted operation/intent survives.
With no clock advance the synthetic reentry completes. These lock down the expiry and
rollback semantics; they are not a performance fix acceptance test.

After scope approval, required repair checks are:

- Verify immutable decode/projection reuse across both plans, owner epoch stamping and
  actual readiness within one transaction, and fresh work in the next boundary.
- Inject evidence-byte/identity mutation, changed projection input and returned-object
  mutation; reject or recompute correctly. Observer/different-DB/closed/async contexts
  must refuse. Run existing publication/observation corruption regressions.
- Change authority, receipt, config, inventory, Local policy/Block, custody, queue or
  runtime publication between checks; retain truthful refusal and atomic rollback.
- Preserve real expiry before admission, between plans, and after expensive validation;
  exact duplicate request admission remains idempotent and failed admission dispatches nothing.
- Test explicit renewal success, replay, crash before/after append/submit, wrong IDs/hashes,
  changed anchor/mutation and admitted/orphan/ambiguous old request refusal.
- Re-run the actual corpus on a fresh diagnostic derivative with real Local readiness,
  original 120-second expiry and monotonic elapsed time. Require successful pre-dispatch
  admission followed by intentional rollback within that window; report actual first plan,
  readiness, second plan and total times, with zero model/external calls and unchanged inputs.
- Run affected Core tests/typechecks/lint and helper tests. Record any cohesive length
  exception explicitly; no broad reruns without a new concern. Real Native reentry remains
  a later parent-owned staged acceptance after these independent checks.

Final syntax/encoding/whitespace/input-preservation verification is recorded by the
separate `w5-reentry-stale-audit.py`, `w5-reentry-stale-audit.json` and
`w5-reentry-stale-diagnostic-manifest.json`. Earlier manifests remain immutable.

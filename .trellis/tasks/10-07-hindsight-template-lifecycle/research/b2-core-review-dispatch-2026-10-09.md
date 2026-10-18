# B2 Core independent review dispatch

The owner approved continuation on 2026-10-09. The previous current-agent pause is superseded. Reuse this
in-progress task; Core independent review and current-source reconciliation precede B3, then complete the
whole-5B gate and stop before 5C. No additional implementation/scheduling approval is required within that scope.

## Verified entry

`b2-resume-readback-2026-10-09.json` checks 2972 unique paths with no mismatch, covering Core's 101-file release,
1550 Core/Shared and 391 consumer inputs, Native's 242 files/seven Core label files/the lifecycle spec, and all
912 generated artifacts. Both repository HEADs and the original session binding remain unchanged.
Use `b2-core-source-current-03.json`, `b2-core-read-check-input-05.json`, `b2-core-consumer-check-input-01.json`,
`b2-core-implementation.md` and `b2-batch-handoff.md` for the released Core baseline. Native independently
PASSES in `b2-native-label-independent-review.md`; do not reopen unchanged Native generation or label tests.

## Ownership

Restore the former B1 Core checker for this new independent B2 assignment. It is already the checker and
must review/fix directly, without nested dispatch. Its write scope is the released Core lifecycle/runtime/
operation/boot/Shared/migration-059 and two existing Desktop mapping files in the 101-file manifest, their
necessary focused tests and indexes, and corresponding Core spec sections. Historical migration sources are
immutable. Read adjacent production paths to verify integration rather than limiting review to an artificial diff.

Native source, generated artifacts and the original seven Core label files remain read-only; send any concrete
cross-scope defect to root for ownership coordination. The checker may update the Core contract portions of
`hindsight-template-lifecycle.md` when a verified fix requires it, preserving the accepted Native N1/N2 contracts
and clearly recording that spec delta for reconciliation. Root owns task metadata, dispatch and combined acceptance.
Other work may coexist in the repositories; never revert another owner's or preexisting W9/5A/B1 changes.

## Risk-based review

Use `review-plan.md`'s B2 contract and the final implementation report, then inspect real source and evidence.
Prioritize these connected boundaries, grouping their helpers into one substantive B2 check:

1. Durable original request IDs/Bank set, executor ownership/expiry/checkpoints, Native response loss, partial
   application, failed/unknown status, physical SQLite reopen and exactly the original-plan recovery path.
2. Actual hold admission before runtime construction/captures/live reads/reflect/writers/provision/operations,
   source drain and preserved frozen Run/primary witness behavior; no remote I/O inside synchronous SQLite.
3. Final read-back and live lease/config/secret/epoch/full Bank identity guards, atomic rollback of every
   publication/default/readiness/receipt/hold change, and post-commit binding-only recovery without Native replay.
4. Actual offline W6 takeover with hung work, complete old-epoch inventory/quarantine, rejected late callbacks
   and no implicit revival after restart. Check the no-hold query correction and existing final guard assertions.
5. Scope defaults, fresh provisioning/occupancy races/lost-create-ACK/reopen, explicit none and old v1 paths.
   Verify untracked compatibility without weakening corrupt managed identity/base/selection rejection or
   inheriting ownership across Native incarnations.
6. Actual authenticated dispatcher/two-WS original operation observation; exact Core-produced recovery admission;
   bounded one-child derived reads with no effects, correct current versus recorded evidence, all post-await
   identity/secret checks, compatibility ABA and stop/late-result cancellation before closed-DB access.

Add meaningful adversarial/positive coverage for demonstrated gaps, not tests that merely mirror helpers.
Self-fix concrete defects in scope, retain red evidence, rerun affected dependencies and ensure scoped lint/types.
Reuse unchanged passing checks; do not repeat the full Core repository after every helper or sum overlapping runs.

## Resources and release

The checker initially owns the only heavy-check slot. Tests, lint, types, builds and generation remain serial,
with at most two Vitest workers. Only owned fixtures, fake/fail-on-call providers and existing isolated runners
are allowed; no original service/data/credentials, paid models, new dependencies, performance work or Git lifecycle.
When source review or static fixes need time, explicitly return the slot if another approved owner needs it.

Write `b2-independent-core-review.md` with scoped findings/fixes, actual commands/exits, source identities,
reused evidence and isolation/cleanup. Freeze the reviewed source plus changed dependency inputs, release
ownership and report the verdict to root. Root reconciles it with the accepted Native scope before B3 dispatch.
Do not independently start B3 or mark whole B2/5B complete.

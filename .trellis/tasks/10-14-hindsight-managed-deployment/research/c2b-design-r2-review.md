# C2b design R2 delta review

Date: 2026-10-15. Reviewer: /root/c2_design_check. Scope: PLAN ONLY, targeted delta review.

**PASS for the revised plan.** R1 and its prerequisite-ordering bindings are resolved in the reviewed text. This clears the design correction only: broad trusted-lookup/setup implementation remains gated on the actual offline-image inventory and minimal real producer proof. No implementation or runtime acceptance is established.

## Reviewed inputs

| File under research/ | Bytes | SHA-256 |
| --- | ---: | --- |
| c2b-plan.md, revised | 41862 | 0e4bdf03c903d6bbdca4d0bbfc187de14bb6c9fd8119b816bbfa7e69db0cd803 |
| c2b-design-review.md, preserved | 11520 | 44e592ce05aaf5665c859333f1cf6d0e8703c84e05a645ab672c9bf11ed67b76 |
| c2b-design-review.json, preserved | 10295 | fb1b5e44b3f69ff52032a5e4870bed3b964d1c04461f153ec4337ca084de8b7c |

The original review applies to plan SHA-256
`bb569d33bdd1e31a6672aeff87acfab5383b477316453cc3c7dcb6fed329eafa`.
Its CORRECTION_REQUIRED decision and both report files remain unchanged. This R2 result applies only to the revised plan above.

## Findings (fixed)

- **File:** c2b-plan.md:325-366 and :377-415.
- **Issue:** Original R1 requested a durable hold before a real immutable plan could exist, despite the existing plan-backed foreign keys and recovery read.
- **Fix by the plan author:** The existing connection-row capsule now owns the pre-plan phase; operation-bound reservations and original dispatch/known Bank facts precede any real plan. Actual Bank/snapshot identities are required before one checked transaction creates the immutable plan/admission/executor/hold and transfers the capsule. Rollback retains the pre-plan owner without an unheld interval. Reopen and explicit recovery distinguish a legitimate missing pre-plan row from a missing/inconsistent plan-backed row. No placeholder, foreign-key relaxation, new ledger or generic hold framework is introduced.

## Findings (not fixed)

None in the requested R1/order delta. No new requirement or wider source finding is added.

## Targeted checks

| Binding | Revised plan evidence | Result |
| --- | --- | --- |
| Pre-plan ownership and transfer | :325-349 records real generations only after return, claims capsule/producer progress together before Bank mutation, records dispatch before send and transfers to the real plan-backed hold atomically. | PASS |
| Missing-plan recovery | :391-408 classifies the capsule before readTemplatePlan, retains exact facts, and claims one current recovery operation by capsule revision. A never-dispatched target may receive its first dispatch; a known Bank requires exact recorded identity. Unknown creation stays unknown without retry, name-based adoption or a replacement request. :410-415 preserves original operation settlement and exact publication/result identity. | PASS |
| Shared admission and effect guards | :361-366 requires the memory-operation guard, direct setup and Run-owned deployment start/resume to consult the same capsule/hold. Deployment checks apply before admission and dispatch; capsule acquisition also refuses an existing conflicting deployment mutation. | PASS |
| Existing idempotency owner | :295-308 explicitly places same-request lookup in handler.existing, before guard/admit in the existing SQLite admission transaction, and uses the exact operation result/in-flight owner. This matches the already inspected memory-operation-service.ts:118-123; no new registry or scheduler is proposed. | PASS |
| Prerequisite order | :100-106 and :428-436 require exact offline installed-image/cache facts first, then only the minimal actual producer, then broader lookup/setup. The producer must prove ordinary migrations/authentication, listener/resource identity, checked API plus PG stop and same-volume authorized startup. DB-only or source-only evidence cannot open consumer slices 3-4. | PASS |
| HTTP verification timing | :215-220 places mapping/routes/waiting checks before inject and actual authenticated host-loopback HTTP after the independently admitted API launch, before publishing a usable reference/setup. The former admission/reachability cycle is removed without adding a canary service. | PASS |

The text delta was compared against the original frozen plan retained by this reviewer. Its 15 changed blocks are confined to the requested correction, hook clarification, gate ordering and corresponding status/reference/check-list updates. The original source survey and accepted evidence remain the basis; they were not repeated.

## Verification

- Frozen input hashes: matched; original CORRECTION_REQUIRED reports preserved.
- Lint: not run — PLAN ONLY; no executable change.
- TypeCheck: not run — PLAN ONLY; no executable change.
- Tests/build/Docker: not run — outside this targeted review.
- Reviewer writes: only c2b-design-r2-review.md and c2b-design-r2-review.json.
- No code, plan, readiness, spec, database fixture or runtime resource was modified.

## Release boundary

Root may continue with the plan's next prerequisite gate under the existing authorization. This design PASS does not admit broad consumer work before the real producer gate passes, and does not establish C2b completion or owner manual acceptance. Preserve the original reports and associate subsequent source/runtime evidence with the revised plan hash.


# C2b design review

Date: 2026-10-15  
Reviewer: /root/c2_design_check  
Decision: **CORRECTION_REQUIRED**  
Scope: PLAN ONLY; the three inputs below were frozen for this review.

The proposed real Native producer and positive managed initial setup are a viable direction at the source-contract level. One implementation-blocking ordering conflict remains: the existing template hold requires a real immutable plan, while this setup must hold ownership before creating the Banks needed to construct that plan. Resolve R1 using the already proposed connection-row capsule, then retain the prerequisite sequence below. No runtime feasibility or C2b acceptance is asserted.

## Frozen inputs

| File in research/ | Bytes | SHA-256 |
| --- | ---: | --- |
| c2b-plan.md | 38003 | bb569d33bdd1e31a6672aeff87acfab5383b477316453cc3c7dcb6fed329eafa |
| c2b-readiness.md | 16549 | 289d1891f1ec82cd0b37e126fe8f14147beadb5e677d5d3346f1234a2fee06be |
| c2b-native-producer-readiness.md | 18788 | ea7fbf56504d818b758eed52b350125df8b2f3126746d5a8251aeef5cbc63ba7 |

The companion JSON records the inspected primary source bytes and hashes. These identify the source basis of this design review, not an executable artifact or current runtime.

## Findings (fixed)

None. The plan and source files remained frozen; this review writes only its Markdown and JSON reports.

## Findings (not fixed)

### R1 — Pre-plan initialization ownership cannot use the existing template hold

- **File:** c2b-plan.md:317-327 and :368-376.
- **Issue:** Step 1 acquires a durable hold in the existing template owner before Step 2 creates the real Banks. The plan also correctly forbids materializing its immutable application document before receiving real Bank/snapshot identities. Those requirements cannot use the current hold/admission storage unchanged.
- **Source evidence:** [migration 059](../../../../packages/core/src/db/migrations/059-hindsight-template-execution.ts), lines 33-50 and 94-100, makes holds and admissions reference a real hindsight_template_plans row. Reservations separately reference the original memory operation and can precede that row. [template-plan-store.ts](../../../../packages/core/src/memory/hindsight/template-lifecycle/template-plan-store.ts), lines 29-49, inserts the real plan before its executor, hold and admission; its recovery branch at line 46 immediately reads the existing plan. A reserved plan ID alone cannot satisfy either path.
- **Consequence:** A literal implementation either fails the foreign key, introduces a fake immutable plan, or leaves the initial Bank effects without the promised durable conflict guard. Reopen before plan creation also cannot enter the present template.recover path unchanged.
- **Minimum correction:** Use the already proposed bounded managed-setup capsule on hindsight_connection_state as the pre-plan hold. Bind it to the original operation, attempt, reserved plan/reference identities and admitted guard before any Bank mutation. Keep pre-plan dispatch and known Bank facts in the existing operation producer/capsule, with reservations in the existing operation-bound reservation table. Once real Bank/snapshot identities exist, one checked SQLite transaction must materialize the real immutable plan and transfer active ownership into its existing template hold; do not expose an unheld interval.
- **Recovery binding:** Define the missing-plan capsule case explicitly before routing to readTemplatePlan. Boot only retains/classifies original identities and facts. Any explicit continuation must remain bound to that original setup owner; unknown Bank creation remains unknown without exact ownership evidence and cannot be retried or adopted from a matching name/empty Bank. Plan-backed continuation then uses the existing executor/result-before-retry mechanism with the new purpose.
- **Admission binding:** memory-operation-template-guard, direct managed setup and deployment start/resume must consult the same active hold state. Deployment work uses the Run owner and does not automatically pass through the memory-operation guard. Preserve the original guard across both pre-plan and plan-backed phases.
- **Scope:** No placeholder plan, relaxed historical foreign key, new ledger, general hold framework or mutation of old immutable plan JSON is required. The capsule fits the proposed additive nullable connection-row column; historical rows remain NULL.
- **Disposition:** Root agreed with this minimum correction. The plan author must incorporate it after this report releases; the frozen input reviewed here remains correction-required.

## Prerequisite sequence

These are ordering bindings for the plan's existing slices, not a new probe matrix.

| Order | Required result before progressing | Boundary |
| --- | --- | --- |
| 1. Exact image offline inventory/cache gate | Verify the installed Native/compatibility, Python/SDK/tokenizer, PostgreSQL tools/extensions and actual cl100k_base cache bytes/hash/effective unprivileged path. Missing or inconsistent inputs stop before API import, SQL or listen; no download/fallback repairs the gate. | Establish these facts before broad source work or the first API run. Source checkout files and Dockerfile intent are insufficient. |
| 2. Minimal actual producer vertical slice | Implement only the fixed API child and necessary V2 Host/network/observation wiring, then prove ordinary API migrations and authentication, actual listener/PID/resource/provider-lineage binding, checked API plus PostgreSQL shutdown, and a fresh authorized startup on the same volume. | The existing DB-only result cannot prove the API lifecycle. A failed producer gate prevents broad consumer integration. |
| 3. Positive consumer integration | After the producer gate passes, implement trusted lookup, canonical-local setup purpose, corrected capsule/hold transition, exact operation idempotency, atomic publication and original-identity recovery. | Completion requires two real verified Bank definitions and configured B3 through the admitted producer. A bridge that always refuses managed setup is incomplete. |

Clarify c2b-plan.md:210-212: fixed network/port mapping, namespace routes and the waiting state can be checked before inject. Actual host-loopback HTTP reachability can only be proved after one legitimately admitted API launch, and must pass before a usable reference or setup is published. Do not make API admission depend on an HTTP response from an API that admission has not yet allowed to start, or add a separate canary service to work around that ordering.

Retain accepted C1, R2 and database evidence without rerunning their unchanged matrices. C2b still needs its own actual API stop/restart proof. The concrete producer fixture/resource manifest remains a later reviewed input, with original data, real models and unrelated daemon/workload effects excluded.

## Source checks supporting the remaining design

| Area | Inspected path and conclusion |
| --- | --- |
| Real API, no inference | Native server.py:28-77 constructs the ordinary MemoryEngine/ASGI application. embeddings.py:672-715 honors explicit positive dimensions without the discovery request, but encode remains a model request. The fixed none LLM, OpenAI placeholder dimensions, RRF, clean environment and disabled worker/maintenance profile is plausible only with the offline gate and no-inference paths enforced. maintenance.py:119-148 supports disabling the scheduled jobs. |
| Positive template installation | Native template_apply.py:32-72 checks original receipts first and requires model/task providers only for nonempty refresh. template_mutations.py:115-128 creates uncomputed definitions, while template_initialization.py:16-87 provides genuine pristine initialization proof. refresh=[] can therefore install definitions without pretending that a refresh or any of the six model slots succeeded. |
| Existing durable operation owner | memory-operation-service.ts:110-147 already calls handler.existing inside the admission transaction before guard/admit, and :155-170 owns the in-flight execution. This supports the planned same-request lookup and exact-result wait without another scheduler. memory-operation-kind-setup.ts currently routes both surfaces through B3; the new lower-level managed execution entry avoids recursive normalization. |
| Purpose and real local authority | template-plan-guard.ts:35-59 and template-executor-store.ts:30-48,76-84 currently enforce the Hindsight runtime purpose. A purpose-specific canonical-local branch is required. legacy-activation-repo.ts:20-35 already requires real active epoch/snapshot/activation facts for canonical-local; no synthetic epoch or fabricated checkpoint is needed. |
| Atomic publication and reopen | template-publication.ts:28-47,59-64,79-93 currently publishes runtime checkpoints/admission and advances the connection revision. The new setup participant must share B3's transaction and return the committed revision. hindsight-connection-repo.ts:54-66 supplies the current CAS seam; hindsight-setup-recovery.ts:14-29 currently clears interrupted state, so managed capsules must receive the explicitly distinct retention/recovery treatment. |
| Producer provenance and compatibility | Keep c2a-fake-v1 bytes/digest domains unchanged and add the versioned profile/registration/observation through Shared, Host and required Shell mirrors together. The consumer must join actual owner records, endpoint mapping, PID/listener and authenticated manifest/provider lineage. An original unknown Run plus a completed fresh authorized startup is a valid proposed path; an unknown current inject cannot become completed evidence. |

These are inspected design seams, not claims that the proposed source changes already exist. In particular, hindsight-setup-service.ts:212-222 currently refuses managed setup, and the existing template runtime/publication paths cannot be used unchanged for canonical-local initialization.

## Tests and specification follow-through

After the plan correction and producer gates, use focused tests for pre-plan admission conflict/reopen, atomic hold transfer, uncertain Bank creation, same-request idempotency, guarded publication and original result recovery. Preserve exact V1 digest compatibility and exercise the real method wiring for both setup surfaces. Final positive evidence must use the real Native API and PostgreSQL. Do not repeat the 182 unchanged source cases or replace producer evidence with task-only DB tests.

Synchronize the existing managed-deployment, template-lifecycle and affected setup/operation specs alongside implementation: new profile/provenance, the narrow initialization purpose, capsule ownership/transfer and publication/recovery semantics. No specification was changed during this frozen design review.

## Verification

- Lint: not run — PLAN ONLY; no executable source change.
- TypeCheck: not run — PLAN ONLY; no executable source change.
- Tests/build/runtime: not run — excluded from this review authorization.
- Review basis: task/spec context and actual named Core/Native source paths; frozen document identities recorded above and source identities in the JSON companion.
- C2b acceptance: not established. No runtime gate, manual acceptance item or C3 model application is marked passed.
- Release: the author may now make the minimum R1 and gate-ordering edits. Follow-up review should compare those changes and their changed inputs; the inspected source survey need not be repeated.


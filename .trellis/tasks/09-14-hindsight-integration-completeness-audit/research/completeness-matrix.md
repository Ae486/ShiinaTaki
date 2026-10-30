# Accepted-Design Completeness Matrix

Source audit: 2026-09-14 through 2026-09-15; delivery review: 2026-09-16. Scope: the existing Hindsight parent R1-R10, later G1/D77/D78/B6 rulings, B7 operations, and the
memory-related part of multi-endpoint use. This is an implementation/reachability/evidence audit, not product acceptance.

The main remaining work is a set of real operation and lifecycle gaps. Existing providers, storage, import/proof,
checkpoint recovery and policy preservation are substantial implemented foundations. They do not make the complete
setup, repeated switching, administration or multi-window operation journeys usable by themselves.

The [2026-09-18 current-code recheck](source-recheck-2026-09-18.md) confirms the principal gaps and refines A11/A18/A38.
The 54 entries remain a requirement/capability ledger, not a count of 54 missing features or newly passed acceptances.

## Reading the matrix

- Implemented means the named capability is present, not that every dependent journey passed acceptance.
- Internal means a callable substrate/test harness exists but the required production operator flow is unconnected.
- Missing/partial identifies concrete remaining behavior; static risks are distinguished from reproduced failures.
- Deferred/out of scope retains the owner's previous decision. No item is silently converted into a new B7 prerequisite.
- C01-C16 are concrete acceptance cases in [the closure plan](closure-plan.md). They are requirements, not passing results.

Evidence sources:

- N01-N13: [native/setup/administration](native-setup-administration.md).
- RT01-RT14: [runtime capabilities and existing evidence](runtime-capabilities-and-evidence.md).
- O01-O09: [authority transitions and operator reachability](transitions-and-operator-reachability.md).
- ME-01-ME-10 and V1-V6: [multi-client and remote-Core evidence](multi-endpoint-memory.md).
- B6E: [bounded B6 closeout](../../08-09-memory-runtime-integration/research/b6-closeout-validation-2026-09-13.md).
- D79-D83: [owner-approved follow-up inventory](../../08-09-memory-runtime-integration/research/memory-capability-followups-2026-09-13.md).

## Canonical model, providers and migration

| ID / design and original owner | Current implementation and reachability | Remaining work / impact | Evidence and acceptance |
| --- | --- | --- | --- |
| A01 - R1 canonical logical records; B1/D77 | Implemented canonical source/unit/derived/policy/provenance/epoch contracts and provider-hosted application artifacts. | Preserve these fields through operation integration. Complete actual switching is assessed separately from data reconstruction. | RT01/RT10; B6E; C01/C07. |
| A02 - R1 explicit persisted authority; B1/B2/B4/B6 | Implemented single-authority marker, epoch guards and selected-provider construction in production. | General repeated handoff is missing (A38). A settings toggle or health failure must not become an authority change. | RT01/RT14; O05-O07; C03/C07/C08. |
| A03 - R2 structured Local and Markdown retirement; B1/B2/B6 | Implemented canonical runtime after explicit B2 activation; migration RPCs are registered. Legacy evidence stays immutable. | Guided new/legacy-workspace onboarding is unconnected. Actual owner workspace mode was not inspected. | RT01; O01; C01. |
| A04 - R2 Local policy/Blocks/retention; B6 | Implemented Local maintenance, reversible mutation, revision history, Blocks and retention routing. | Complete owner/manual behavior acceptance remains open; do not confuse D79's daily full review with absence of current maintenance. | RT10/RT11; B6E; C05/C14. |
| A05 - R2 sparse and optional hybrid retrieval; B1/B6 | BM25 is production-wired. Optional vector interface and fallback logic exist; the production Local factory injects no vector implementation. | Optional configured vector indexing/rebuild remains unwired. Does not block sparse Local use; cannot advertise the option as functional. | RT02; C13. |
| A06 - R3 native API/auth/build contract; B0/B3/B6 | Authenticated client, frozen build validation and current D77 provider operations are implemented. | Bind first-enable readiness to all runtime/cutover capabilities, not only a configured B3 status. Verify the actual deployed artifact. | N01/N02; RT03; C02/C03/C12. |
| A07 - R3 journal/revision/snapshot/native mutations; B0/G1/D78/D77 | Implemented native compatibility foundations consumed by sync/recovery and current-state transfer. Conditional mutation and identity guards remain active. | Native historical proof does not replace the missing source transition fence. Every supported deployed build must pass the relevant contract cases. | N01/N12; RT06/RT09; C06/C07/C12. |
| A08 - R1/R3 interoperability; D77/B6 | Original typed fields, lifecycle/provenance/policy/Blocks and provider-only reconstruction have recorded actual-data evidence. | An actual round trip with later Local mutations remains unimplemented/unverified. Preservation does not imply derived visibility propagation. | RT10/RT12; B6E; C07/C14. |
| A09 - R4 legacy normalization/ledger/exclusion; B2 | Implemented deterministic normalization, raw snapshot, ledger, explicit source exclusions and gated Canonical Local activation via RPC. | Complete operator onboarding and owner acceptance; do not convert unsupported inputs by silent truncation. | O01; B2 PRD/source references in O01; C01. |
| A10 - R4 current Local coverage; B4/D78 | Implemented frozen current-epoch capture, post-B2 change detection, complete typed preparation and final Local-writer checks. | Connect all current Banks and coverage diagnostics to the actual first-enable operation. Do not reuse this initial-epoch receipt as proof for a later Local epoch. | O02/O06; B4/D78 validation; C03/C07. |
| A11 - R4 native import/proof/replica/promotion substrate; B4 | Implemented structured import, independent required-maintenance certificate, checkpoint/proof validation and atomic forward promotion primitives. | Internal/harness reachability only for the complete flow. Required-maintenance, actual Canonical Local writer drain and runtime-ready gates must survive operation integration; the unused promotion fence wrapper does not prove that coverage. | O02; N12; C03. |
| A12 - R4 first-enable operation; B4/B7 integration | Missing production start/resume/activate orchestration and the wizard consuming it. B4 exposes status/verify only. | Basic Hindsight onboarding blocker. A user cannot complete the accepted first-enable path merely by setting an endpoint and invoking B3 setup. | O02/O03/O08; C03/C09. |

## Synchronization, degraded operation and runtime behavior

| ID / design and original owner | Current implementation and reachability | Remaining work / impact | Evidence and acceptance |
| --- | --- | --- | --- |
| A13 - R5 incremental transactional replica; B5/D77/B6 | Implemented live per-Bank sync, predecessor/lease checks, atomic publication and durable checkpoints. | Add actual operator consumption and integrated acceptance; no second scheduler or UI-written checkpoint. | RT06; C06/C09. |
| A14 - R5 full reconciliation and divergent repair; B5/D77 | Complete descriptor traversal and exact immutable-body cache reuse exist; current application publication rebuilds the Bank projections. | Partial alignment with divergent-only repair: differential projection repair remains incomplete. This is not proof of full body-byte retransmission or a measured regression. | RT07; C06/C13. |
| A15 - R5 automatic schedule/backoff/catch-up; B5/B6 | Implemented persisted automatic/manual modes, due/retry state and conditional startup catch-up. | Present actual due/retry/failure state and test the complete caller path. Manual mode is allowed to remain stale. | RT06/RT08; ME-08; C06. |
| A16 - R5 verified provider-reconnect trigger; B5/B6 | `verifiedReconnect` exists but has no production caller in the bounded search. Due jobs and new-write recovery still run. | Wire an actual verified provider-recovery signal where the accepted early catch-up behavior is promised; browser reconnect is not that signal. | RT08; ME-08/N5; C06. |
| A17 - R5 manual sync/full reconcile and status; B5/B7 | Producer methods and durable schedule/status schemas exist; operator RPC/Home controls are missing. | Specific operations blocker. Expose live producer state and serialize manual work through existing leases/scheduler. | O04/O08; C06/C09. |
| A18 - R5/R8 foreground waiting; B6/D83 | Current admission synchronizes and may wait behind Bank work before Run capture. Automatic Recall then waits for completion/cancellation by default. Optional recall failure fallback applies after admission; missing Bank/capability/pin evidence can still refuse a Run. | Align earlier no-refresh-wait wording and user-facing expectations with current admission semantics. Optimization is D83; do not hide the wait or invent a fresh SLA. | RT13; B6E; C05/C14. |
| A19 - R6 verified replica/Pending degraded reads; B5/B6 | Implemented last verified replica and policy-aware Pending behavior under admitted capabilities and the unchanged Hindsight epoch. | Operator presentation of replica age, unconfirmed content and admission failures remains incomplete. A never-verified runtime is not automatically safe to admit offline. | RT09; ME-08; C06. |
| A20 - R6 factual Pending recovery and supersession; G1/D77/B6 | Implemented original request identity, remote pull, CAS replay, native-result proof, second pull and parent/application completion. Stale mutations become superseded. | Complete operator inspection/retry/unknown-outcome handling and integrated failure acceptance. No interactive forced-merge flow is required for stale Pending. | RT09; V2/V3; C06/C09. |
| A21 - R6 separate work/confirmation states; B5/B6/B7 | Native, application, parent-write, failed, unknown and assessment journals exist. | Missing truthful composite operator projection. Zero per-pass Pending is not zero unresolved work or complete derived freshness. | O04; RT09/RT11; C06/C09. |
| A22 - R7 safe Write Gate/primary source routing; B6 | Implemented keep/skip plus Global/Character/both routing, source-bound durable ingestion and safe primary-content handling. | Integrate end-to-end first-use acceptance without bypassing ownership/provenance; explicit retain and automatic ingestion have distinct entry paths. | RT04; B6E; C05. |
| A23 - R7 per-fact labels and neutral policy; B0/B3/B6 | Native label/mutation contracts and truthful neutral-policy/assessment fallback exist. Built-in v1 template does not configure a controlled extraction entity-label taxonomy. | Template/setup completeness is partial. Verify and complete initial per-fact taxonomy setup; do not confuse later curator policy with an already delivered extraction configuration. | N07; RT10; C05/C16. |
| A24 - R7 provider-specific maintenance; B6 | Local full maintenance and Hindsight's narrower Taki curator are production-wired; native semantic maintenance stays native. | Keep later D79-D82 work explicit (A49-A52). Current failed/retryable model assessments cannot be relabeled completed. | RT11; B6E; C05/C14. |
| A25 - R8 automatic recall and feedback prevention; B6 | Implemented Global/current-Character selection, bounded merged projection and no Timeline persistence/re-retain of injected recall. | Full app acceptance still depends on ready Banks and first activation; model response quality and timing have explicit limits. | RT04/RT05; B6E; C05. |
| A26 - R8 canonical tools and capability subset; B1/B6 | Implemented one canonical tool vocabulary with capability-aware exposure. Local Reflect/native graph behavior is deliberately unsupported. | No requirement to reproduce Hindsight algorithms in Local. Verify actual prompts/tools through the selected runtime and preserve truthful unsupported results. | RT03; C05. |
| A27 - R1/R8/R9 new Character after activation; B3/B6/B7 | Missing active-Hindsight Bank preparation; existing router requires verified Global/Character mappings before admission. | Basic-use blocker for a newly used Character: chat can fail before automatic-recall fallback. Complete provisioning, verification and readable readiness/error state. | N03; RT05; C04. |

## Setup, authority operations and administration

| ID / design and original owner | Current implementation and reachability | Remaining work / impact | Evidence and acceptance |
| --- | --- | --- | --- |
| A28 - R9 guided setup and secret-safe preview; B3/B7 | B3 RPC/config/secret foundations exist; the complete managed/existing-instance wizard is missing. | Implement prerequisites, validation/model/template/migration preview and guarded activation as an operator journey. Generic settings are not the wizard. | N02/N09; O08; C02/C03. |
| A29 - R9 progressive model configuration; B3/helper/B7 | Settings and secret-reference fields are stored/fingerprinted, without a production native deployment-model apply path in the inspected scope. | Complete actual model configuration/read-back or clearly require externally configured existing instances. Model knob presence cannot prove native effect. | N04; C02/C12. |
| A30 - R9 interrupted setup recovery; B3/B7 | Partial persisted progress exists; orphaned busy phases have no ordinary recovery path after Core interruption. | Specific setup usability blocker. Reconcile prior remote effects and recover the admitted attempt without blind reset/replay. | N05; C02/C09. |
| A31 - R9 active provider health/configuration; B3/B6/B7 | Setup status is historical; validation/setup/LLM health are Local-only, and current runtime refuses captured config/secret drift. | Add a real active-provider status/health/revalidation/rebind workflow. Disable/setup flags must not masquerade as switching or live health. | N08; O03/O04; C04/C09. |
| A32 - R3/R9 stale compatibility after failed validation; B3 | Static weakness identified: old compatibility survives failure and setup only checks stored evidence/fingerprint. Independent later authority/runtime gates remain. | Add focused regression and close the pre-mutation admission gap. This is not a reproduced wrong-authority activation. | N06; C02. |
| A33 - R9 versioned overlay/user override lifecycle; B3/B7 | Only fixed v1 template application and owned-field verification are complete. | Complete separate user-overlay revisions, update preview/preservation/removal and upgrade integration before advertising that lifecycle. | N07; C16/C11. |
| A34 - R9 durable operator lifecycle and progress; Core/B7 | Multiple durable lower-level journals/status methods exist. Complete discovery/start/resume/cancel/observe facade and Home consumer are missing. | Shared prerequisite for first enable, switching, backup/upgrade and reopen/second-client progress. Mutation timeout must remain unknown until reconciled. | O03/O08; ME-07/ME-09/ME-10; C09. |
| A35 - R9 healthy Hindsight-to-Local return; B7 | Missing the complete accepted reverse transition despite available data/sync/fence foundations. | Final maintenance/sync/reconciliation, zero unresolved work, source fence/queue, new Local epoch and replay must form one recoverable operation. | O05; N12; C07. |
| A36 - R9 Local-to-Hindsight re-entry; B7 | Missing generalized current-Local change application and source proof; first promotion is initial-local/B2-specific. | Cover all Local-period mutations using verified baseline/mappings/deltas and complete reconciliation before the next epoch. New Bank/full copy is not the accepted default. | O06; C07. |
| A37 - R9 emergency Local takeover; B7 | Missing the explicit takeover operation and UI; replica/Pending evidence is available. | Capture backup/uncertainty, disclose missing interval, confirm explicitly, create Local epoch and keep recovered foreign history isolated. | O07; C08. |
| A38 - R1/R9 runtime handoff and transition queue; B6 primitives/B7 | Selected-runtime lifetime/stale-epoch guards and a Legacy admission fence exist. Canonical Local does not receive that fence; repeated runtime replacement and durable transition queue/replay are missing. | Shared transition prerequisite. Prove actual writer admission/drain coverage, retire old executables, and recover committed authority after bind failure; do not reopen the old provider automatically. | RT14; O05/O06; C03/C07/C08. |
| A39 - R9 complete backup/restore; native helper/Core/B7 | Native PostgreSQL backup/restore includes current extension tables and schema checks. Complete Taki control-state/artifact orchestration is missing. | Back up and restore native plus Core identity/mappings/journals/configuration with explicit credential custody and validation. Required before real destructive/replacement operations. | N10; C10/C12. |
| A40 - R9 staged upgrade; helper/Core/B7 | Compatible-client/admin primitives exist; complete candidate workflow is missing. | Isolated candidate restore, contract/read/write/sync/template checks, controlled promotion and durable failure recovery. | N11; C11. |
| A41 - R10 Core-owned write-only secrets; Secret Catalog/B3 | Secret Catalog, set/clear/presence boundaries and Core-owned credential resolution are implemented. | Preserve absence of value echo and correct Host ownership; live Windows/headless/package acceptance is still separate. | ME-04/V4; N02; C12. |
| A42 - R10 managed provisioning and OS neutrality; Shell/helper/B7 | Managed receipt validation exists; an executable production provisioner is missing. Core's OS-neutral boundary is already defined. | Implement a real helper with storage/auth/model prerequisites and verifiable exact-build result, while keeping existing-instance mode independent. | N09/N04; C02/C12. |
| A43 - R10 supported deployment and packaged proof; B3/B7/integration | Source/contract checks and historical startup/build results exist. | Validate the actual compatible native artifact, Windows and headless key sources, install/start/restart, storage persistence and supported environment. This audit did not perform deployment. | N01; V4; O09; C12. |

## Multi-endpoint boundaries, optional surfaces and accepted deferrals

| ID / design and original owner | Current implementation and reachability | Remaining work / impact | Evidence and acceptance |
| --- | --- | --- | --- |
| A44 - single-Core multi-client memory use; D59/B7 integration | Independent Home/Pet/Chat sockets and multiple authenticated Core connections are implemented; memory/config remain Core-owned. | Execute memory-related multi-window acceptance after the relevant operations exist. Several sockets do not prove a packaged two-device deployment. | ME-01/ME-04; V1/V5; C09/C12. |
| A45 - reconnect and admitted-memory lifetime; D59/B5/B6/B7 | Client generation retirement/read restoration and Core-owned memory recovery exist; Chat close cancels its foreground Run. | Complete operation discovery after a lost Home reply; preserve the distinction between Chat cancellation and durable memory work. No automatic mutation replay. | ME-06-ME-10; C06/C09. |
| A46 - desktop selecting remote Core; D23/#29 | Current operator URL, release Shell URL and packaged CSP remain loopback-bound. A remote Hindsight endpoint is a different configuration. | Remote-desktop journey is blocked by existing deferred split-deployment work. Record this dependency; do not silently add it to B7 or call it a B6 regression. | ME-02/ME-03; C15, outside the current B7 release claim. |
| A47 - independent Cores sharing a service/Bank | No delivered per-Core/profile namespace or active-active/merge contract; existing import/epoch/namespace guards remain. | Unsupported/unverified topology, not a proven data leak. No new multi-Core merge requirement or mandatory fresh Bank for ordinary same-profile re-entry follows. | ME-05 and cross-Core section; C15, only if separately scoped. |
| A48 - optional canonical human-readable export | Retained legacy snapshots and native Bank export/import exist; no Taki canonical export operation was found. | Optional surface remains undelivered. Keep visible in the full-design inventory without turning it into a basic-chat prerequisite. | N13; C13. |
| A49 - D79 daily whole-library model review | Current threshold/manual Local tidy and narrow Hindsight curator exist. Complete daily review/missed-run orchestration is not delivered. | Explicitly deferred after B7. Do not report daily review from a maintenance hook or a successful bounded pass. | RT11; D79; C14. |
| A50 - D80 Hindsight Taki-policy retention executor | Reads enforce expiry; no equivalent full authority-owned Taki retention execution chain is installed. | Explicitly deferred after B7; expired records can remain native state. Native infrastructure retention is not this feature. | RT11; D80; C14. |
| A51 - D81 derived hidden/expiry propagation | Direct filtering works; the actual final run still exposed derived nickname content from a hidden source. | Recorded unresolved limitation, deferred after B7. Hiding a source does not currently promise erasure from every derivative. | RT12; B6E; D81; C14. |
| A52 - D82 richer Hindsight curator promotion/reconsideration | Current due/changed/retry assessment and listed Blocks exist; automatic new-pin/native-observation rewrite parity is absent. | Explicitly deferred; Local and Hindsight maintenance algorithms need not be identical. | RT11; D82; C14. |
| A53 - D83 measured overhead optimization | Actual timings and source inspection identify sync/hydration overhead; a specific optimization benefit has not been established. | Explicitly deferred. Keep foreground waits and sample limits visible; no speculative cache/timeout redesign. | RT13; D83; C14. |
| A54 - complete product/manual/original-environment acceptance | Many scoped automated and actual copied-data/model results exist; source-fingerprint subset matches. | Cross-feature journeys, original-environment activation, supported packaging/deployment and owner-observed results are still open or blocked. No aggregate test count replaces them. | O09; B6E; V1-V6; C01-C16 as scoped below. |

## Requirement coverage map

| Accepted family | Matrix entries |
| --- | --- |
| R1 provider-neutral domain and authority | A01, A02, A08, A27, A38 |
| R2 structured Local provider | A03, A04, A05 |
| R3 Hindsight/provider compatibility | A06, A07, A08, A32 |
| R4 deterministic migration and cutover | A09, A10, A11, A12 |
| R5 synchronization | A13, A14, A15, A16, A17, A18 |
| R6 degraded use and recovery | A19, A20, A21 |
| R7 ingestion/maintenance/scope policy | A22, A23, A24, A49, A50, A51, A52 |
| R8 recall/tools | A25, A26, A27, A18 |
| R9 guided setup and operations | A28-A40 |
| R10 secrets/deployment | A41, A42, A43 |
| Later repeated-switch preservation ruling | A08, A35, A36, A38 |
| Memory-related multi-endpoint use | A44, A45, A46, A47 |
| Optional export and actual acceptance | A48, A54 |
| D79-D83 | A49-A53 |

No completion percentage is inferred from these 54 entries: they include implemented capabilities, integration gaps,
overlapping dependencies, optional features, explicit deferrals and acceptance conditions of different sizes.

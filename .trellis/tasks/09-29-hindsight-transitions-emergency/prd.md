# Hindsight Repeated Transitions and Emergency Takeover

## Status

- Planning authorized by the owner on 2026-09-29.
- The owner requested independent re-acceptance of the existing Stages 1-3 in parallel with Stage 4 preparation.
- This task is a child of `08-09-hindsight-memory-provider` and implements Stage 4 of the revised 2026-09-18 allocation.
- Owner approved the reviewed Stage 4 plan and implementation on 2026-09-29. Execute W0-W8 in order with one sub-agent at a time. Historical conversion data may be used if still available; verify availability and use isolated copies for tests.
- On 2026-10-01 the owner required staged real-data tests using prior conversion outputs and authorized necessary real LLM calls. Do not repeat the real corpus's Local-to-Hindsight conversion/extraction. See `research/real-data-reuse-plan.md`.
- Prior archived stages and owner/manual acceptance retain their existing status.
- W0-W8 implementation and the approved isolated automated acceptance are complete as of 2026-10-06. The leader accepted the formal [W8 independent check](research/w8-independent-check.md), verified all 23 final source/helper identities and all 28 pinned evidence artifacts, and recorded the six automated product criteria below. W5 real-data preservation and W6 emergency/restart/D91 evidence remain separately preserved.
- The owner authorized local commits on 2026-10-06 after the final delivery. Native and Taki sources are checkpointed as one coordinated commit batch; see [commit checkpoint](research/commit-checkpoint-2026-10-06.md). The session remains bound to this task and `task.json` stays `in_progress`; no push or archive is included. Owner/manual and original-environment acceptance remain open. See the first Current section in `research/leader-now.md` for the final handoff.

## Goal

Implement and verify the approved plan for repeated healthy Local/Hindsight authority transitions and a separate emergency Local takeover, reusing the shipped operation, runtime, replica, custody, and backup foundations without losing logical memory or replaying stale work.

## Requirements

1. Support repeated Local -> Hindsight -> Local -> Hindsight cycles across Global and Character Banks, preserving current logical data, identities, provenance, lifecycle, policy, Blocks, and mappings.
2. Re-entry reuses verified baselines and mappings and incorporates every current-Local change. A fresh Bank or mandatory full copy is not the default.
3. Bind final provider proof and required maintenance to the final fenced source state. Drain actual foreground/background writers and preserve exact committed primary-conversation spans through authority commit, binding failure, and restart.
4. Define transition-owned queued intents, admission cutoff, source/target identity and revision proof, durable replay identity, conflicting mutations, and original-caller outcomes. Never replay old closures or silently rebind old Run/Effect references.
5. Healthy transitions use the accepted single normal-switch confirmation and complete only after all integrity gates pass.
6. Emergency takeover is separately admitted and confirmed. Seal surviving Core, replica, Pending, and checkpoint evidence; disclose backup age and the potentially missing interval. An unavailable native service cannot be required to produce a fresh backup.
7. Retire old runtime references and recover the committed runtime after lost replies, process restart, or binding failure. A recovered old Hindsight authority cannot overwrite or auto-merge into the new Local epoch.
8. Reuse Core-owned durable operations and truthful same-Core multi-client status, progress, cancellation, and recovery. Include a minimal usable Home surface for this stage.
9. Require the independently verified Stage 3 recovery foundations before real-data authority replacement. Initial verification uses isolated data and owned fixtures.
10. Preserve deferred Stage 5/6 work, D79-D83 ordering, optional capabilities, and the D23 remote-Core boundary.

## Planning Acceptance Criteria

- [x] Independent Stage 1/2 and Stage 3 reports distinguish current source findings, newly executed tests, historical evidence, and unperformed manual/environment acceptance.
- [x] Every confirmed blocker relevant to Stage 4 has explicit ownership and an implementation-readiness disposition.
- [x] `design.md` identifies current producers and the smallest required extensions, with source references and failure behavior.
- [x] `implement.md` defines ordered implementation waves, shared-file ownership, meaningful regression/acceptance cases, and rollback boundaries.
- [x] C07/C08, relevant C03/C09/C10 subcases, and PR01-PR04 are mapped to the plan; historical passes do not replace new Stage 4 proof.
- [x] Context manifests contain real, existing spec and research paths and pass Trellis validation.
- [x] Unresolved engineering questions and any genuinely blocking owner decisions are explicit.

## Product Acceptance Outline

Checked items mean acceptance within the approved isolated automated scope, not owner/manual or original-environment
approval. The [W8 T01-T18 / PRD mapping](research/w8-independent-check.md#t01-t18-and-prd-mapping) identifies new
verification and retained source-matched Native/real-data evidence; deterministic fixtures are not live Native proof.

- [x] Repeated healthy switching preserves all current logical state with intervening additions, edits, invalidations/restores, expiry/deletion, policies, and Blocks. Evidence: T06-T10 and the [W5 actual healthy result](research/w5-healthy-final-result-2026-10-06.md).
- [x] Concurrent/fenced writes and late primary-source commits are either durably admitted with exact ownership or truthfully refused; no loss, duplicate effect, or stale-reference replay occurs. Evidence: T03, T07, T11-T13; the real-corpus queues were empty, so nonempty queue cases use deterministic regressions.
- [x] Lost responses, crash boundaries, cancellation, lease takeover, failed runtime binding, and reconstruction expose the committed truth without repeating effects. Evidence: T05, T12, T14, T16, T18, seven actual `main.ts` boots and the new recovered-terminal next-cycle cases.
- [x] Emergency takeover remains executable during provider loss, records uncertainty, survives restart, and isolates the old authority on return. Evidence: T02, T15-T17 and the [W6 actual emergency/restart/D91 result](research/w6-final-result-2026-10-06.md); original unknown rows and the selected receipt remain preserved.
- [x] The initiating Home can close and a second authenticated observer can recover the same operation and truthful progress/outcome. Evidence: T18 real authenticated WS/browser execution, three explicit submits, controlled close-before-complete ordering and no replay.
- [x] Isolated end-to-end evidence covers required journey and failure cases. Evidence: final Shared/Core/Desktop suites, scoped Native/Rust contracts, actual boot/recovery, retained W5/W6/D91 results and source identity audit. Owner/manual and original-environment acceptance remain separately recorded below.

Remaining acceptance boundaries:

- [ ] Owner/manual acceptance and packaged WebView2/CSP behavior on the supported original environment.
- [ ] Original-user data/authority replacement and original/DPAPI or cross-machine credential recovery; D91 remains globally open despite the successful isolated runbook drill.

Large-corpus timely submit acknowledgement is not proved. The 120-second long-RPC deadline and truthful unknown
result followed by original-operation reattachment are verified; performance improvement is deferred. Stage 5/6,
D23 and the other deferred program items retain their own scope and status.

## Out of Scope

- Unrelated production changes or automatic rewrites of archived acceptance evidence.
- Original user database/authority replacement, unapproved dependency changes, or external publication. Real LLM calls are allowed only for the scoped reuse tests above; full real-corpus reconversion remains prohibited.
- Managed provisioning, complete template/overlay lifecycle, staged upgrade, and final Stage 6 acceptance.
- A second scheduler, replica engine, runtime authority, or frontend operation ledger.
- Closing archived or still-open legacy tasks solely from automated checks.

## Sources

- `docs/HANDOFF.md`, section 3.2 (Stage 3 history, final Stage 4 automated delivery and remaining boundaries).
- `../09-14-hindsight-integration-completeness-audit/research/plan-review-2026-09-18.md` (revised stage allocation and PR01-PR05).
- `../09-14-hindsight-integration-completeness-audit/research/overall-grill-2026-09-19.md` (accepted U1 and conditional grill).
- `../09-14-hindsight-integration-completeness-audit/research/completeness-matrix.md` and `closure-plan.md` (54-entry ledger and C01-C16).
- `../08-09-memory-operations-ui/design.md`, `grill.md`, and `implement.md` (existing B7 design, subject to current-source verification).

## Open Questions

No unresolved implementation blocker remains within the approved scope. Contracts and proof gates in `design.md`
and `implement.md` passed the assigned W0-W8 reviews, including native protocol/versioning, generic epoch
publication and emergency unknown-write disposition. The remaining manual/environment and performance boundaries
are explicit above; [execution status](research/execution-status.md) records the completed waves.

## Preparation Artifacts

- [Recovered scope, evidence and blocker disposition](research/recovery-2026-09-29.md).
- [Independent Stages 1/2 acceptance](research/acceptance-stages-1-2.md) and [Stage 3 acceptance](research/acceptance-stage-3.md).
- [Current source prerequisites](research/stage-4-prerequisites.md) and [runtime/emergency continuation](research/stage-4-runtime-prerequisites.md).
- [Proposed design](design.md) and [ordered implementation and validation plan](implement.md).

Planning acceptance established reviewable scope and the owner's subsequent approval authorized implementation.
The final W8 evidence now supports the six automated product criteria; it does not infer manual acceptance.

# Runtime Recall, Tools, and Memory Policy

## Goal

Integrate the provider model into live agent turns while preserving prompt-cache stability, non-blocking chat, one canonical tool vocabulary, and Taki-specific companion policy.

## Dependencies

- `08-09-memory-provider-foundation`.
- `08-09-hindsight-connection-setup`.
- `08-09-memory-replica-sync-recovery`.

## Scope

- Bounded Automatic Memory Recall from Global and active Character banks.
- Ephemeral fenced `<turn-context>` projection with timeout, partial-bank success, deduplication, and shared budget.
- Canonical retain/recall/reflect/edit/invalidate/restore tools and non-advertised legacy aliases.
- One `keep | skip` plus `global | character | both` Write Gate over sanitized committed source spans.
- Feedback-loop exclusion for recalled memory, hidden prompts, secrets, and unsafe tool payloads.
- Local full maintenance versus Hindsight reduced Memory Policy Curator behavior.
- Restore full Taki maintenance against Canonical Local records: tidy/consolidation, retention and visibility,
  background memory jobs, and Memory Block projection. Reuse useful Taki behavior without reactivating Markdown as
  runtime storage or requiring Hindsight to provide a complete Local mode.
- D77 provider-hosted original application evidence, exact native/application policy binding, paired recovery and guarded
  native reflection, as authorized by the policy-readiness continuation below.

## Acceptance Criteria

These checkmarks record automated implementation evidence in the [final validation report](research/d77-runtime-validation-2026-09-11.md).
They do not record owner/manual or live-environment acceptance. B7 owns actual planned switch-back/re-entry/takeover.

The owner-authorized [actual-data/model acceptance on 2026-09-12](research/d77-owner-acceptance-validation-2026-09-12.md)
passed storage fidelity and recovery but did not pass configured-model retrieval quality and runtime performance.
Keep this task open for those gates; automated checkmarks below do not override that result or approve live activation.

The later [API continuation](research/d77-siliconflow-validation-2026-09-13.md) completed the original-target Recall,
automatic Recall and grounded Reflect cases, but preserved a real derived-content visibility failure. The owner on
2026-09-13 directed the project to finish existing work and B7 before [D79-D83 capability follow-ups](research/memory-capability-followups-2026-09-13.md).
Keep final B6 code/curator-continuation validation separate from those deferred additions. No historical failed case is
reclassified as passed, and the temporary blanket observation guard is not an accepted final product requirement.
The owner-approved [bounded closeout](research/b6-closeout-validation-2026-09-13.md) then removed that experiment and
passed final-source, ordinary-observation runtime and curator recovery/applied-progress verification. The original
three memory policies remain failed/retryable; whole-library/eventual assessment and owner/manual acceptance are open.

- [x] Automatic recall never enters stable instructions, persisted timeline, compaction source, Write Gate input, or Retain payloads.
- [x] Recall failure or timeout never fails an already admitted foreground response.
- [x] Other Character banks are excluded by default and shared budgets are deterministic.
- [x] Canonical and legacy tool suites are never advertised simultaneously.
- [x] Hindsight mode does not run duplicate generic Taki consolidation.
- [x] Local BM25-only mode remains complete without embeddings.
- [x] With Local authority and Hindsight disconnected, canonical ingestion, recall, tools, tidy, retention and
      background/block maintenance are wired and produce observable persisted results through Local authority.
      Empty maintenance results or empty tool registries cannot stand in for this acceptance.
- [x] Runtime binding to the selected provider chooses the correct maintenance behavior: full Local maintenance versus Hindsight-native
      semantics plus Taki policy, with no generic Taki consolidation or direct authoritative edits to the replica.
- [x] Local maintenance preserves canonical identities, source links, lifecycle and Taki policy required by the
      versioned interchange contract; it does not silently discard supported state that Local does not derive itself.

## Out of Scope

- Initial migration/cutover protocols and unrelated Hindsight compatibility or sync-storage redesign. The explicitly
  authorized D77 companion state and application-aware B5 adapter are included.
- Bank-wide destructive administration exposed as agent tools.
- Final setup and operations UI.
- Post-B7 D79-D83 capability additions: daily full-library model review, Hindsight execution of Taki retention,
  complete derived-policy propagation/rebuild, expanded curator promotion and unproven performance optimization.

## Contract Clarifications (2026-09-05)

- B6 consumes B5's stable replica-reader, Pending Memory, and recovery contracts; it does not recreate sync storage or
  activation logic.
- `RunSnapshot` freezes provider identity, lineage, authority epoch, capabilities, and tools. Coordinator/tool wiring and
  `run-snapshot-capture.ts` must use one immutable snapshot and fail closed on drift.
- Automatic foreground recall is appended to ephemeral outgoing `<turn-context>` before request-preparation measurement.
  It is excluded from timeline, summaries, compaction gates, Write Gate input, and Retain payloads. Primary-only
  conversational auto-ingestion is distinct from delivered autonomous speech and silent controls.
- Hindsight keeps a narrow Taki policy curator and uses `MemoryFlushPort` for pre-retirement durability; Pending replay
  remains B5 ordered recovery, never generic blind Effect replay.

## Owner clarification (2026-09-07)

[The confirmed interoperability direction](../09-07-hindsight-recovery-evidence/grill.md) reaffirms that Local is a
complete self-developed memory path and Hindsight mode delegates semantic memory to Hindsight. Completing Canonical
Local maintenance is already B6 scope, not a separate optional enhancement and not an instruction to reproduce
Hindsight's algorithms. This clarification adds acceptance precision.

## Owner authorization (2026-09-10)

After the reviewed B4/D78 changes were committed in TakiAgent (`3c63a80`) and Hindsight (`6a749ba`), the owner authorized
progress on subsequent pre-B7 work whose requirements are already clear. Reuse existing decisions before opening a
`grill-with-docs` question; a missing implementation is not a new product decision. B7 must have a separate grill before
implementation. This authorizes starting this existing B6 task and implementing its settled Local and runtime contracts.
It does not authorize live authority activation, accessing the original user database, push, or task archival.

## Policy-readiness decision and continuation (2026-09-11)

The owner accepted [the policy-readiness ruling](grill.md) and authorized design and implementation through Trellis.
Verified native memory with known Bank ownership and valid lifecycle can be recalled under an explicit neutral policy
while detailed classification continues in the background. Existing valid policy remains authoritative. Unknown basic
integrity is a refusal, not permission to invent ownership, provenance, lifecycle or a completed assessment.

- [x] Native confirmation, neutral policy readiness and detailed assessment are represented independently from Pending writes.
- [x] Eligible new native memories can affect a response before a model assessment completes; failed assessment remains retryable.
- [x] Neutral admission preserves explicit hidden/invalidated policy and does not bypass exact identity, revision or Bank checks.
- [x] New and externally changed native records receive consumable policy/provenance without fabricated original-source evidence.
- [x] Necessary Taki application state survives remote-only reconstruction and native-version evolution under the D77 contract.
- [x] B6 consumes existing replica/recovery machinery in a real runtime composition; Local remains independently usable and
      Hindsight mode does not duplicate generic native semantic maintenance.

Bidirectional/repeated authority switching remains required by the parent. B7 owns the actual planned switch-back,
re-entry and emergency operations and still requires its separate grill. This continuation does not implement B7 early.

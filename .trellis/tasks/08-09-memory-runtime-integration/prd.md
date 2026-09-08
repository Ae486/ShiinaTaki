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

## Acceptance Criteria

- [ ] Automatic recall never enters stable instructions, persisted timeline, compaction source, Write Gate input, or Retain payloads.
- [ ] Recall failure or timeout never fails the foreground response.
- [ ] Other Character banks are excluded by default and shared budgets are deterministic.
- [ ] Canonical and legacy tool suites are never advertised simultaneously.
- [ ] Hindsight mode does not run duplicate generic Taki consolidation.
- [ ] Local BM25-only mode remains complete without embeddings.
- [ ] With Local authority and Hindsight disconnected, canonical ingestion, recall, tools, tidy, retention and
      background/block maintenance are wired and produce observable persisted results through Local authority.
      Empty maintenance results or empty tool registries cannot stand in for this acceptance.
- [ ] Provider switching selects the correct maintenance behavior: full Local maintenance versus Hindsight-native
      semantics plus Taki policy, with no generic Taki consolidation or direct authoritative edits to the replica.
- [ ] Local maintenance preserves canonical identities, source links, lifecycle and Taki policy required by the
      versioned interchange contract; it does not silently discard supported state that Local does not derive itself.

## Out of Scope

- Hindsight compatibility patches, initial migration, and sync storage internals.
- Bank-wide destructive administration exposed as agent tools.
- Final setup and operations UI.

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
Hindsight's algorithms. This clarification adds acceptance precision; B6 remains planning until explicitly started.

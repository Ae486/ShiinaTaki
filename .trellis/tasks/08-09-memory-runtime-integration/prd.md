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

## Acceptance Criteria

- [ ] Automatic recall never enters stable instructions, persisted timeline, compaction source, Write Gate input, or Retain payloads.
- [ ] Recall failure or timeout never fails the foreground response.
- [ ] Other Character banks are excluded by default and shared budgets are deterministic.
- [ ] Canonical and legacy tool suites are never advertised simultaneously.
- [ ] Hindsight mode does not run duplicate generic Taki consolidation.
- [ ] Local BM25-only mode remains complete without embeddings.

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

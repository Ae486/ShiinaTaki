# Initial Hindsight Import and Authority Cutover

## Goal

Perform a resumable, verifiable Local-to-Hindsight migration and activate Hindsight authority only after every source, derived mapping, replica record, and integrity gate succeeds.

## Dependencies

- `08-09-hindsight-compatibility-extensions`.
- `08-09-memory-provider-foundation`.
- `08-09-memory-legacy-migration`.
- `08-09-hindsight-connection-setup`.

## Scope

- Ensure authenticated Global and Character banks and approved template revisions.
- Submit deterministic asynchronous retain operations and resume lost acknowledgements idempotently.
- Resolve each completed document to all resulting fact IDs/revisions and persist the Migration Ledger mapping.
- Wait for the contract-tested derived-completion predicate.
- Build the first local replica from a cursor-bound logical snapshot and integrity manifest.
- Run reconciliation and atomically activate a new Hindsight Authority Epoch.

## Acceptance Criteria

- [ ] Interrupted import resumes without duplicate documents or facts.
- [ ] Every required source has a successful terminal mapping or explicit exclusion.
- [ ] Snapshot counts/hashes, one-to-many mappings, and checkpoint cursor verify before activation.
- [ ] Any failure leaves Local authoritative and preserves resumable state.
- [ ] No UI action or health result alone can bypass the cutover gates.
- [ ] Import and replica state contain no API keys, authorization headers, raw provider errors, source text in logs, or unbounded payloads.
- [ ] A stale predecessor epoch, stale manifest, expired cursor, unresolved mapping, or failed integrity check refuses promotion.
- [ ] The final promotion is one fenced SQLite transaction with no network/filesystem/async work inside it.
- [ ] Restart before and after promotion produces deterministic authority and replica state; pre-commit failure never changes the active Local epoch.
- [ ] Offline tests use injected Hindsight transports only; live service acceptance is separate and real LLM health remains explicit owner-approved work.

## Out of Scope

- Ongoing journal polling, Pending Memory replay, and planned switch-back.
- Automatic foreground recall and canonical tool exposure.
- Deleting legacy migration evidence.

## Definition of Done

- `design.md`, `implement.md`, and both context manifests are complete and validated before activation.
- Focused import, mapping, snapshot, replica, integrity, fence, promotion, restart, privacy, and operator authorization tests pass.
- Shared/Core typecheck, package tests, lint, recursive typecheck/test, `git diff --check`, and Trellis validation pass.
- The active authority remains `canonical-local` throughout offline implementation and is changed only by an explicitly approved live cutover run.
- Manual/live acceptance is recorded separately and is not inferred from mock tests.

## Technical Notes

- B2 archived migration artifacts provide the immutable source snapshot, canonical staging, and migration ledger input.
- B3 provides authenticated Hindsight connection, compatibility/template readiness, and operator-only setup methods.
- The current Taki runtime has no Hindsight data-plane provider, logical snapshot/journal/checkpoint implementation, or Hindsight epoch promotion seam; these are B4 deliverables.
- The binding authority/replica policy is [`docs/adr/0009-single-memory-authority-with-local-replica.md`](../../../docs/adr/0009-single-memory-authority-with-local-replica.md).
- Detailed live seam evidence is in [`research/taki-cutover-seams.md`](research/taki-cutover-seams.md).

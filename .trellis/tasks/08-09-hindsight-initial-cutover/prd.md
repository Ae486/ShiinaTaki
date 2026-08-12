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

## Out of Scope

- Ongoing journal polling, Pending Memory replay, and planned switch-back.
- Automatic foreground recall and canonical tool exposure.
- Deleting legacy migration evidence.

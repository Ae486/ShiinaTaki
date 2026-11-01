# windows/home/pages/operations/
The Operations page joins durable Memory operations, manual maintenance, context and storage.
Every displayed fact comes from Core; retained-page reads never replay mutations.

- operations-page.tsx — retained Memory authority, tidy, context and storage cards with independent failure/retry states
- memory-tidy-card.tsx — explicit clean/success/partial/failure presentation, safe Chinese diagnostics and retained committed counts
- memory-tidy-controller.ts — serialized tidy lifetime, schema-validated failure data, retired-client guards and separate refresh errors
- storage-card.tsx — media usage and two-step attachment purge with stable pending labels and locked confirmation
- use-operations.ts — independent Memory/storage demand states and retries; visibility-gated invalidation after writes
- use-memory-tidy.ts — React adapter for the one-attempt tidy controller, independent of read visibility
- use-media-clear.ts — guarded media clearing, once-only floating outcomes, retained failure and storage invalidation
- media-clear-controller.ts — explicit confirmation, per-client attempt lock, stale-result suppression and terminal retryable errors; reconnect cannot erase an unconfirmed prior purge
- operations-state.ts — pure status/defect/closed tidy-failure labels + media.clear state machine; Cancel is valid only before destructive execution
- memory-authority-card.tsx — memory.authority.status card: authority/runtime/setup lines, per-Bank replica + Pending rows with Sync now / Full reconcile / Retry, active operations with Cancel (admitted replica.sync only)
- memory-authority-state.ts — provider status and semantic Bank/operation labels; unknown stays unknown and internal identities remain non-display state
- memory-operations-controller.ts — current-client operation actions and outcomes; visibility/acknowledgement-gated status reads, retryable setup and coalesced invalidation without mutation replay
- use-memory-operations.ts — Memory operations React lifecycle tied to authenticated client and actual retained-page visibility
- memory-authority-fixtures.ts — test support (not in the production path): MemoryAuthorityStatus / Bank / MemoryOperation fixtures shared by the card, view-model and controller tests

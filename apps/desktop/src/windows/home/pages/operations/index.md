# windows/home/pages/operations/
The Operations page joins durable Memory operations, manual maintenance, context and storage.
Every displayed fact comes from Core; retained-page reads never replay mutations.

- operations-page.tsx — retained Memory authority, tidy, context and storage cards with independent failure/retry states
- memory-tidy-card.tsx — Core-owned tidy progress, partial/interrupted outcomes, read recovery and explicit next actions
- memory-tidy-state.ts — semantic tidy operation projection, input-budget guidance and continued Block work; unknown remaining work and unreported coverage stay explicit
- memory-tidy-fixtures.ts — synthetic typed tidy operations for controller and rendered-card regressions (test support only)
- storage-card.tsx — media usage and two-step attachment purge with stable pending labels and locked confirmation
- use-operations.ts — independent Memory/storage demand states and retries; invalidates counters after a newly observed durable tidy settlement
- use-media-clear.ts — guarded media clearing, once-only floating outcomes, retained failure and storage invalidation
- media-clear-controller.ts — explicit confirmation, per-client attempt lock, stale-result suppression and terminal retryable errors; reconnect cannot erase an unconfirmed prior purge
- operations-state.ts — pure status/defect/closed tidy-failure labels + media.clear state machine; Cancel is valid only before destructive execution
- memory-authority-card.tsx — memory.authority.status card: authority/runtime/setup lines, per-Bank replica + Pending rows with Sync now / Full reconcile / Retry, active operations with Cancel (admitted replica.sync only)
- memory-authority-state.ts — provider status and semantic Bank/operation labels; unknown stays unknown and internal identities remain non-display state
- memory-operations-controller.ts — shared tidy/replica admission and acknowledgement-gated status reads; filtered latest-tidy recovery, busy-operation lookup, retained visibility obligations and no mutation replay
- use-memory-operations.ts — one Memory operations React lifecycle with independent authority/tidy read failures and current-client actions
- memory-authority-fixtures.ts — test support (not in the production path): MemoryAuthorityStatus / Bank / MemoryOperation fixtures shared by the card, view-model and controller tests

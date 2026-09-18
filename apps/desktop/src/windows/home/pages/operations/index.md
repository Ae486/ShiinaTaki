# windows/home/pages/operations/
The operations page: the memory authority / Hindsight operations card, manual memory maintenance, the memory/context
status card, and storage usage with the D46 attachment purge. Every number comes from a WS read — the page computes nothing the Core owns.
- operations-page.tsx — page root: memory authority card, tidy trigger + defect counts, status card, storage card; loading rides Skeleton and the failed status/usage read carries a retry
- storage-card.tsx — media.usage display + the two-step attachment purge; confirmation and Cancel lock once clearing starts (outcomes ride FeedbackLine)
- use-operations.ts — the page's ws touchpoint: memory.tidy plus the cached memory.status / media.usage reads (a failed re-read keeps the last counters on screen; refresh() backs the retry)
- use-media-clear.ts — destructive purge owner: immediate exact-once guard, media.clear call, terminal release, and refresh
- operations-state.ts — pure view models + media.clear state machine; Cancel is valid only before destructive execution
- memory-authority-card.tsx — memory.authority.status card: authority/runtime/setup lines, per-Bank replica + Pending rows with Sync now / Full reconcile / Retry, active operations with Cancel (admitted replica.sync only)
- memory-authority-state.ts — pure view models for that card (unknown stays 未知) + the MEMORY_OPERATION_REFUSED app-error reader
- memory-operations-controller.ts — framework-free authority guard: current-generation-only status reads, serialized submit/cancel, one changed-push subscription per client, coalesced refetch
- use-memory-operations.ts — the React seam for memory.operations.*: state + the controller lifecycle bound to the authenticated client
- memory-authority-fixtures.ts — test support (not in the production path): MemoryAuthorityStatus / Bank / MemoryOperation fixtures shared by the card, view-model and controller tests

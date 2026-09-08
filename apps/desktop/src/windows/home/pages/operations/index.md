# windows/home/pages/operations/
The operations page: manual memory maintenance, the memory/context status card, and storage usage with the D46
attachment purge. Every number comes from a WS read — the page computes nothing the Core owns.
- operations-page.tsx — page root: tidy trigger + defect counts, status card, storage card; loading rides Skeleton and the failed status/usage read carries a retry
- storage-card.tsx — media.usage display + the two-step attachment purge; confirmation and Cancel lock once clearing starts (outcomes ride FeedbackLine)
- use-operations.ts — independent memory/storage demand states and retries, with visibility-gated read invalidation after writes
- use-memory-tidy.ts — synchronous one-attempt tidy lock and current-client outcomes, independent of read visibility
- use-media-clear.ts — destructive purge owner: immediate exact-once guard, media.clear call, terminal release, and refresh
- operations-state.ts — pure view models + media.clear state machine; Cancel is valid only before destructive execution

# windows/home/pages/operations/
The operations page: manual memory maintenance, the memory/context status card, and storage usage with the D46
attachment purge. Every number comes from a WS read — the page computes nothing the Core owns.
- operations-page.tsx — page root: tidy trigger + defect counts, status card, storage card
- storage-card.tsx — media.usage display + the two-step (confirm) attachment purge
- use-operations.ts — the page's ws touchpoint: memory.tidy plus the cached memory.status / media.usage reads (a failed re-read keeps the last counters on screen)
- use-media-clear.ts — the destructive purge: the confirm-guarded media.clear call and its outcome
- operations-state.ts — pure view models (defect rows, status rows, byte formatting) + the media.clear confirm state machine

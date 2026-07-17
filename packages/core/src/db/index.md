# core/db/
- sqlite.ts — DatabaseSync wrapper (open/pragmas/transaction/close); the ONLY node:sqlite importer; toSafeInteger
- migration-runner.ts — startup migration runner: applies version > max(applied), one transaction each, tracked
- timeline-repo.ts — timeline_messages SQL: append / deleteEntry / pageBefore / latestAscending / latestSeq / rangeAscending (zod-parse at the row boundary)
- memory-repo.ts — memory_entries + memory_fts SQL: upsert / deleteByPath / listHashes / listActiveByLayers / search / resolvePath
- memory-auto-repo.ts — memory_auto_state SQL: get / setEpisodic / setFlush (per-character auto-write watermarks)
- migrations/ — numbered TS-constant migrations + their ordered registry

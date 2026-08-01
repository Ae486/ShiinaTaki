# core/db/
- sqlite.ts — DatabaseSync wrapper (open/pragmas/transaction/close); the ONLY node:sqlite importer; toSafeInteger
- migration-runner.ts — startup migration runner: applies version > max(applied), one transaction each, tracked
- timeline-repo.ts — timeline_messages SQL: append / deleteEntry / pageBefore / latestAscending / latestSeq / rangeAscending (zod-parse at the row boundary)
- memory-repo.ts — memory_entries + memory_fts SQL: upsert / deleteByPath / listHashes / listActiveByLayers / listActiveInLayer / countActiveSince / search / resolvePath; the 4-column bm25 weights are baked in at construction from config; the retention + tidy-trigger reads anchor on COALESCE(updated_at, created_at)
- memory-auto-repo.ts — memory_auto_state SQL: get / setEpisodic / setFlush / setTidy (per-character auto-write + tidy watermarks)
- memory-events-repo.ts — memory_events SQL: record / listByCharacter (the memory system's decision log — skips, reinforcements, searches, tidy passes; ids/counts only, never memory content or a query)
- privacy-pause-repo.ts — privacy_pause_state SQL: load / save (the single global Privacy Pause row; a consent withdrawal must survive a restart)
- window-state-repo.ts — slot_window_state SQL: get / set (per-model-slot effective window + EMA factor — the window calibrator's persistence, batch 6)
- migrations/ — numbered TS-constant migrations + their ordered registry

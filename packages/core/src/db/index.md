# core/db/
- sqlite.ts — DatabaseSync wrapper (open/pragmas/transaction/close); the ONLY node:sqlite importer; toSafeInteger
- migration-runner.ts — startup migration runner: applies version > max(applied), one transaction each, tracked
- timeline-repo.ts — timeline_messages SQL: append / pageBefore / latestAscending (zod-parse at the row boundary)
- migrations/ — numbered TS-constant migrations + their ordered registry

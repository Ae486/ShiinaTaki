# core/db/migrations/
- 001-timeline.ts — migration 1: timeline_messages table + (character_id, seq DESC) index
- 002-memory.ts — migration 2: memory_entries metadata + memory_fts trigram virtual table (rebuildable index)
- 003-memory-auto-state.ts — migration 3: memory_auto_state (per-character episodic/flush auto-write watermarks)
- 004-timeline-parts.ts — migration 4: timeline_messages rebuild — 'tool' role + nullable parts JSON column (D1 fidelity)
- 005-privacy-pause.ts — migration 5: privacy_pause_state (one row: the persisted Privacy Pause + its absolute deadline)
- 006-memory-origin.ts — migration 6: memory_entries gains origin + updated_at; content_hash blanked so the boot reconcile backfills both from the files
- 007-memory-events.ts — migration 7: memory_events (the memory system's decision log — kind/character/turn/entry, ids only)
- index-list.ts — the explicit ordered MIGRATIONS registry (no fs/glob discovery)
